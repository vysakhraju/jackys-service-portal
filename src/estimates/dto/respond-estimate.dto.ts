import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class RespondEstimateDto {
  @ApiProperty({ example: true, description: 'true to approve the estimate, false to reject it' })
  @IsBoolean()
  approved: boolean;

  @ApiProperty({ required: false, example: 'Please proceed as soon as possible' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
