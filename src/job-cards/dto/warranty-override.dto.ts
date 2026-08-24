import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength, MaxLength } from 'class-validator';
import { WarrantyStatus } from '../../technician/entities/technician-visit.entity';

export class WarrantyOverrideDto {
  @ApiProperty({ enum: WarrantyStatus, description: 'The corrected warranty status' })
  @IsEnum(WarrantyStatus)
  newStatus: WarrantyStatus;

  @ApiProperty({ description: 'Reason for the override - required for the audit trail (FR-17)' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
