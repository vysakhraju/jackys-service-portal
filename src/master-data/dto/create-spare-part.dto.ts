import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, IsInt, IsObject, MaxLength } from 'class-validator';

export class CreateSparePartDto {
  @ApiProperty({ example: 'SP-1001' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ example: 'Drain Pump' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'MOTOR' })
  @IsString()
  @MaxLength(100)
  category: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  unitCost?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  unitPriceB2B?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  unitPriceB2C?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  minStockLevel?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  vanStockLevel?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;
}
