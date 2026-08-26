import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GenerateAmcBillingInvoiceDto {
  @ApiProperty({ example: 'Full Term' })
  @IsString()
  @MinLength(1)
  periodLabel: string;
}
