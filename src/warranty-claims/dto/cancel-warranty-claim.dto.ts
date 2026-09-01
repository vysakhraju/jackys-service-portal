import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CancelWarrantyClaimDto {
  @ApiProperty({ example: 'Wrong period selected - re-aggregating with the correct dates' })
  @IsString()
  @MinLength(2)
  reason: string;
}
