import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CancelDismantlingRecordDto {
  @ApiProperty({ example: 'No salvageable components after inspection - unit scrapped in full' })
  @IsString()
  @MinLength(3)
  reason: string;
}
