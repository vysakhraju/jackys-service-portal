import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { getPublicEstimate, respondToPublicEstimate } from '../../lib/estimatesApi';

// Deliberately outside AppLayout/ProtectedRoute (see App.tsx) - no sidebar, no login
// requirement, no staff branding. This is what a customer sees after tapping the link
// from an SMS/WhatsApp/email. Uses lib/publicApi.ts exclusively (via estimatesApi's
// getPublicEstimate/respondToPublicEstimate) - never the staff `api` client - so nothing
// here can attach a stray bearer token or get redirected to the staff /login screen.
export function EstimatePublicPage() {
  const { token } = useParams<{ token: string }>();
  const [decided, setDecided] = useState<'APPROVED' | 'REJECTED' | null>(null);

  const query = useQuery({
    queryKey: ['public-estimate', token],
    queryFn: () => getPublicEstimate(token!),
    enabled: !!token,
    retry: false,
  });

  const respondMutation = useMutation({
    mutationFn: (approved: boolean) => respondToPublicEstimate(token!, { approved }),
    onSuccess: (_, approved) => setDecided(approved ? 'APPROVED' : 'REJECTED'),
  });

  const status = (query.error as AxiosError)?.response?.status;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-slate-400">
          Jacky's Service Portal — Repair Estimate
        </p>

        {query.isLoading && <p className="text-sm text-slate-500">Loading your estimate…</p>}

        {query.error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {status === 404 && "We couldn't find that estimate link. Please check the link and try again."}
            {status === 410 &&
              "This link is no longer active — it's either expired or already been responded to. Please contact your service centre if you need a new one."}
            {status !== 404 && status !== 410 && 'Something went wrong loading this estimate. Please try again shortly.'}
          </div>
        )}

        {query.data && !decided && (
          <>
            <p className="text-sm text-slate-600">
              Repair estimate for Job Card <span className="font-medium">{query.data.jobCardNumber}</span>
              {query.data.brand ? ` (${query.data.brand})` : ''}
            </p>

            <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-sm text-slate-700">
              {query.data.lineItems.map((li, i) => (
                <li key={i} className="flex justify-between">
                  <span>
                    {li.description} × {li.quantity}
                  </span>
                  <span>{(li.quantity * li.unitPrice).toFixed(2)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span>AED {query.data.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>VAT</span>
                <span>AED {query.data.vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-slate-900">
                <span>Total</span>
                <span>AED {query.data.totalAmount.toFixed(2)}</span>
              </div>
            </div>

            {query.data.tokenExpiresAt && (
              <p className="mt-2 text-xs text-slate-400">
                Please respond by {new Date(query.data.tokenExpiresAt).toLocaleDateString()}.
              </p>
            )}

            {respondMutation.error && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {(respondMutation.error as AxiosError).response?.status === 409
                  ? 'This estimate has already been responded to.'
                  : (respondMutation.error as AxiosError).response?.status === 410
                    ? 'This link has expired.'
                    : 'Something went wrong submitting your response. Please try again.'}
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => respondMutation.mutate(true)}
                disabled={respondMutation.isPending}
                className="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => respondMutation.mutate(false)}
                disabled={respondMutation.isPending}
                className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </>
        )}

        {decided && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {decided === 'APPROVED'
              ? "Thanks — you've approved this estimate. Your service centre will proceed with the repair."
              : "You've declined this estimate. Your service centre will follow up with you."}
          </div>
        )}
      </div>
    </div>
  );
}
