import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApplianceCategory } from '../entities/fault-symptom.entity';

export class CreateFaultSymptomDto {
  @ApiProperty({ example: 'F001' })
  @IsString()
  @MaxLength(20)
  faultCode: string;

  @ApiProperty({ example: 'Not draining' })
  @IsString()
  @MaxLength(255)
  faultDescription: string;

  @ApiProperty({ example: 'S001' })
  @IsString()
  @MaxLength(20)
  symptomCode: string;

  @ApiProperty({ example: 'Water remains in drum' })
  @IsString()
  @MaxLength(255)
  symptomDescription: string;

  @ApiProperty({ enum: ApplianceCategory })
  @IsEnum(ApplianceCategory)
  category: ApplianceCategory;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  requiresWorkshop?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
