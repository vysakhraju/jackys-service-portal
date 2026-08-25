import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class QcRejectDto {
  @ApiProperty({ description: 'Reason the QC officer rejected this job - required for the audit trail' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
