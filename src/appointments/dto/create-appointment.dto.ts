import {
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
  IsPhoneNumber,
  IsEmail,
  IsUUID,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentType } from '../entities/appointment.entity';
import { AppointmentStatus } from '../entities/appointment.entity';
import { CustomerType } from '../entities/appointment.entity';
import { AppointmentChannel } from '../entities/appointment.entity';

export class CreateAppointmentDto {
  @ApiProperty({ enum: AppointmentType })
  @IsEnum(AppointmentType)
  type: AppointmentType;

  @ApiPropertyOptional({
    enum: AppointmentChannel,
    description: 'How this request came in. Defaults to PHONE (the DB column default) when omitted.',
  })
  @IsOptional()
  @IsEnum(AppointmentChannel)
  channel?: AppointmentChannel;

  @ApiProperty({ enum: CustomerType })
  @IsEnum(CustomerType)
  customerType: CustomerType;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MaxLength(100)
  customerName: string;

  @ApiProperty({ example: '+971501234567' })
  @IsString()
  @MaxLength(20)
  customerPhone: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  customerEmail?: string;

  @ApiPropertyOptional({ example: '123 Main St, Dubai' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerAddress?: string;

  // Populated by resolving a Google Maps short link via POST /appointments/resolve-map-link
  // (see google-maps-link.util.ts) and then submitted alongside the rest of the form, same
  // pattern the mobile "Use my location" GPS flow already uses - the browser/CCE UI does the
  // resolving as a separate step, and these are just plain numbers by the time they reach
  // this DTO. Also fine to type in by hand if the CCE already knows the coordinates.
  @ApiPropertyOptional({ example: 25.2048493, description: 'Service address latitude, e.g. resolved from a Google Maps link' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  customerLat?: number;

  @ApiPropertyOptional({ example: 55.2707828, description: 'Service address longitude, e.g. resolved from a Google Maps link' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  customerLng?: number;

  @ApiPropertyOptional({ example: 'Dubai' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerCity?: string;

  @ApiPropertyOptional({ example: 'UAE' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerCountry?: string;

  @ApiPropertyOptional({ example: '100000000000003' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerVatNumber?: string;

  @ApiPropertyOptional({ example: 'Samsung' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  @ApiPropertyOptional({ example: 'WA80J5710' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  modelNumber?: string;

  @ApiPropertyOptional({ example: 'SN123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  serialNumber?: string;

  @ApiPropertyOptional({ example: '2024-01-15' })
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @ApiPropertyOptional({ example: 'INV-2024-001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  invoiceNumber?: string;

  @ApiPropertyOptional({ example: 'Washing machine not draining' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  problemDescription?: string;

  @ApiPropertyOptional({ example: '2024-08-25' })
  @IsOptional()
  @IsDateString()
  preferredDate?: string;

  @ApiPropertyOptional({ example: '09:00-12:00' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  preferredTimeSlot?: string;

  @ApiProperty({ example: '2024-08-25T09:00:00Z' })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber()
  @Min(15)
  estimatedDurationMinutes?: number;

  @ApiProperty({ example: 'SC-DUBAI-001' })
  @IsUUID()
  serviceCentreId: string;

  @ApiPropertyOptional({ example: 'tech-uuid-here' })
  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @ApiPropertyOptional({ example: 'Customer requested morning slot' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}