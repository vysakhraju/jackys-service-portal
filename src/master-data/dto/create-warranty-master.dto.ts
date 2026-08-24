import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsDateString, IsBoolean, MaxLength } from 'class-validator';

export class CreateWarrantyMasterDto {
  @ApiProperty({ example: 'SN100000-SN199999', description: 'Inclusive serial number range this warranty applies to' })
  @IsString()
  @MaxLength(100)
  serialNumberRange: string;

  @ApiProperty({ example: 'Samsung' })
  @IsString()
  @MaxLength(100)
  brand: string;

  @ApiProperty({ example: 'WA80J5710' })
  @IsString()
  @MaxLength(100)
  model: string;

  @ApiProperty({ example: 24 })
  @IsInt()
  warrantyPeriodMonths: number;

  @ApiProperty({ example: 'Samsung Gulf' })
  @IsString()
  @MaxLength(100)
  supplier: string;

  @ApiProperty({ required: false, example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiProperty({ required: false, example: '2028-01-01' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
