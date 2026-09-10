import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class SetRoleCapabilitiesDto {
  @ApiProperty({
    type: [String],
    example: ['SCHEDULE_CCE_MANAGE', 'QC_GATE_ACCESS'],
    description: "The role's complete new set of migrated capability keys - anything currently held that is missing from this list is revoked, anything new is granted. An empty array clears every capability the role holds.",
  })
  @IsArray()
  @IsString({ each: true })
  capabilityKeys: string[];
}
