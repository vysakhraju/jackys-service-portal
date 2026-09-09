import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsBoolean, IsNumber, IsArray, IsObject, IsUUID, MaxLength } from 'class-validator';
import { Country } from '../entities/service-centre.entity';

class DayScheduleDto {
  @ApiProperty() isOpen: boolean;
  @ApiProperty({ example: '09:00' }) startTime: string;
  @ApiProperty({ example: '18:00' }) endTime: string;
  @ApiProperty({ example: '13:00' }) breakStart: string;
  @ApiProperty({ example: '14:00' }) breakEnd: string;
  @ApiProperty({ example: 20 }) maxJobsPerDay: number;
}

export class CreateServiceCentreDto {
  @ApiProperty({ example: 'DXB-01', description: 'Unique short code' })
  @IsString()
  @MaxLength(20)
  code: string;

  @ApiProperty({ example: 'Dubai Service Centre' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: Country })
  @IsEnum(Country)
  country: Country;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  city?: string;

  @ApiProperty({
    required: false,
    description: 'Per-weekday opening hours and daily job capacity, keyed by lowercase weekday name (monday..sunday)',
    example: {
      monday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00', maxJobsPerDay: 20 },
      sunday: { isOpen: false, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00', maxJobsPerDay: 0 },
    },
    type: Object,
  })
  @IsOptional()
  @IsObject()
  schedule?: Record<string, DayScheduleDto>;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  // Catches the exact bug class that crashed the New Appointment scheduling grid with a bare
  // "Internal server error": a non-UUID value saved here reaches TypeORM's In() on a uuid
  // column and Postgres throws "invalid input syntax for type uuid". Reject it at the door
  // instead of letting it get stored and blow up a read path later.
  @IsUUID('4', { each: true })
  assignedTechnicianIds?: string[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false, default: 5.0 })
  @IsOptional()
  @IsNumber()
  vatRate?: number;
}

export class UpdateServiceCentreDto extends PartialType(CreateServiceCentreDto) {}
