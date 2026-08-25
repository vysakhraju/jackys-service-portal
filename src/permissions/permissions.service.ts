import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { UserPermissionGrant, PermissionType } from './entities/user-permission-grant.entity';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(UserPermissionGrant)
    private grantsRepo: Repository<UserPermissionGrant>,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
  ) {}

  async grant(
    userId: string,
    permissionType: PermissionType,
    grantedByUserId: string,
    notes?: string,
  ): Promise<UserPermissionGrant> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.grantsRepo.findOne({
      where: { userId, permissionType, revokedAt: IsNull() },
    });
    if (existing) {
      throw new ConflictException(`User already holds an active ${permissionType} grant`);
    }

    const grant = this.grantsRepo.create({
      userId,
      permissionType,
      grantedByUserId,
      notes: notes ?? null,
    });
    return this.grantsRepo.save(grant);
  }

  async revoke(
    userId: string,
    permissionType: PermissionType,
    revokedByUserId: string,
    notes?: string,
  ): Promise<UserPermissionGrant> {
    const existing = await this.grantsRepo.findOne({
      where: { userId, permissionType, revokedAt: IsNull() },
    });
    if (!existing) {
      throw new NotFoundException(`User has no active ${permissionType} grant to revoke`);
    }

    existing.revokedAt = new Date();
    existing.revokedByUserId = revokedByUserId;
    if (notes) {
      existing.notes = notes;
    }
    return this.grantsRepo.save(existing);
  }

  async hasActiveGrant(userId: string, permissionType: PermissionType): Promise<boolean> {
    const count = await this.grantsRepo.count({
      where: { userId, permissionType, revokedAt: IsNull() },
    });
    return count > 0;
  }

  // Throws ForbiddenException if the user does not hold an active grant of this type.
  // This is the single call site every gated action should use (JobCardsController's
  // qc/approve + qc/reject, and the rework-approval check inside
  // WorkshopService.requestSpare()) - keeps "what counts as authorized" in exactly one
  // place instead of duplicated ad-hoc checks per call site.
  async requireActiveGrant(userId: string, permissionType: PermissionType): Promise<void> {
    const active = await this.hasActiveGrant(userId, permissionType);
    if (!active) {
      throw new ForbiddenException(
        `This action requires the ${permissionType} permission, which you do not currently hold. Ask an admin to grant it.`,
      );
    }
  }

  async listGrantsForUser(userId: string): Promise<UserPermissionGrant[]> {
    return this.grantsRepo.find({
      where: { userId },
      order: { grantedAt: 'DESC' },
    });
  }

  async listGrantsByType(permissionType: PermissionType, activeOnly = true): Promise<UserPermissionGrant[]> {
    return this.grantsRepo.find({
      where: activeOnly ? { permissionType, revokedAt: IsNull() } : { permissionType },
      order: { grantedAt: 'DESC' },
      relations: { user: true },
    });
  }
}
