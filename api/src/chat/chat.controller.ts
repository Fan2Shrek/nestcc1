import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomInviteDto } from './dto/room-invite.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { SetTypingDto } from './dto/set-typing.dto';
import { MessageReactionDto } from './dto/message-reaction.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('rooms')
  createRoom(
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: CreateRoomDto,
  ) {
    return this.chatService.createRoom(
      this.extractBearerToken(authorization),
      payload,
    );
  }

  @Get('rooms')
  listRooms(@Headers('authorization') authorization: string | undefined) {
    return this.chatService.listRooms(this.extractBearerToken(authorization));
  }

  @Post('rooms/:roomId/invitations')
  inviteUser(
    @Headers('authorization') authorization: string | undefined,
    @Param('roomId') roomId: string,
    @Body() invitee: RoomInviteDto,
  ) {
    return this.chatService.inviteUser(
      this.extractBearerToken(authorization),
      roomId,
      invitee,
    );
  }

  @Post('rooms/:roomId/messages')
  sendMessage(
    @Headers('authorization') authorization: string | undefined,
    @Param('roomId') roomId: string,
    @Body() payload: CreateMessageDto,
  ) {
    return this.chatService.sendMessage(
      this.extractBearerToken(authorization),
      roomId,
      payload.content,
    );
  }

  @Get('rooms/:roomId/messages')
  getMessages(
    @Headers('authorization') authorization: string | undefined,
    @Param('roomId') roomId: string,
  ) {
    return this.chatService.getMessages(
      this.extractBearerToken(authorization),
      roomId,
    );
  }

  @Post('rooms/:roomId/typing')
  setTyping(
    @Headers('authorization') authorization: string | undefined,
    @Param('roomId') roomId: string,
    @Body() payload: SetTypingDto,
  ) {
    return this.chatService.setTyping(
      this.extractBearerToken(authorization),
      roomId,
      Boolean(payload?.isTyping),
    );
  }

  @Get('rooms/:roomId/typing')
  getTyping(
    @Headers('authorization') authorization: string | undefined,
    @Param('roomId') roomId: string,
  ) {
    return this.chatService.getTyping(
      this.extractBearerToken(authorization),
      roomId,
    );
  }

  @Post('rooms/:roomId/messages/:messageId/reactions')
  toggleReaction(
    @Headers('authorization') authorization: string | undefined,
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @Body() payload: MessageReactionDto,
  ) {
    return this.chatService.toggleMessageReaction(
      this.extractBearerToken(authorization),
      roomId,
      messageId,
      payload.emoji,
    );
  }

  private extractBearerToken(authorization: string | undefined): string {
    if (!authorization) {
      return '';
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return '';
    }

    return token.trim();
  }
}
