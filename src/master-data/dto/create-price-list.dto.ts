import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsNumber, IsBoolean, MaxLength } from 'class-validator';
import { ServiceActivityType } from '../entities/service-price-list.entity';

export class CreatePriceListDto {
  @ApiProperty({ enum: ServiceActivityType })
  @IsEnum(ServiceActivityType)
  activityType: ServiceActivityType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  modelId?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  priceB2B?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  priceB2C?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  warrantyLaborCost?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  interdepartmentLaborCost?: number;

  @ApiProperty({ required: false, example: 'AED' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currency?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
