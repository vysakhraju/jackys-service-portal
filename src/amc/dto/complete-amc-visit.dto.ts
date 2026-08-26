import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CompleteAmcVisitDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  checklistNotes?: string;

  @ApiProperty({ required: false, description: 'Base64-encoded signature capture' })
  @IsOptional()
  @IsString()
  customerSignatureBase64?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  extraChargeDescription?: string;

  @ApiProperty({ required: false, example: 150.0 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  extraChargeAmount?: number;

  // Required (and must be true) whenever extraChargeAmount is set - enforced in
  // AmcService.completeVisit, not just at the DTO level, since a caller could always
  // send extraChargeAmount without this flag through Swagger/curl directly.
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  extraChargeApprovedByCustomer?: boolean;
}
