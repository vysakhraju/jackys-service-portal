import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserStatus } from '../entities/user.entity';
import * as bcrypt from 'bcryptjs';

export interface RefreshPayload {
  sub: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_REFRESH_SECRET') || 'your-super-secret-refresh-key-change-in-production',
      algorithms: ['RS256'],
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: RefreshPayload): Promise<User> {
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      relations: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User account is not active');
    }

    if (!user.refreshTokenHash) {
      throw new UnauthorizedException('No refresh token found');
    }

    const isValid = await bcrypt.compare(req.body.refreshToken, user.refreshTokenHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return user;
  }
}