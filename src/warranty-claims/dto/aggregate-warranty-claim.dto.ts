import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MinLength } from 'class-validator';

export class AggregateWarrantyClaimDto {
  @ApiProperty({ example: 'Samsung Gulf FZE', description: 'Must match JobCard.warrantySupplier exactly (the vendor name captured at S/N validation time)' })
  @IsString()
  @MinLength(2)
  supplier: string;

  @ApiProperty({ example: '2026-08-01', description: 'Inclusive start of the aggregation window, matched against InventoryReservation.consumedAt' })
  @IsDateString()
  periodStart: string;

  @ApiProperty({ example: '2026-08-31', description: 'Inclusive end of the aggregation window' })
  @IsDateString()
  periodEnd: string;
}
