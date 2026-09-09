import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AssignTechnicianDto {
  @ApiProperty({ example: '3f1b2c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', description: 'User ID of the technician to assign' })
  @IsUUID()
  technicianId: string;

  // Optional (2026-09-09, Technician Assignment Board drag-and-drop): lets the caller set
  // the appointment's time in the SAME call that assigns the technician, so a fresh
  // assignment never has to be a technicianId-then-scheduledAt two-call sequence - a
  // partial failure between those two calls would leave the appointment assigned to a
  // technician but still sitting on its old (often wrong-looking) time. When present,
  // capacity is re-checked against this new time exactly as update() already does.
  @ApiPropertyOptional({ example: '2026-09-09T09:00:00Z', description: 'Optionally set the scheduled time in the same call' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
