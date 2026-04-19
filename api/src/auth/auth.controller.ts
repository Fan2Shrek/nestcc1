import { Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() credentials: AuthCredentialsDto) {
    return this.authService.register(credentials.email, credentials.password, {
      username: credentials.username,
      color: credentials.color,
    });
  }

  @Post('login')
  async login(@Body() credentials: AuthCredentialsDto) {
    return this.authService.login(credentials.email, credentials.password);
  }

  @Get('me')
  getProfile(@Headers('authorization') authorization: string | undefined) {
    return this.authService.getUserByToken(this.extractBearerToken(authorization));
  }

  @Patch('me')
  updateProfile(
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(
      this.extractBearerToken(authorization),
      payload,
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
