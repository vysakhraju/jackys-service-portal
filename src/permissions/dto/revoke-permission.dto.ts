import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PermissionType } from '../entities/user-permission-grant.entity';

export class RevokePermissionDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456', description: 'The user losing the grant' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: PermissionType })
  @IsEnum(PermissionType)
  permissionType: PermissionType;

  @ApiProperty({ required: false, description: 'Optional note on why this was revoked' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
