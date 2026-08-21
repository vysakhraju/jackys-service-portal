import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '../../auth/entities/audit-log.entity';

export const AUDIT_KEY = 'audit';

export interface AuditConfig {
  action: AuditAction;
  entityType: string;
  getEntityId?: (args: any) => string;
  getOldValues?: (args: any) => Record<string, any>;
  getNewValues?: (result: any) => Record<string, any>;
}

export const Audit = (config: AuditConfig) => SetMetadata(AUDIT_KEY, config);