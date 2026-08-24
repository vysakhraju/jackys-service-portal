import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveCustomerDto {
  @ApiProperty({
    required: false,
    description:
      'Notes on how customer approval was obtained. Temporary manual stopgap for FR-06 ' +
      'until the shareable-link/Estimate approval flow (a later phase) exists.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
