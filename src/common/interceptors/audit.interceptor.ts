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
    // NOTE: context.getArgs() returns the raw platform handler args ([request, response,
    // next] for Express/HTTP) - NOT the decorated controller method's resolved parameters
    // (@Param/@Body/@CurrentUser etc). Passing that raw request object straight into a
    // getEntityId/getOldValues lambda either silently returns undefined (if the lambda
    // does `args[0]?.someProp`, since Request has no such prop) or, worse, assigns the
    // entire circular Request object as the value (if the lambda does `args[0]`
    // directly) - which then throws "Converting circular structure to JSON" when TypeORM
    // tries to save it, silently dropping the whole audit row (caught by the try/catch
    // below with no visible failure to the caller). Every @Audit call site in this
    // codebase is written against these named fields instead.
    const args = { params: req.params, body: req.body, query: req.query, user: req.user };

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