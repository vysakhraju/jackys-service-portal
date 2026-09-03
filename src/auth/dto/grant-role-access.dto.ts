import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RoleName } from '../entities/role.entity';
import { NON_GRANTABLE_ACCESS_ROLES } from '../entities/role-access-grant.entity';

export const GRANTABLE_ACCESS_ROLE_NAMES = Object.values(RoleName).filter(
  (name) => !NON_GRANTABLE_ACCESS_ROLES.includes(name),
);

export class GrantRoleAccessDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456', description: 'The user receiving delegated access' })
  @IsUUID()
  userId: string;

  @ApiProperty({
    enum: GRANTABLE_ACCESS_ROLE_NAMES,
    description: 'The role whose access is being delegated. SUPER_ADMIN, SERVICE_HEAD and CUSTOMER can never be delegated this way.',
  })
  @IsIn(GRANTABLE_ACCESS_ROLE_NAMES)
  roleName: string;

  @ApiProperty({
    example: '2026-09-20T00:00:00.000Z',
    description: 'When this delegated access ends automatically. Required - every grant has a hard end date (max 90 days out); there is no standing/permanent delegation.',
  })
  @IsDateString()
  expiresAt: string;

  @ApiProperty({ required: false, description: 'Why this access is being granted, e.g. "Covering for TL while on leave 09/15-09/29"' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
