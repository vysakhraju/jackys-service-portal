import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../lib/auth';
import { getPendingNeedSpareRequests, reviewNeedSpare } from '../../lib/inventoryApi';
import type { InventoryReservation, NeedSpareReviewDecisionValue } from '../../lib/inventoryTypes';

// Same reviewer roles as InventoryController's own @Roles() on review-need-spare, and the
// same set InventoryGateway admits for the live pop-up - shown here purely so buttons only
// appear for someone who could actually use them, not as a substitute for the server's own
// check (identical convention to InventoryPage.tsx's ReservationRow).
const REVIEW_ROLES = ['SUPER_ADMIN', 'SERVICE_HEAD', 'TECHNICAL_TEAM_LEADER'];

export const PENDING_NEED_SPARE_QUERY_KEY = ['reservations', 'pending-need-spare'] as const;

/**
 * 2026-09-07: closes the gap found live-verifying Mobile Phases 3-4 - a field
 * technician's Need Spare request (mobile app) had genuinely no listing anywhere; a
 * reviewer's only option was Swagger plus a raw SQL lookup to even find the reservation
 * id. This is that missing listing, paired with the same approve/reject action
 * InventoryController.reviewNeedSpare() already exposed. A new toast pop-up
 * (NeedSpareNotifier in AppLayout) tells a reviewer the instant one arrives, wherever
 * they are in the app; this page is where they act on it.
 */
export function NeedSpareReviewPage() {
  const { user } = useAuth();
  const canReview = !!user && REVIEW_ROLES.includes(user.role.name);

  const queryClient = useQueryClient();
  const pendingQuery = useQuery({
    queryKey: PENDING_NEED_SPARE_QUERY_KEY,
    queryFn: getPendingNeedSpareRequests,
    enabled: canReview,
  });

  function onChanged() {
    queryClient.invalidateQueries({ queryKey: PENDING_NEED_SPARE_QUERY_KEY });
  }

  if (!canReview) {
    return (
      <div className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
        Need Spare review is restricted to Technical Team Leader, Service Head, or Super Admin.
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="max-w-2xl text-sm text-slate-500">
        Field technicians&apos; Need Spare requests (mobile app), waiting for a decision.
        Approving moves real stock exactly like reviewing an idle reservation below on the
        Inventory &amp; Stock tab - nothing moves until you act.
      </p>

      {pendingQuery.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {pendingQuery.error && <ErrorNotice error={pendingQuery.error} />}

      {pendingQuery.data && pendingQuery.data.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
          Nothing waiting for review right now.
        </p>
      )}

      {pendingQuery.data && pendingQuery.data.length > 0 && (
        <div className="space-y-2">
          {pendingQuery.data.map((r) => (
            <NeedSpareRow key={r.id} reservation={r} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function NeedSpareRow({ reservation, onChanged }: { reservation: InventoryReservation; onChanged: () => void }) {
  const [reviewed, setReviewed] = useState<InventoryReservation | null>(null);
  const reviewMutation = useMutation({
    mutationFn: (decision: NeedSpareReviewDecisionValue) => reviewNeedSpare(reservation.id, { decision }),
    onSuccess: (r) => {
      setReviewed(r);
      onChanged();
    },
  });

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-xs" data-testid="need-spare-row">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-700">
          {reservation.quantityRequested} × {reservation.sparePart?.name ?? reservation.sparePartId}
          {reservation.sparePart && <span className="ml-1 text-slate-400">({reservation.sparePart.code})</span>}
        </p>
        <StatusBadge status={reservation.status} />
      </div>
      <p className="mt-1 text-slate-500">
        Job card {reservation.jobCard?.jobCardNumber ?? reservation.jobCardId}
        {reservation.requestedBy && (
          <>
            {' '}
            · requested by {reservation.requestedBy.firstName} {reservation.requestedBy.lastName}
          </>
        )}
        {' · '}
        {new Date(reservation.requestedAt).toLocaleString()}
      </p>

      {!reviewed && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => reviewMutation.mutate('APPROVE')}
            disabled={reviewMutation.isPending}
            className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => reviewMutation.mutate('REJECT')}
            disabled={reviewMutation.isPending}
            className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
      <ErrorNotice error={reviewMutation.error} />
      {reviewed && (
        <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-slate-600">
          {reviewed.status === 'HELD'
            ? 'Approved - stock reserved.'
            : reviewed.status === 'PARTIALLY_RESERVED'
              ? `Approved - only ${reviewed.quantityReserved} available, partially reserved.`
              : 'Rejected - the technician can request again if still needed.'}
        </p>
      )}
    </div>
  );
}
