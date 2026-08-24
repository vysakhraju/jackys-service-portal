import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsInt, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateKpiRuleDto {
  @ApiProperty({ example: 'First Time Fix Rate' })
  @IsString()
  @MaxLength(100)
  kpiName: string;

  @ApiProperty({ example: 25, description: 'Percentage weight in the overall KPI score' })
  @IsNumber()
  weightage: number;

  @ApiProperty({ example: 90 })
  @IsNumber()
  target: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  incentivePoints: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
