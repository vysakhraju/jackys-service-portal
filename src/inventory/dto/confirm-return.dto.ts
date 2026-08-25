import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ConfirmReturnDto {
  @ApiProperty({ example: 2, description: 'Quantity physically received back at Main Store' })
  @IsInt()
  @Min(1)
  quantityReturned: number;
}
