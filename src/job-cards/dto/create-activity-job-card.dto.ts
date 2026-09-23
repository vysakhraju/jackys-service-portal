import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  MaxLength,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsEnum,
  IsInt,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JobType } from '../../master-data/entities/service-price-list.entity';

// Job Type split (2026-09-22 request, Phase 10): one line on the Installation/Delivery
// Installation creation popup's repeatable grid - Brand (resolved via ApplianceModel),
// Job Type, Quantity, Finished checkbox, exactly as point 10 of the request describes.
// Mirrors CreateEstimateDto/EstimateLineItemDto's own nested-array validation shape
// (@IsArray + @ArrayMinSize(1) + @ValidateNested({ each: true }) + @Type()) - the closest
// existing "parent record with a required repeatable line-items array" precedent in this
// codebase.
export class ActivityJobCardLineItemDto {
  @ApiProperty({ description: 'ApplianceModel id (the Brand/Model master) this line is for' })
  @IsUUID()
  applianceModelId: string;

  @ApiProperty({
    enum: JobType,
    example: JobType.INSTALLATION,
    description: 'Must be INSTALLATION or DELIVERY_INSTALLATION - validated against ACTIVITY_JOB_TYPES at the service layer',
  })
  @IsEnum(JobType)
  jobType: JobType;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ default: false, description: 'Whether this specific line has been completed' })
  @IsBoolean()
  finished: boolean;
}

export class CreateActivityJobCardDto {
  @ApiProperty({
    description:
      'The Appointment this Job Card is created from - must be INSTALLATION/DELIVERY_INSTALLATION, with no Job Card yet, and its mobile activity already Finished (or CCE-overridden)',
  })
  @IsUUID()
  appointmentId: string;

  @ApiProperty({ example: 'ERP-2026-004821', description: 'The ERP reference number this Job Card was raised from' })
  @IsString()
  @MaxLength(100)
  erpReferenceNumber: string;

  @ApiProperty({ type: [ActivityJobCardLineItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ActivityJobCardLineItemDto)
  lineItems: ActivityJobCardLineItemDto[];
}
