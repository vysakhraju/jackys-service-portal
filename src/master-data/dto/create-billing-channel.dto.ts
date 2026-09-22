import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, Min, MaxLength } from 'class-validator';

export class CreateBillingChannelDto {
  @ApiProperty({ example: 'Corporate Interdepartment' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Phase 5 (2026-09-22, per-appointment Billing Channel override) - the flat rate this
  // channel bills at when an appointment picks it directly, overriding the Price List
  // row's own billingChannelRate. See billing-channel-resolution.util.ts.
  @ApiProperty({ required: false, example: 450, description: 'Flat rate this channel bills at when picked directly on an appointment' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultRate?: number;
}

export class UpdateBillingChannelDto extends PartialType(CreateBillingChannelDto) {}
