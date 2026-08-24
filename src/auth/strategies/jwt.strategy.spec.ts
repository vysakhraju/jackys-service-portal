import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UserStatus } from '../entities/user.entity';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let userRepository: any;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    userRepository = { findOne: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('test-secret') } as any;
    strategy = new JwtStrategy(configService, userRepository);
  });

  it('returns the active user for a valid payload', async () => {
    const user = { id: 'user-1', status: UserStatus.ACTIVE, role: { name: 'CCE' } };
    userRepository.findOne.mockResolvedValue(user);

    const payload = { sub: 'user-1', email: 'a@b.com', roleId: 'r1', roleName: 'CCE', permissions: [] };
    const result = await strategy.validate(payload);

    expect(result).toBe(user);
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      relations: { role: true },
    });
    expect((result as any).jwtPayload).toEqual(payload);
  });

  it('throws UnauthorizedException when the user no longer exists', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'missing', email: '', roleId: '', roleName: '', permissions: [] }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the account is not active', async () => {
    userRepository.findOne.mockResolvedValue({ id: 'user-1', status: UserStatus.SUSPENDED });

    await expect(
      strategy.validate({ sub: 'user-1', email: '', roleId: '', roleName: '', permissions: [] }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
