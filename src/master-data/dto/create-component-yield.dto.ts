import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsNumber, IsBoolean, MaxLength } from 'class-validator';
import { RecoveryCategory } from '../entities/component-yield-matrix.entity';

export class CreateComponentYieldDto {
  @ApiProperty({ example: 'WA80J5710' })
  @IsString()
  @MaxLength(50)
  modelId: string;

  @ApiProperty({ example: 'BOM-4471' })
  @IsString()
  @MaxLength(100)
  originalBomItemCode: string;

  @ApiProperty({ example: 'Drum Motor Assembly' })
  @IsString()
  @MaxLength(255)
  itemName: string;

  @ApiProperty({ enum: RecoveryCategory })
  @IsEnum(RecoveryCategory)
  category: RecoveryCategory;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  defaultRecoveryEvaluation?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  convertedSparePartCode?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
