import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DataTable, ErrorNotice, type Column } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { useAuth } from '../../lib/auth';
import { getExpiringAmcContracts, sendAmcRenewalReminder } from '../../lib/amcApi';
import { amcPermissions, type AmcContract } from '../../lib/amcTypes';

// The manual companion to GET .../expiring + POST .../send-renewal-reminder - this app has
// no cron/scheduler infrastructure to auto-fire the BRD's "30 days before expiry" reminder,
// so a human works this list instead. the-fool pre-mortem finding #4: this used to be a
// read-only dead end (see who's expiring, then go hunt for them again in the Contracts tab
// to actually send anything) - each row now sends the reminder right here, plus a direct
// link into the full contract detail.
export function ExpiringContractsPage() {
  const { user } = useAuth();
  const perms = amcPermissions(user?.role.name);
  const queryClient = useQueryClient();
  // Two pieces of state so the field can be cleared and retyped without snapping back to
  // the default mid-edit: withinDaysInput is exactly what's shown in the box; withinDays
  // (the query's actual param) only updates once the typed value parses to a valid
  // positive integer.
  const [withinDaysInput, setWithinDaysInput] = useState('30');
  const [withinDays, setWithinDays] = useState(30);
  const [sentFor, setSentFor] = useState<Record<string, { attempted: string[]; delivered: string[] }>>({});

  const query = useQuery({
    queryKey: ['amc-expiring', withinDays],
    queryFn: () => getExpiringAmcContracts(withinDays),
  });

  const reminderMutation = useMutation({
    mutationFn: (id: string) => sendAmcRenewalReminder(id),
    onSuccess: (result, id) => {
      setSentFor((s) => ({ ...s, [id]: result }));
      queryClient.invalidateQueries({ queryKey: ['amc-expiring'] });
    },
  });

  const columns: Column<AmcContract>[] = [
    { key: 'contractNumber', label: 'Contract #', render: (c) => <span className="font-medium text-slate-900">{c.contractNumber}</span> },
    { key: 'customer', label: 'Customer', render: (c) => (
      <div>
        <div className="text-slate-900">{c.customerName}</div>
        <div className="text-xs text-slate-400">{c.customerPhone}</div>
      </div>
    ) },
    { key: 'endDate', label: 'Expires', render: (c) => {
      const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000);
      return <span>{new Date(c.endDate).toLocaleDateString()} <span className="text-xs text-slate-400">({daysLeft} day{daysLeft === 1 ? '' : 's'})</span></span>;
    } },
    { key: 'reminder', label: 'Last reminder', render: (c) => (c.renewalReminderSentAt ? new Date(c.renewalReminderSentAt).toLocaleDateString() : 'Never sent') },
  ];

  return (
    <div className="max-w-4xl space-y-4">
      <Field label="Within days">
        <input
          type="number"
          min={1}
          className={`${inputClass} w-24`}
          value={withinDaysInput}
          onChange={(e) => {
            const raw = e.target.value;
            setWithinDaysInput(raw);
            const parsed = Number(raw);
            if (raw !== '' && Number.isFinite(parsed) && parsed >= 1) {
              setWithinDays(Math.floor(parsed));
            }
          }}
        />
      </Field>

      <DataTable
        columns={columns}
        rows={query.data}
        isLoading={query.isLoading}
        error={query.error}
        emptyMessage={`No ACTIVE contracts expiring within ${withinDays} days.`}
        rowActions={(c) => (
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-2">
              <Link
                to={`/amc/contracts?contractId=${c.id}`}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                View
              </Link>
              {perms.canManage && (
                <button
                  onClick={() => reminderMutation.mutate(c.id)}
                  disabled={reminderMutation.isPending}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Send reminder
                </button>
              )}
            </div>
            {sentFor[c.id] && (
              <span className="text-[10px] text-emerald-700">
                Sent via {sentFor[c.id].attempted.join(', ') || 'no channels'}
              </span>
            )}
          </div>
        )}
      />
      <ErrorNotice error={reminderMutation.error} />
    </div>
  );
}
