import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EstimateLineItemDto } from './create-estimate.dto';

export class ReviseEstimateDto {
  @ApiProperty({
    required: false,
    type: [EstimateLineItemDto],
    description: "New line items for the revised estimate. Omit to reuse the rejected estimate's line items unchanged.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EstimateLineItemDto)
  lineItems?: EstimateLineItemDto[];
}
