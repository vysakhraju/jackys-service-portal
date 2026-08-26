import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { VisitFrequency, AmcPaymentTerms } from '../entities/amc-contract.entity';

export class RenewAmcContractDto {
  @ApiProperty({ example: '2027-09-01T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2028-08-31T00:00:00.000Z' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ example: 5000.0 })
  @IsNumber()
  @Min(0.01)
  totalAmount: number;

  // Everything below defaults to the previous contract's value when omitted - a renewal
  // is usually "same terms, new dates/amount", not a from-scratch contract.
  @ApiProperty({ enum: VisitFrequency, required: false })
  @IsOptional()
  @IsEnum(VisitFrequency)
  visitFrequency?: VisitFrequency;

  @ApiProperty({ enum: AmcPaymentTerms, required: false })
  @IsOptional()
  @IsEnum(AmcPaymentTerms)
  paymentTerms?: AmcPaymentTerms;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coveredSerialNumbers?: string[];
}
