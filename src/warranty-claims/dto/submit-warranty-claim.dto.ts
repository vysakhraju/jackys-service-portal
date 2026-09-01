import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class SubmitWarrantyClaimDto {
  @ApiProperty({ example: 'VENDOR-CLM-2026-0912', description: "The vendor portal's own claim reference number (BRD 12.3) - free text, no real portal integration exists" })
  @IsString()
  @MinLength(1)
  claimReferenceNumber: string;

  @ApiProperty({ required: false, example: 'Invoices and job card PDFs attached in the vendor portal upload' })
  @IsOptional()
  @IsString()
  notes?: string;
}
