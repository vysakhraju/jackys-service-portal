import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDismantlingRecordDto {
  @ApiProperty({ example: 'SN-000987', description: 'Serial number of the defective/DOA appliance sitting in Damage Location' })
  @IsString()
  @MinLength(2)
  applianceSerialNumber: string;

  @ApiProperty({ example: 'M100', description: 'Model ID - used to look up the original BOM via ComponentYieldMatrix at harvest time' })
  @IsString()
  @MinLength(1)
  modelId: string;

  @ApiProperty({ required: false, example: 'Confirmed DOA, water damage, in Damage Location bay 3' })
  @IsOptional()
  @IsString()
  damageLocationNotes?: string;
}
