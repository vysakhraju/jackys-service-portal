import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetWorkshopCapacityDto {
  @ApiProperty({ example: 6, description: 'Planning-visibility daily capacity for this workshop technician\'s Workshop Queue gauge - never enforced, a technician at or past this number still accepts new assignments and simply queues.' })
  @IsInt()
  @Min(0)
  capacity: number;
}
