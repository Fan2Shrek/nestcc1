import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

interface UserRecord {
  id: string;
  email: string;
  username: string;
  color: string;
  passwordHash: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  color: string;
  createdAt: string;
}

export interface UpdateProfilePayload {
  username?: string;
  color?: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  private readonly usersByEmail = new Map<string, UserRecord>();
  private readonly usersById = new Map<string, UserRecord>();
  private readonly userIdByToken = new Map<string, string>();

  async register(
    email: string,
    password: string,
    payload: UpdateProfilePayload = {},
  ): Promise<AuthResponse> {
    const normalizedEmail = this.validateAndNormalizeEmail(email);
    this.validatePassword(password);

    if (this.usersByEmail.has(normalizedEmail)) {
      throw new BadRequestException('Email already exists');
    }

    const username = this.validateUsername(
      payload.username ?? this.defaultUsernameFromEmail(normalizedEmail),
    );
    const color = this.validateColor(
      payload.color ?? this.defaultColorFromId(normalizedEmail),
    );

    const user: UserRecord = {
      id: randomUUID(),
      email: normalizedEmail,
      username,
      color,
      passwordHash: await this.hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    this.usersByEmail.set(normalizedEmail, user);
    this.usersById.set(user.id, user);
    return this.buildAuthResponse(user);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const normalizedEmail = this.validateAndNormalizeEmail(email);
    this.validatePassword(password);

    const user = this.usersByEmail.get(normalizedEmail);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await this.verifyPassword(
      password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildAuthResponse(user);
  }

  updateProfile(token: string, payload: UpdateProfilePayload): AuthUser {
    const actor = this.getUserByToken(token);
    const user = this.usersById.get(actor.id);

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.username !== undefined) {
      user.username = this.validateUsername(payload.username);
    }

    if (payload.color !== undefined) {
      user.color = this.validateColor(payload.color);
    }

    return this.toAuthUser(user);
  }

  getUserByToken(token: string): AuthUser {
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    const userId = this.userIdByToken.get(token);

    if (!userId) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = this.usersById.get(userId);

    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    return this.toAuthUser(user);
  }

  findUserByEmail(email: string): AuthUser | undefined {
    const normalizedEmail = this.validateAndNormalizeEmail(email);
    const user = this.usersByEmail.get(normalizedEmail);
    return user ? this.toAuthUser(user) : undefined;
  }

  getUserById(userId: string): AuthUser | undefined {
    const user = this.usersById.get(userId);
    return user ? this.toAuthUser(user) : undefined;
  }

  listUsers(): AuthUser[] {
    return [...this.usersById.values()].map((user) => this.toAuthUser(user));
  }

  private buildAuthResponse(user: UserRecord): AuthResponse {
    const token = randomUUID();
    this.userIdByToken.set(token, user.id);

    return {
      token,
      user: this.toAuthUser(user),
    };
  }

  private toAuthUser(user: UserRecord): AuthUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      color: user.color,
      createdAt: user.createdAt,
    };
  }

  private validateAndNormalizeEmail(rawEmail: string): string {
    const email = rawEmail?.trim().toLowerCase();

    if (!email || !this.isValidEmail(email)) {
      throw new BadRequestException('A valid email is required');
    }

    return email;
  }

  private validatePassword(password: string): void {
    if (!password || password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long',
      );
    }
  }

  private validateUsername(username: string): string {
    const normalizedUsername = username?.trim();

    if (!normalizedUsername) {
      throw new BadRequestException('Username is required');
    }

    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
      throw new BadRequestException(
        'Username must be between 3 and 30 characters',
      );
    }

    return normalizedUsername;
  }

  private validateColor(color: string): string {
    const normalizedColor = color?.trim().toLowerCase();

    if (!normalizedColor) {
      throw new BadRequestException('Color is required');
    }

    if (!/^#[0-9a-f]{6}$/.test(normalizedColor)) {
      throw new BadRequestException(
        'Color must be a valid hex value (#rrggbb)',
      );
    }

    return normalizedColor;
  }

  private defaultUsernameFromEmail(email: string): string {
    return email.split('@')[0].slice(0, 30);
  }

  private defaultColorFromId(seed: string): string {
    let hash = 0;

    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(index);
      hash |= 0;
    }

    const red = (hash & 0xff0000) >> 16;
    const green = (hash & 0x00ff00) >> 8;
    const blue = hash & 0x0000ff;
    const clamp = (value: number) =>
      Math.max(70, Math.min(220, Math.abs(value)));

    return `#${clamp(red).toString(16).padStart(2, '0')}${clamp(green)
      .toString(16)
      .padStart(2, '0')}${clamp(blue).toString(16).padStart(2, '0')}`;
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    const [salt, storedHash] = hash.split(':');

    if (!salt || !storedHash) {
      return false;
    }

    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    const storedHashBuffer = Buffer.from(storedHash, 'hex');

    if (derivedKey.length !== storedHashBuffer.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, storedHashBuffer);
  }
}
