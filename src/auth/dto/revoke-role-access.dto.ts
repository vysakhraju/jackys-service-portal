import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RoleName } from '../entities/role.entity';

export class RevokeRoleAccessDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: RoleName })
  @IsIn(Object.values(RoleName))
  roleName: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
