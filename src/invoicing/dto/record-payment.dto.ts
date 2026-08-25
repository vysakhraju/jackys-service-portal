import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '../entities/invoice.entity';

export class RecordPaymentDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiProperty({ example: 470.0, description: 'Must equal the invoice amount exactly - partial payments are not supported yet.' })
  @IsNumber()
  @Min(0.01)
  amountReceived: number;

  @ApiProperty({ required: false, example: 'Card terminal ref #TXN-88213' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;
}
