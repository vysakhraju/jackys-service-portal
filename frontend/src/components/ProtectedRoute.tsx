import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/**
 * Gates every route nested under it: unauthenticated visitors bounce to
 * /login. Optionally restrict to a set of role names (matching the backend's
 * RoleName enum, e.g. "SUPER_ADMIN") — omit it to just require any logged-in
 * user, which is what most screens need.
 */
export function ProtectedRoute({ allowedRoles }: { allowedRoles?: string[] }) {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role.name)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-slate-600">
        <p className="text-lg font-semibold">You don't have access to this page</p>
        <p className="text-sm">
          Your role ({user.role.displayName}) isn't permitted here.
        </p>
      </div>
    );
  }

  return <Outlet />;
}
