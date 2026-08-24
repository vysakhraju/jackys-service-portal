import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { JobCardSection } from '../entities/job-card.entity';

export class AssignSectionDto {
  @ApiProperty({ enum: JobCardSection })
  @IsEnum(JobCardSection)
  section: JobCardSection;
}
