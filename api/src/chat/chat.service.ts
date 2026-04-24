import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthService, AuthUser } from '../auth/auth.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomInviteDto } from './dto/room-invite.dto';

const GENERAL_ROOM_ID = 'general';
const TYPING_TTL_MS = 8000;

interface RoomMember {
  userId: string;
  joinedAt: string;
  canAccessHistory: boolean;
}

interface ChatMessage {
  id: string;
  roomId: string;
  authorId: string;
  content: string;
  createdAt: string;
  reactions: Map<string, Set<string>>;
}

interface RoomRecord {
  id: string;
  name: string;
  ownerId: string;
  isGeneral: boolean;
  createdAt: string;
  members: Map<string, RoomMember>;
  messages: ChatMessage[];
  typingByUser: Map<string, string>;
}

interface RoomMemberResponse {
  userId: string;
  email: string;
  username: string;
  color: string;
  joinedAt: string;
  canAccessHistory: boolean;
}

export interface RoomResponse {
  id: string;
  name: string;
  ownerId: string;
  isGeneral: boolean;
  createdAt: string;
  members: RoomMemberResponse[];
}

export interface ReactionResponse {
  emoji: string;
  users: Array<{
    id: string;
    email: string;
    username: string;
    color: string;
  }>;
}

export interface ChatMessageResponse {
  id: string;
  roomId: string;
  content: string;
  createdAt: string;
  author: {
    id: string;
    email: string;
    username: string;
    color: string;
  };
  reactions: ReactionResponse[];
}

export interface TypingResponse {
  roomId: string;
  users: Array<{
    id: string;
    email: string;
    username: string;
    color: string;
  }>;
}

@Injectable()
export class ChatService {
  private readonly roomsById = new Map<string, RoomRecord>();

  constructor(private readonly authService: AuthService) {
    this.initializeGeneralRoom();
  }

  createRoom(token: string, payload: CreateRoomDto): RoomResponse {
    const owner = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(owner.id);

    const name = this.validateRoomName(payload?.name);
    const invitees = Array.isArray(payload?.invitees) ? payload.invitees : [];

    const now = new Date().toISOString();
    const room: RoomRecord = {
      id: randomUUID(),
      name,
      ownerId: owner.id,
      isGeneral: false,
      createdAt: now,
      members: new Map<string, RoomMember>(),
      messages: [],
      typingByUser: new Map<string, string>(),
    };

    room.members.set(owner.id, {
      userId: owner.id,
      joinedAt: now,
      canAccessHistory: true,
    });

    for (const invitee of invitees) {
      this.addOrUpdateInvite(room, invitee, now, owner.id);
    }

    this.roomsById.set(room.id, room);
    return this.toRoomResponse(room);
  }

  listRooms(token: string): RoomResponse[] {
    const actor = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(actor.id);

    return [...this.roomsById.values()]
      .filter((room) => room.members.has(actor.id))
      .map((room) => this.toRoomResponse(room));
  }

  listRoomsForUserId(userId: string): RoomResponse[] {
    this.ensureGeneralRoomForUser(userId);

    return [...this.roomsById.values()]
      .filter((room) => room.members.has(userId))
      .map((room) => this.toRoomResponse(room));
  }

  getRoomMemberIds(roomId: string): string[] {
    const room = this.getRoomOrThrow(roomId);
    return [...room.members.keys()];
  }

  inviteUser(
    token: string,
    roomId: string,
    invitee: RoomInviteDto,
  ): RoomResponse {
    const actor = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(actor.id);

    const room = this.getRoomOrThrow(roomId);

    if (room.isGeneral) {
      throw new ForbiddenException('General room does not support invitations');
    }

    if (room.ownerId !== actor.id) {
      throw new ForbiddenException('Only room owner can invite users');
    }

    this.addOrUpdateInvite(room, invitee, new Date().toISOString(), actor.id);
    return this.toRoomResponse(room);
  }

