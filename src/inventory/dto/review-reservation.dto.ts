import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ReviewDecision } from '../entities/inventory-reservation.entity';

export class ReviewReservationDto {
  @ApiProperty({ enum: ReviewDecision, example: ReviewDecision.APPROVE_REALLOCATION })
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @ApiProperty({ example: 'Checked with technician - job stalled this week, reallocating to Main Store', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
