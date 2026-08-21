import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { AUDIT_KEY } from '../decorators/audit.decorator';
import { AuditAction } from '../../auth/entities/audit-log.entity';
import { AuthService } from '../../auth/auth.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private authService: AuthService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditConfig = this.reflector.getAllAndOverride<{
      action: AuditAction;
      entityType: string;
      getEntityId: (args: any) => string;
      getOldValues: (args: any) => Record<string, any>;
      getNewValues: (result: any) => Record<string, any>;
    }>(AUDIT_KEY, [context.getHandler(), context.getClass()]);

    if (!auditConfig) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const args = context.getArgs();

    return next.handle().pipe(
      tap(async (result) => {
        try {
          const entityId = auditConfig.getEntityId ? auditConfig.getEntityId(args) : null;
          const oldValues = auditConfig.getOldValues ? auditConfig.getOldValues(args) : null;
          const newValues = auditConfig.getNewValues ? auditConfig.getNewValues(result) : null;

          await this.authService.logAudit(
            req.user,
            auditConfig.action,
            auditConfig.entityType,
            entityId,
            oldValues,
            newValues,
            req,
          );
        } catch (error) {
          console.error('Audit interceptor failed:', error);
        }
      }),
    );
  }
}