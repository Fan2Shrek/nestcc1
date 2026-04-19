import { RoomInviteDto } from './room-invite.dto';

export class CreateRoomDto {
  name!: string;
  invitees!: RoomInviteDto[];
}
