import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TaskPauseReason } from '../entities/job-card-task-pause.entity';

export class PauseTaskDto {
  @ApiProperty({ enum: TaskPauseReason, description: 'Why the task timer is being paused' })
  @IsEnum(TaskPauseReason)
  reason: TaskPauseReason;

  @ApiPropertyOptional({ description: 'Optional free-text detail (e.g. which part, or why the customer is unavailable)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
