import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '../../auth/entities/audit-log.entity';

export const AUDIT_KEY = 'audit';

export interface AuditRequestArgs {
  params: Record<string, string>;
  body: Record<string, any>;
  query: Record<string, any>;
  user: any;
}

export interface AuditConfig {
  action: AuditAction;
  entityType: string;
  // Receives { params, body, query, user } from the raw HTTP request - NOT the
  // decorated controller method's resolved parameters. See AuditInterceptor for why.
  getEntityId?: (args: AuditRequestArgs) => string;
  getOldValues?: (args: AuditRequestArgs) => Record<string, any>;
  getNewValues?: (result: any) => Record<string, any>;
}

export const Audit = (config: AuditConfig) => SetMetadata(AUDIT_KEY, config);