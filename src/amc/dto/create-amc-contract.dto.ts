import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { CoverageType, VisitFrequency, AmcPaymentTerms } from '../entities/amc-contract.entity';
import { CustomerType } from '../../appointments/entities/appointment.entity';

export class CreateAmcContractDto {
  @ApiProperty({ example: 'Al Futtaim Facilities LLC' })
  @IsString()
  @MinLength(2)
  customerName: string;

  @ApiProperty({ example: '+971501234567' })
  @IsString()
  @MinLength(5)
  customerPhone: string;

  @ApiProperty({ required: false, example: 'facilities@example.com' })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  customerAddress?: string;

  @ApiProperty({ enum: CustomerType, default: CustomerType.B2C })
  @IsEnum(CustomerType)
  customerType: CustomerType;

  @ApiProperty()
  @IsUUID()
  serviceCentreId: string;

  @ApiProperty({ type: [String], example: ['SN-000123', 'SN-000124'] })
  @IsArray()
  @IsString({ each: true })
  coveredSerialNumbers: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  modelNumber?: string;

  @ApiProperty({ enum: CoverageType, default: CoverageType.COMPREHENSIVE })
  @IsEnum(CoverageType)
  coverageType: CoverageType;

  @ApiProperty({ required: false, example: 'Standard' })
  @IsOptional()
  @IsString()
  serviceLevel?: string;

  @ApiProperty({ enum: VisitFrequency, example: VisitFrequency.QUARTERLY })
  @IsEnum(VisitFrequency)
  visitFrequency: VisitFrequency;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2027-08-31T00:00:00.000Z' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ example: 4800.0 })
  @IsNumber()
  @Min(0.01)
  totalAmount: number;

  @ApiProperty({ enum: AmcPaymentTerms, default: AmcPaymentTerms.FULL_UPFRONT })
  @IsEnum(AmcPaymentTerms)
  paymentTerms: AmcPaymentTerms;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assignedTechnicianId?: string;
}
