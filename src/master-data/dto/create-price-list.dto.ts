import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID, IsString, IsNumber, IsBoolean, MaxLength } from 'class-validator';
import { ApplianceCategory } from '../entities/fault-symptom.entity';
import { JobType, CustomerType } from '../entities/service-price-list.entity';

// Super-admin pricing matrix rebuild (2026-09-25) - replaces the Phase 3
// (category,jobType)-keyed row (with baked-in priceB2B/priceB2C/billingChannelRate
// columns) with one row per (category, jobType, customerType, billingChannelId) tuple
// and a single `price` column - see service-price-list.entity.ts's own doc comment for
// the full reasoning. Those 4 fields together are the row's business key (unique index
// on the entity, backed by an app-level duplicate check in master-data.service.ts since
// Postgres treats each NULL billingChannelId as distinct in a unique index); creating a
// second row for a combo that already has one is rejected by the service, same pattern
// as City/BillingChannel's own name-uniqueness check.
export class CreatePriceListDto {
  @ApiProperty({ enum: ApplianceCategory })
  @IsEnum(ApplianceCategory)
  category: ApplianceCategory;

  @ApiProperty({ enum: JobType })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty({ enum: CustomerType })
  @IsEnum(CustomerType)
  customerType: CustomerType;

  @ApiPropertyOptional({
    description: 'Billing Channel this rate applies to. Leave unset for the plain (non-channel) rate for this Category/JobType/CustomerType.',
  })
  @IsOptional()
  @IsUUID()
  billingChannelId?: string;

  @ApiProperty({ required: false, default: 0, description: 'The single price for this Category/JobType/CustomerType/BillingChannel combination.' })
  @IsOptional()
  @IsNumber()
  price?: number;

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

// category/jobType/customerType/billingChannelId are excluded from the partial update
// surface deliberately (enforced in master-data.service.ts's updatePriceList) - they're
// the row's identity (the unique index); changing them on an existing row would just be
// a delete-and-recreate under a different key, so this DTO is rates/status only, same
// as every other master's Update DTO in this app.
export class UpdatePriceListDto extends PartialType(CreatePriceListDto) {}
