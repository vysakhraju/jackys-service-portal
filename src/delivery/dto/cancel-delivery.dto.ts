import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class CancelDeliveryDto {
  @ApiProperty({ example: 'Wrong job cards batched together - re-creating', minLength: 3, maxLength: 255 })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason: string;
}
