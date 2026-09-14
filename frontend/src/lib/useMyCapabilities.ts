// Live-tested finding (2026-09-14): pages that render an admin UI gated by
// @RequiresCapability() server-side (Master Data chief among them) had no client-side
// idea whether the current user actually held that capability - a CCE could open the
// Master Data > Service Centres tab and see the full list plus Create/Edit/Delete
// buttons, and only find out those actions were blocked (or, for Delete, always were -
// it's SUPER_ADMIN-only and was never in the matrix) after clicking and hitting a 403.
// This hook is the shared client-side mirror of RolesGuard's own check, backed by
// GET /permissions/my-capabilities - a fresh DB read every time (same as the guard),
// never cached across a grant, so an admin ticking a box in Designation access is
// reflected here the next time this query refetches, no re-login needed.
import { useQuery } from '@tanstack/react-query';
import { getMyCapabilities } from './rolePermissionsApi';

export function useMyCapabilities() {
  const query = useQuery({
    queryKey: ['my-capabilities'],
    queryFn: getMyCapabilities,
    staleTime: 30_000,
  });

  const fullAccess = query.data?.fullAccess ?? false;
  const capabilities = query.data?.capabilities ?? [];

  return {
    loading: query.isLoading,
    error: query.error,
    fullAccess,
    capabilities,
    /** True if the user has this exact capability (or holds full access). */
    has: (key: string) => fullAccess || capabilities.includes(key),
    /** True if the user has ANY of these capabilities (or holds full access). */
    hasAny: (keys: string[]) => fullAccess || keys.some((k) => capabilities.includes(k)),
  };
}
