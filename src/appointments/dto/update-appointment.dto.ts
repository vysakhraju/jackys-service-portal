import { PartialType } from '@nestjs/swagger';
import { CreateAppointmentDto } from './create-appointment.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsString, IsUUID, MaxLength } from 'class-validator';
import { AppointmentStatus } from '../entities/appointment.entity';

export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ example: 'Customer not available' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancellationReason?: string;

  @ApiPropertyOptional({ example: 'tech-uuid-here' })
  @IsOptional()
  @IsUUID()
  technicianId?: string;
}