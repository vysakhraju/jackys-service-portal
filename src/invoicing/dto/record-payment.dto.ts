import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '../entities/invoice.entity';

export class RecordPaymentDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  // Phase 8: partial payments are now supported - amount only needs to be <= the
  // remaining balance, not equal to the full invoice amount. See InvoicingService.addPayment.
  @ApiProperty({ example: 200.0, description: 'Must be > 0 and <= the invoice\'s remaining balance.' })
  @IsNumber()
  @Min(0.01)
  amountReceived: number;

  @ApiProperty({ required: false, example: 'Card terminal ref #TXN-88213' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;
}
