import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class RecordCreditNoteDto {
  @ApiProperty({ example: 'CN-2026-4471', description: "The vendor's own credit note number (BRD 12.4)" })
  @IsString()
  @MinLength(1)
  creditNoteNumber: string;

  @ApiProperty({ example: 850.0, description: 'Amount credited by the vendor - may be less than totalClaimedAmount (partial recovery)' })
  @IsNumber()
  @IsPositive()
  creditNoteAmount: number;
}
