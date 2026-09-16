import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, IsUUID } from 'class-validator';

export class CancelAppointmentDto {
  @ApiProperty({ example: 'Customer requested reschedule to next week' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason: string;

  // Appointment/Mobile/Job Card overhaul Phase 3, req. 3f: set only when the cancellation
  // came from the new mobile Cancellation reason dropdown (see Appointment entity's
  // cancellationReasonId doc comment) - CCE's existing web free-text cancel never sends
  // this. No server-side lookup against the CancellationReason master here, matching the
  // established cityId/applianceModelId precedent elsewhere in this service: the FK
  // constraint on save is what rejects a bad id, not an explicit findOne() first.
  @ApiPropertyOptional({ example: 'b3f1e2c4-...-cancellation-reason-id' })
  @IsOptional()
  @IsUUID()
  cancellationReasonId?: string;
}
