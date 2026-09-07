import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CompleteVisitDto {
  @ApiProperty({ example: 'Replaced compressor, unit tested working on-site', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
