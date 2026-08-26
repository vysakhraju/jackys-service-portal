import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class VerifyDismantlingRecordDto {
  @ApiProperty({ required: false, example: 'Confirmed - compressor and PCB tested good, matches technician log' })
  @IsOptional()
  @IsString()
  notes?: string;
}
