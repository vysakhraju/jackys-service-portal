import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TaskPauseReason } from '../entities/appointment-activity-pause.entity';

// Job Type split (2026-09-22) Phase 8 - mirrors job-cards/dto/pause-task.dto.ts exactly
// (same reason enum, same optional free-text notes) for the Installation/Delivery
// Installation Start Work/Pause/Resume/Activity Finished flow's own pause step.
export class PauseAppointmentActivityDto {
  @ApiProperty({ enum: TaskPauseReason, description: 'Why work is pausing (e.g. carrying the job forward to the next day)' })
  @IsEnum(TaskPauseReason)
  reason: TaskPauseReason;

  @ApiPropertyOptional({ description: 'Optional free-text detail' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
