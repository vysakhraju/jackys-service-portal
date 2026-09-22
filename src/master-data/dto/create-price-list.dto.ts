import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID, IsString, IsNumber, IsBoolean, MaxLength } from 'class-validator';
import { ApplianceCategory } from '../entities/fault-symptom.entity';
import { JobType } from '../entities/service-price-list.entity';

// Price List rebuild (requested 2026-09-22, Phase 3) - see service-price-list.entity.ts's
// own doc comment for the full reasoning behind this row shape. `category`/`jobType`
// together are the row's business key (unique index on the entity); creating a second
// row for a combo that already has one is rejected by the service, same pattern as
// City/BillingChannel's own name-uniqueness check.
export class CreatePriceListDto {
  @ApiProperty({ enum: ApplianceCategory })
  @IsEnum(ApplianceCategory)
  category: ApplianceCategory;

  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  priceB2B?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  priceB2C?: number;

  @ApiPropertyOptional({
    description: 'Billing Channel this interdepartment rate applies to. Leave unset if this row has no channel-specific rate.',
  })
  @IsOptional()
  @IsUUID()
  billingChannelId?: string;

  @ApiProperty({ required: false, default: 0, description: 'Rate used when billed via billingChannelId, instead of priceB2B.' })
  @IsOptional()
  @IsNumber()
  billingChannelRate?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  warrantyLaborCost?: number;

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

// category/jobType are excluded from the partial update surface deliberately - they're
// the row's identity (the unique index); changing them on an existing row would just be
// a delete-and-recreate under a different key, so the service treats this as
// rates/status only, same as every other master's Update DTO in this app.
export class UpdatePriceListDto extends PartialType(CreatePriceListDto) {}
