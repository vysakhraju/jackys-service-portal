import { IsLatitude, IsLongitude } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartVisitDto {
  @ApiProperty({ example: 25.2048, description: 'GPS latitude captured at visit start' })
  @IsLatitude()
  gpsLat: number;

  @ApiProperty({ example: 55.2708, description: 'GPS longitude captured at visit start' })
  @IsLongitude()
  gpsLng: number;
}
