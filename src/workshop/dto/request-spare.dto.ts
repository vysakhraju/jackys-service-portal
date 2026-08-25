import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class RequestSpareDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456' })
  @IsUUID()
  sparePartId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  // Phase 6 rework gate: required ONLY if this exact spare part was already
  // requested/reserved once before on this exact Job Card AND the job has a prior QC
  // rejection (a same-part rework re-request) - otherwise ignored entirely. Must be a
  // user holding an active REWORK_APPROVAL grant, and must NOT be the same person making
  // this request (hard-enforced at the service layer - "the person asking for the extra
  // parts cannot be the person who clicks approve"). Leave unset and use
  // verbalOverrideBy/verbalOverrideNotes instead if no such approver is reachable.
  @ApiProperty({
    required: false,
    description: 'Rework re-request only: a different user holding the REWORK_APPROVAL grant who is signing off on consuming this part again',
  })
  @IsOptional()
  @IsUUID()
  approverId?: string;

  @ApiProperty({
    required: false,
    description: 'Rework re-request only: fallback when no REWORK_APPROVAL holder is reachable - name/identifier of who gave verbal approval',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  verbalOverrideBy?: string;

  @ApiProperty({
    required: false,
    description: 'Rework re-request only: required alongside verbalOverrideBy - the circumstances of the verbal approval, for the audit trail',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  verbalOverrideNotes?: string;
}