  sendMessage(
    token: string,
    roomId: string,
    content: string,
  ): ChatMessageResponse {
    const actor = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(actor.id);

    const room = this.getRoomOrThrow(roomId);
    this.getMembershipOrThrow(room, actor.id);

    const messageContent = this.validateMessageContent(content);
    const message: ChatMessage = {
      id: randomUUID(),
      roomId: room.id,
      authorId: actor.id,
      content: messageContent,
      createdAt: new Date().toISOString(),
      reactions: new Map<string, Set<string>>(),
    };

    room.messages.push(message);
    room.typingByUser.delete(actor.id);

    return this.toMessageResponse(message);
  }

  getMessages(token: string, roomId: string): ChatMessageResponse[] {
    const actor = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(actor.id);

    const room = this.getRoomOrThrow(roomId);
    const membership = this.getMembershipOrThrow(room, actor.id);

    const visibleMessages = membership.canAccessHistory
      ? room.messages
      : room.messages.filter(
          (message) => message.createdAt >= membership.joinedAt,
        );

    return visibleMessages.map((message) => this.toMessageResponse(message));
  }

  setTyping(token: string, roomId: string, isTyping: boolean): TypingResponse {
    const actor = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(actor.id);

    const room = this.getRoomOrThrow(roomId);
    this.getMembershipOrThrow(room, actor.id);

    if (isTyping) {
      room.typingByUser.set(actor.id, new Date().toISOString());
    } else {
      room.typingByUser.delete(actor.id);
    }

    return this.buildTypingResponse(room);
  }

  getTyping(token: string, roomId: string): TypingResponse {
    const actor = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(actor.id);

    const room = this.getRoomOrThrow(roomId);
    this.getMembershipOrThrow(room, actor.id);
    return this.buildTypingResponse(room);
  }

  toggleMessageReaction(
    token: string,
    roomId: string,
    messageId: string,
    emoji: string,
  ): ChatMessageResponse {
    const actor = this.authService.getUserByToken(token);
    this.ensureGeneralRoomForUser(actor.id);

    const room = this.getRoomOrThrow(roomId);
    this.getMembershipOrThrow(room, actor.id);
    const message = this.getMessageOrThrow(room, messageId);
    const normalizedEmoji = this.validateReactionEmoji(emoji);

    let usersForEmoji = message.reactions.get(normalizedEmoji);
    if (!usersForEmoji) {
      usersForEmoji = new Set<string>();
      message.reactions.set(normalizedEmoji, usersForEmoji);
    }

    if (usersForEmoji.has(actor.id)) {
      usersForEmoji.delete(actor.id);
    } else {
      usersForEmoji.add(actor.id);
    }

    if (usersForEmoji.size === 0) {
      message.reactions.delete(normalizedEmoji);
    }

    return this.toMessageResponse(message);
  }

  private addOrUpdateInvite(
    room: RoomRecord,
    invitee: RoomInviteDto,
    joinedAt: string,
    ownerId: string,
  ): void {
    const userEmail = this.validateInviteEmail(invitee?.email);
    const user = this.authService.findUserByEmail(userEmail);

    if (!user) {
      throw new BadRequestException(`User not found: ${userEmail}`);
    }

    if (user.id === ownerId) {
      return;
    }

    const canAccessHistory = Boolean(invitee?.canAccessHistory);
    const existingMember = room.members.get(user.id);

    if (existingMember) {
      existingMember.canAccessHistory = canAccessHistory;
      return;
    }

    room.members.set(user.id, {
      userId: user.id,
      joinedAt,
      canAccessHistory,
    });
  }

  private validateRoomName(name: string): string {
    const normalizedName = name?.trim();

    if (!normalizedName) {
      throw new BadRequestException('Room name is required');
    }

    if (normalizedName.length > 120) {
      throw new BadRequestException(
        'Room name must be 120 characters or fewer',
      );
    }

    return normalizedName;
  }

  private validateMessageContent(content: string): string {
    const normalizedContent = content?.trim();

    if (!normalizedContent) {
      throw new BadRequestException('Message content is required');
    }

    if (normalizedContent.length > 2000) {
      throw new BadRequestException('Message must be 2000 characters or fewer');
    }

    return normalizedContent;
  }

