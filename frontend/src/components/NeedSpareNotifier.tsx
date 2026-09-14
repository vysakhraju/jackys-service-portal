import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useMyCapabilities } from '../lib/useMyCapabilities';
import { useNeedSpareSocket } from '../lib/useNeedSpareSocket';
import { useToast } from '../lib/toast';
import { showBrowserNotification } from '../lib/browserNotifications';
import { PENDING_NEED_SPARE_QUERY_KEY } from '../pages/inventory/NeedSpareReviewPage';

/**
 * Mounted once, app-wide, inside AppLayout (inside <ToastProvider>) - this is the "force a
 * pop-up wherever the reviewer is in the app" half of the 2026-09-07 Need Spare fix.
 * Renders nothing itself; it just owns the socket connection and turns each newly-arrived
 * request into a toast plus a query invalidation, so NeedSpareReviewPage refreshes on its
 * own if the reviewer happens to already be looking at it. A non-reviewer role never even
 * opens the socket - useNeedSpareSocket no-ops while `enabled` is false.
 *
 * 2026-09-14 (Group C): was gated on a hardcoded REVIEW_ROLES = ['SUPER_ADMIN',
 * 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'] array, same shape as (and kept in sync by hand
 * with) InventoryGateway's own old VIEW_ROLES on the backend - a Designation-access grant
 * of INVENTORY_REVIEW to some other role would pass NeedSpareReviewPage's already-real
 * useMyCapabilities() gate (see that page's own comment) but never even open this socket to
 * find out, since this component never checked the matrix at all. Now gated on the same
 * real INVENTORY_REVIEW capability the review page and (as of this round) the backend
 * gateway itself both check, so all three stay in lockstep with whatever Designation access
 * actually grants.
 */
export function NeedSpareNotifier() {
  const { has } = useMyCapabilities();
  const enabled = has('INVENTORY_REVIEW');
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
