import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { RefreshStrategy } from './refresh.strategy';
import { UserStatus } from '../entities/user.entity';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

describe('RefreshStrategy', () => {
  let strategy: RefreshStrategy;
  let userRepository: any;
  let configService: jest.Mocked<ConfigService>;

  const req = { body: { refreshToken: 'raw-refresh-token' } };

  beforeEach(() => {
    userRepository = { findOne: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('refresh-secret') } as any;
    strategy = new RefreshStrategy(configService, userRepository);
    (bcrypt.compare as jest.Mock).mockReset();
  });

  it('returns the user when the refresh token matches the stored hash', async () => {
    const user = {
      id: 'user-1',
      status: UserStatus.ACTIVE,
      refreshTokenHash: 'stored-hash',
    };
    userRepository.findOne.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await strategy.validate(req, { sub: 'user-1', type: 'refresh' });

    expect(result).toBe(user);
    expect(bcrypt.compare).toHaveBeenCalledWith('raw-refresh-token', 'stored-hash');
  });

  it('throws UnauthorizedException for a non-refresh token type', async () => {
    await expect(
      strategy.validate(req, { sub: 'user-1', type: 'access' as any }),
    ).rejects.toThrow(UnauthorizedException);
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the user does not exist', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(
      strategy.validate(req, { sub: 'missing', type: 'refresh' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the account is not active', async () => {
    userRepository.findOne.mockResolvedValue({ id: 'user-1', status: UserStatus.INACTIVE });

    await expect(
      strategy.validate(req, { sub: 'user-1', type: 'refresh' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the user has no stored refresh token', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      refreshTokenHash: null,
    });

    await expect(
      strategy.validate(req, { sub: 'user-1', type: 'refresh' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the token does not match the stored hash', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      refreshTokenHash: 'stored-hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      strategy.validate(req, { sub: 'user-1', type: 'refresh' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
