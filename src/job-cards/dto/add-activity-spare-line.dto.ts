import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

export class AddActivitySpareLineDto {
  @ApiProperty({ example: '3b1c...-uuid' })
  @IsUUID()
  sparePartId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity: number;
}
