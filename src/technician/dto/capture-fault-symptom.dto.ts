import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CaptureFaultSymptomDto {
  @ApiProperty({ example: 'F001' })
  @IsString()
  @MaxLength(20)
  faultCode: string;

  @ApiProperty({ example: 'S001' })
  @IsString()
  @MaxLength(20)
  symptomCode: string;
}
