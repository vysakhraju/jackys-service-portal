// Dashboard widget charts (2026-09-15). Color/form choices follow the dataviz skill's
// method (fixed categorical order, one hue for magnitude, status colors reserved and never
// reused for series identity, a legend whenever color carries meaning, direct labels,
// single-axis charts only) - but drawn from THIS APP's own already-shipped Tailwind accent
// set (slate/sky/emerald/amber/red), not the skill's brand-neutral reference hexes, so this
// new page reads as part of the same product as the other 40+ screens rather than an
// imported design system. Every widget is a card that's fully clickable through to the
// existing page that already shows this data in depth (Kanban board / Workshop Queue /
// Operational Reports) - see each component's onOpen/onOpenJob prop.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  JobsByStatusWidget,
  SlaBreachWidget,
  SpareConsumptionWidget,
  WorkshopQueueWidget,
} from '../../lib/dashboardTypes';

// Single hue for magnitude (dataviz "sequential = one hue" rule) - this app's own primary
// accent, reused everywhere else a single-series count needs a color (see StatusBadge/
// LANE_META's own sky usage).
const MAGNITUDE_HUE = '#0284c7'; // sky-600
const STATUS_GOOD = '#059669'; // emerald-600
const STATUS_WARNING = '#d97706'; // amber-600
const STATUS_CRITICAL = '#dc2626'; // red-600

function WidgetCard({
  title,
  subtitle,
  onOpen,
  openLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  onOpen: () => void;
  openLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {openLabel} →
        </button>
      </div>
      {children}
    </div>
  );
}

function TooltipCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-slate-800">{label}</p>
      <p className="text-slate-500">{value}</p>
    </div>
  );
}

export function JobsByStatusChart({ data, onOpenReports }: { data: JobsByStatusWidget; onOpenReports: () => void }) {
  const chartData = data.columns.map((c) => ({ name: c.label, count: c.count }));
  return (
    <WidgetCard
      title="Jobs by Status"
      subtitle={`${data.totalActiveJobs} active job${data.totalActiveJobs === 1 ? '' : 's'} on the board`}
      onOpen={onOpenReports}
      openLabel="Open Job Status Board"
    >
      <div className="h-56 w-full cursor-pointer" onClick={onOpenReports}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={{ stroke: '#cbd5e1' }}
              tickLine={false}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={40}
            />
            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
            <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipCard label={payload[0].payload.name} value={payload[0].value as number} /> : null)} />
            <Bar dataKey="count" fill={MAGNITUDE_HUE} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  );
}

export function WorkshopQueueChart({ data, onOpen }: { data: WorkshopQueueWidget; onOpen: () => void }) {
  const chartData = data.technicians.map((t) => ({
    name: t.name,
    activeCount: t.activeCount,
    capacity: t.capacity,
    overCapacity: t.overCapacity,
    nearCapacity: !t.overCapacity && t.capacity > 0 && t.activeCount / t.capacity >= 0.75,
  }));

  function colorFor(row: (typeof chartData)[number]): string {
    if (row.overCapacity) return STATUS_CRITICAL;
    if (row.nearCapacity) return STATUS_WARNING;
    return STATUS_GOOD;
  }

  return (
    <WidgetCard
      title="Workshop Queue"
      subtitle={`${data.totalActive} active job${data.totalActive === 1 ? '' : 's'} in workshop · ${data.unassignedCount} unassigned`}
      onOpen={onOpen}
      openLabel="Open Workshop Queue"
    >
      {chartData.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No active workshop technicians.</p>
      ) : (
        <>
          <div className="h-48 w-full cursor-pointer" onClick={onOpen}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <TooltipCard label={payload[0].payload.name} value={`${payload[0].value} of ${payload[0].payload.capacity} capacity`} />
                    ) : null
                  }
                />
                <Bar dataKey="activeCount" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {chartData.map((row) => (
                    <Cell key={row.name} fill={colorFor(row)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Color here carries STATE (capacity status), not series identity - the dataviz
              skill's own rule that a status color always ships with a label, never hue alone. */}
          <div className="mt-2 flex gap-3 text-xs text-slate-500">
            <LegendDot color={STATUS_GOOD} label="Normal" />
            <LegendDot color={STATUS_WARNING} label="Near capacity" />
            <LegendDot color={STATUS_CRITICAL} label="Over capacity" />
          </div>
        </>
      )}
    </WidgetCard>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export function SlaBreachCard({
  data,
  onOpen,
  onOpenJob,
}: {
  data: SlaBreachWidget;
  onOpen: () => void;
  onOpenJob: (jobCardId: string) => void;
}) {
  const maxHours = Math.max(1, ...data.topItems.map((i) => i.hoursOverThreshold));
  return (
    <WidgetCard
      title="SLA Breach"
      subtitle={`Past ${data.thresholdHours}h threshold`}
      onOpen={onOpen}
      openLabel="Open Operational Reports"
    >
      <p className="mb-3 text-3xl font-semibold text-slate-900">
        {data.breachedCount}
        <span className="ml-1.5 text-sm font-normal text-slate-400">breached</span>
      </p>
      {data.topItems.length === 0 ? (
        <p className="text-sm text-slate-400">No breaches at this threshold.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.topItems.map((item) => (
            <li key={item.jobCardId}>
              <button
                type="button"
                onClick={() => onOpenJob(item.jobCardId)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-slate-50"
              >
                <span className="w-20 shrink-0 truncate text-xs font-medium text-slate-700">{item.jobCardNumber}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(item.hoursOverThreshold / maxHours) * 100}%`, backgroundColor: STATUS_CRITICAL }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-red-600">
                  +{item.hoursOverThreshold.toFixed(1)}h
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

export function SpareConsumptionChart({ data, onOpen }: { data: SpareConsumptionWidget; onOpen: () => void }) {
  const chartData = data.topByQuantity.map((e) => ({ name: e.code, fullName: e.name, quantity: e.totalQuantity }));
  return (
    <WidgetCard
      title="Spare Parts Consumption"
      subtitle="Top parts by quantity used"
      onOpen={onOpen}
      openLabel="Open Operational Reports"
    >
      {chartData.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No consumption recorded.</p>
      ) : (
        <div className="h-56 w-full cursor-pointer" onClick={onOpen}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                width={60}
              />
              <Tooltip content={({ active, payload }) => (active && payload?.length ? <TooltipCard label={payload[0].payload.fullName} value={payload[0].value as number} /> : null)} />
              <Bar dataKey="quantity" fill={MAGNITUDE_HUE} radius={[0, 4, 4, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
