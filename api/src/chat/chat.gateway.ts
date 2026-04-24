import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { ChatService } from './chat.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomInviteDto } from './dto/room-invite.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { SetTypingDto } from './dto/set-typing.dto';
import { MessageReactionDto } from './dto/message-reaction.dto';

interface WsAck<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:8000'],
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  private readonly socketsByUserId = new Map<string, Set<string>>();
  private readonly userIdBySocketId = new Map<string, string>();

  constructor(
    private readonly chatService: ChatService,
    private readonly authService: AuthService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      const token = this.extractToken(client);
      const user = this.authService.getUserByToken(token);

      (client.data as { token: string }).token = token;
      (client.data as { userId: string }).userId = user.id;

      this.registerSocket(user.id, client.id);

      const rooms = this.chatService.listRooms(token);
      for (const room of rooms) {
        client.join(room.id);
      }

      client.emit('rooms:updated', rooms);
    } catch {
      client.emit('chat:error', { message: 'Unauthorized socket connection' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = this.userIdBySocketId.get(client.id);

    if (!userId) {
      return;
    }

    this.unregisterSocket(userId, client.id);
  }

  @SubscribeMessage('rooms:list')
  listRooms(@ConnectedSocket() client: Socket): WsAck<unknown> {
    return this.execute(client, () =>
      this.chatService.listRooms(this.getToken(client)),
    );
  }

  @SubscribeMessage('room:create')
  createRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateRoomDto,
  ): WsAck<unknown> {
    return this.execute(client, () => {
      const room = this.chatService.createRoom(this.getToken(client), payload);
      client.join(room.id);
      this.notifyRoomMembers(room.id);
      return room;
    });
  }

  @SubscribeMessage('room:invite')
  inviteUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; invitee: RoomInviteDto },
  ): WsAck<unknown> {
    return this.execute(client, () => {
      const room = this.chatService.inviteUser(
        this.getToken(client),
        payload.roomId,
        payload.invitee,
      );
      this.notifyRoomMembers(room.id);
      return room;
    });
  }

  @SubscribeMessage('room:messages')
  getMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ): WsAck<unknown> {
    return this.execute(client, () => {
      client.join(payload.roomId);
      return this.chatService.getMessages(
        this.getToken(client),
        payload.roomId,
      );
    });
  }

  @SubscribeMessage('message:send')
  sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; message: CreateMessageDto },
  ): WsAck<unknown> {
    return this.execute(client, () => {
      const message = this.chatService.sendMessage(
        this.getToken(client),
        payload.roomId,
        payload.message.content,
      );

      this.server.to(payload.roomId).emit('message:new', {
        roomId: payload.roomId,
        message,
      });

      const typing = this.chatService.getTyping(
        this.getToken(client),
        payload.roomId,
      );
      this.server.to(payload.roomId).emit('typing:updated', typing);

      return message;
    });
  }

  @SubscribeMessage('typing:set')
  setTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; typing: SetTypingDto },
  ): WsAck<unknown> {
    return this.execute(client, () => {
      const typing = this.chatService.setTyping(
        this.getToken(client),
        payload.roomId,
        Boolean(payload.typing?.isTyping),
      );

      this.server.to(payload.roomId).emit('typing:updated', typing);
      return typing;
    });
  }

  @SubscribeMessage('typing:get')
  getTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ): WsAck<unknown> {
    return this.execute(client, () =>
      this.chatService.getTyping(this.getToken(client), payload.roomId),
    );
  }

  @SubscribeMessage('reaction:toggle')
  toggleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      roomId: string;
      messageId: string;
      reaction: MessageReactionDto;
    },
  ): WsAck<unknown> {
    return this.execute(client, () => {
      const updatedMessage = this.chatService.toggleMessageReaction(
        this.getToken(client),
        payload.roomId,
        payload.messageId,
        payload.reaction.emoji,
      );

      this.server.to(payload.roomId).emit('message:updated', {
        roomId: payload.roomId,
        message: updatedMessage,
      });

      return updatedMessage;
    });
  }

  private execute<T>(client: Socket, action: () => T): WsAck<T> {
    try {
      return {
        ok: true,
        data: action(),
      };
    } catch (error) {
      return {
        ok: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  private notifyRoomMembers(roomId: string): void {
    const memberIds = this.chatService.getRoomMemberIds(roomId);

    for (const userId of memberIds) {
      const sockets = this.socketsByUserId.get(userId);
      if (!sockets || sockets.size === 0) {
        continue;
      }

      const rooms = this.chatService.listRoomsForUserId(userId);

      for (const socketId of sockets) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (!socket) {
          continue;
        }

        socket.join(roomId);
        socket.emit('rooms:updated', rooms);
      }
    }
  }

  private registerSocket(userId: string, socketId: string): void {
    if (!this.socketsByUserId.has(userId)) {
      this.socketsByUserId.set(userId, new Set<string>());
    }

    this.socketsByUserId.get(userId)?.add(socketId);
    this.userIdBySocketId.set(socketId, userId);
  }

  private unregisterSocket(userId: string, socketId: string): void {
    this.userIdBySocketId.delete(socketId);

    const sockets = this.socketsByUserId.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.socketsByUserId.delete(userId);
    }
  }

  private getToken(client: Socket): string {
    return String((client.data as { token?: string }).token || '');
  }

  private extractToken(client: Socket): string {
    const tokenFromAuth = (client.handshake.auth as { token?: string })?.token;

    if (typeof tokenFromAuth === 'string' && tokenFromAuth.trim()) {
      return tokenFromAuth.trim();
    }

    const authorizationHeader = client.handshake.headers.authorization;
    if (typeof authorizationHeader === 'string') {
      const [scheme, token] = authorizationHeader.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token) {
        return token.trim();
      }
    }

    const tokenFromQuery = client.handshake.query?.token;
    if (typeof tokenFromQuery === 'string' && tokenFromQuery.trim()) {
      return tokenFromQuery.trim();
    }

    return '';
  }

  private getErrorMessage(error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message;
    }

    return 'Unexpected socket error';
  }
}