  private validateReactionEmoji(emoji: string): string {
    const normalizedEmoji = emoji?.trim();

    if (!normalizedEmoji) {
      throw new BadRequestException('Emoji is required');
    }

    if (normalizedEmoji.length > 16) {
      throw new BadRequestException('Emoji is too long');
    }

    return normalizedEmoji;
  }

  private validateInviteEmail(email: string): string {
    const normalizedEmail = email?.trim().toLowerCase();

    if (!normalizedEmail) {
      throw new BadRequestException('Invite email is required');
    }

    return normalizedEmail;
  }

  private getRoomOrThrow(roomId: string): RoomRecord {
    const room = this.roomsById.get(roomId);

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return room;
  }

  private getMessageOrThrow(room: RoomRecord, messageId: string): ChatMessage {
    const message = room.messages.find((entry) => entry.id === messageId);

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  private getMembershipOrThrow(room: RoomRecord, userId: string): RoomMember {
    const membership = room.members.get(userId);

    if (!membership) {
      throw new ForbiddenException('You are not a member of this room');
    }

    return membership;
  }

  private toRoomResponse(room: RoomRecord): RoomResponse {
    return {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      isGeneral: room.isGeneral,
      createdAt: room.createdAt,
      members: [...room.members.values()].map((member) => {
        const user = this.authService.getUserById(member.userId);

        return {
          userId: member.userId,
          email: user?.email ?? 'unknown',
          username: user?.username ?? 'unknown',
          color: user?.color ?? '#666666',
          joinedAt: member.joinedAt,
          canAccessHistory: member.canAccessHistory,
        };
      }),
    };
  }

  private toMessageResponse(message: ChatMessage): ChatMessageResponse {
    const author = this.authService.getUserById(message.authorId);

    return {
      id: message.id,
      roomId: message.roomId,
      content: message.content,
      createdAt: message.createdAt,
      author: {
        id: message.authorId,
        email: author?.email ?? 'unknown',
        username: author?.username ?? 'unknown',
        color: author?.color ?? '#666666',
      },
      reactions: [...message.reactions.entries()].map(([emoji, userIds]) => ({
        emoji,
        users: [...userIds]
          .map((userId) => this.authService.getUserById(userId))
          .filter((user): user is AuthUser => Boolean(user))
          .map((user) => ({
            id: user.id,
            email: user.email,
            username: user.username,
            color: user.color,
          })),
      })),
    };
  }

  private initializeGeneralRoom(): void {
    const createdAt = new Date().toISOString();

    this.roomsById.set(GENERAL_ROOM_ID, {
      id: GENERAL_ROOM_ID,
      name: 'General',
      ownerId: 'system',
      isGeneral: true,
      createdAt,
      members: new Map<string, RoomMember>(),
      messages: [],
      typingByUser: new Map<string, string>(),
    });
  }

  private ensureGeneralRoomForUser(userId: string): void {
    const generalRoom = this.getRoomOrThrow(GENERAL_ROOM_ID);

    if (generalRoom.members.has(userId)) {
      return;
    }

    generalRoom.members.set(userId, {
      userId,
      joinedAt: new Date().toISOString(),
      canAccessHistory: true,
    });
  }

  private buildTypingResponse(room: RoomRecord): TypingResponse {
    const now = Date.now();

    for (const [userId, startedAt] of room.typingByUser.entries()) {
      const typingSince = Date.parse(startedAt);

      if (!Number.isFinite(typingSince) || now - typingSince > TYPING_TTL_MS) {
        room.typingByUser.delete(userId);
      }
    }

    return {
      roomId: room.id,
      users: [...room.typingByUser.keys()]
        .map((userId) => this.authService.getUserById(userId))
        .filter((user): user is AuthUser => Boolean(user))
        .map((user) => ({
          id: user.id,
          email: user.email,
          username: user.username,
          color: user.color,
        })),
    };
  }
}
