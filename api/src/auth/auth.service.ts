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
  passwordHash: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    createdAt: string;
  };
}

@Injectable()
export class AuthService {
  private readonly usersByEmail = new Map<string, UserRecord>();

  async register(email: string, password: string): Promise<AuthResponse> {
    const normalizedEmail = this.validateAndNormalizeEmail(email);
    this.validatePassword(password);

    if (this.usersByEmail.has(normalizedEmail)) {
      throw new BadRequestException('Email already exists');
    }

    const user: UserRecord = {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash: await this.hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    this.usersByEmail.set(normalizedEmail, user);
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

  private buildAuthResponse(user: UserRecord): AuthResponse {
    return {
      token: randomUUID(),
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
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
      throw new BadRequestException('Password must be at least 8 characters long');
    }
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
