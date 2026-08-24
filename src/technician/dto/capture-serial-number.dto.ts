import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CaptureSerialNumberDto {
  @ApiProperty({ example: 'SN123456789' })
  @IsString()
  @MaxLength(100)
  serialNumber: string;

  @ApiPropertyOptional({ example: 'Samsung' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;
}
