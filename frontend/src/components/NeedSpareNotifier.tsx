import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useNeedSpareSocket } from '../lib/useNeedSpareSocket';
import { useToast } from '../lib/toast';
import { showBrowserNotification } from '../lib/browserNotifications';
import { PENDING_NEED_SPARE_QUERY_KEY } from '../pages/inventory/NeedSpareReviewPage';

// Same reviewer roles as NeedSpareReviewPage/InventoryController's own @Roles() on
// review-need-spare, and the roles InventoryGateway itself admits - kept in sync by hand,
// same convention every other role-list constant in this app already follows.
export const REVIEW_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

/**
 * Mounted once, app-wide, inside AppLayout (inside <ToastProvider>) - this is the "force a
 * pop-up wherever the reviewer is in the app" half of the 2026-09-07 Need Spare fix.
 * Renders nothing itself; it just owns the socket connection and turns each newly-arrived
 * request into a toast plus a query invalidation, so NeedSpareReviewPage refreshes on its
 * own if the reviewer happens to already be looking at it. A non-reviewer role never even
 * opens the socket - useNeedSpareSocket no-ops while `enabled` is false.
 */
export function NeedSpareNotifier() {
  const { user } = useAuth();
  const enabled = !!user && REVIEW_ROLES.includes(user.role.name);
  const { push } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useNeedSpareSocket(enabled, (request) => {
    const partLabel = request.sparePart ? `${request.sparePart.name} (${request.sparePart.code})` : 'a spare part';
    const jobCardLabel = request.jobCard?.jobCardNumber ?? request.jobCardId;
    const description = `${request.quantityRequested} × ${partLabel} for job card ${jobCardLabel}`;

    push({
      title: 'New Need Spare request',
      description,
      action: {
        label: 'Review',
        onClick: () => navigate('/workshop-inventory/need-spare'),
      },
    });

    // The OS-level counterpart to the toast above - added 2026-09-09, see
    // browserNotifications.ts. No-ops silently (still leaves the toast doing its job) when
    // the browser/context doesn't support it or the reviewer hasn't granted permission via
    // NotificationPermissionBanner yet. Tagged per-request-id so re-broadcasts of the same
    // still-pending request (see InventoryGateway's poll-and-diff) don't stack duplicate OS
    // notifications - the newest one for that id just replaces the last.
    showBrowserNotification({
      title: 'New Need Spare request',
      body: description,
      tag: `need-spare-${request.id}`,
      onClick: () => navigate('/workshop-inventory/need-spare'),
    });

    queryClient.invalidateQueries({ queryKey: PENDING_NEED_SPARE_QUERY_KEY });
  });

  return null;
}
