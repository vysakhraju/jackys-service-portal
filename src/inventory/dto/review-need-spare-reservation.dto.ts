import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NeedSpareReviewDecision } from '../entities/inventory-reservation.entity';

export class ReviewNeedSpareReservationDto {
  @ApiProperty({ enum: NeedSpareReviewDecision, example: NeedSpareReviewDecision.APPROVE })
  @IsEnum(NeedSpareReviewDecision)
  decision: NeedSpareReviewDecision;

  @ApiProperty({ example: 'Confirmed with technician - part is genuinely needed, approving', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
