import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export enum PermissionType {
  // Gates JobCardsController's qc/approve and qc/reject endpoints. Admin-assignable to
  // any user regardless of their primary role (QC_OFFICER, TECHNICAL_TEAM_LEADER, CCE,
  // etc.) - the whole point of this table is that "who can QC-approve" is a runtime,
  // per-person configuration, not a hardcoded @Roles() list.
  QC_APPROVAL = 'QC_APPROVAL',
  // Gates WorkshopService.requestSpare() when the SAME spare part is being re-requested
  // on the SAME Job Card (a rework re-request after a QC rejection). Deliberately a
  // separate grant from QC_APPROVAL - the person who can sign off on "yes, consume this
  // part again" is not necessarily the same person who can pass the finished job.
  REWORK_APPROVAL = 'REWORK_APPROVAL',
}

@Entity('user_permission_grants')
@Index(['userId', 'permissionType'])
export class UserPermissionGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: PermissionType })
  permissionType: PermissionType;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'grantedByUserId' })
  grantedBy: User;

  @Column({ type: 'uuid' })
  grantedByUserId: string;

  @CreateDateColumn()
  grantedAt: Date;

  // Grants are never deleted - revoking sets these instead, so "who could approve QC on
  // <date>" stays answerable forever. hasActiveGrant()/requireActiveGrant() only treat a
  // grant as active when revokedAt IS NULL.
  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'revokedByUserId' })
  revokedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  revokedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
