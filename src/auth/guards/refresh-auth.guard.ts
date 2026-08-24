import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Validates the refresh token (body.refreshToken) via RefreshStrategy ('jwt-refresh')
 * and attaches the resolved User to request.user. Used only on POST /auth/refresh.
 */
@Injectable()
export class RefreshAuthGuard extends AuthGuard('jwt-refresh') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
