import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CancelAmcContractDto {
  @ApiProperty({ example: 'Customer requested early termination' })
  @IsString()
  @MinLength(3)
  reason: string;
}
