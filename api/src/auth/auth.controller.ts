import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() credentials: AuthCredentialsDto) {
    return this.authService.register(credentials.email, credentials.password);
  }

  @Post('login')
  async login(@Body() credentials: AuthCredentialsDto) {
    return this.authService.login(credentials.email, credentials.password);
  }
}
