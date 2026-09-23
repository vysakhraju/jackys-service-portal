import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JobType } from '../entities/appointment.entity';

// Job Type split (2026-09-22) Phase 7 - the field technician's on-site "Correct Job
// Type" action (mobile). Deliberately excludes MAINTENANCE: Phase 6 already soft-hid it
// from every NEW-pick dropdown (it stays a valid, unremoved value only on the 2
// pre-existing appointments that already had it before that decision), so a technician
// correcting a mis-picked Job Type must never be able to introduce a fresh MAINTENANCE
// value onto a different appointment. Kept as its own small list here rather than
// importing ACTIVE_JOB_TYPES (that constant only exists on the frontend today) - if a
// second backend call site ever needs the same list, promote this to a shared export.
export const CORRECTABLE_JOB_TYPES = [
  JobType.REPAIR,
  JobType.INSTALLATION,
  JobType.DELIVERY_INSTALLATION,
] as const;

export class CorrectJobTypeDto {
  @ApiProperty({ enum: CORRECTABLE_JOB_TYPES, example: JobType.INSTALLATION })
  @IsIn(CORRECTABLE_JOB_TYPES)
  jobType: JobType;
}
