import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { captureFaultSymptom, captureSerialNumber, getMyTechnicianSchedule, getVisit, startVisit } from '../../lib/appointmentsApi';
import type { Appointment } from '../../lib/appointmentsTypes';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Wraps the browser Geolocation API in a promise so "Start Visit" can await a real
// position - falls back to manual entry (below) if the browser denies/lacks it, since
// StartVisitDto requires gpsLat/gpsLng either way.
function getBrowserPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 8000 },
    );
  });
}

export function FieldVisitsPage() {
  const [date, setDate] = useState(todayIso());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['technician-schedule', date],
    queryFn: () => getMyTechnicianSchedule(date),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-slate-500">
          Your own day, from <code>GET /technician/schedule</code> — only appointments
          assigned to whoever is logged in, the same call the real mobile flow would use.
          Only appointments still in progress (not yet completed/cancelled) show up here.
        </p>
        <Field label="Date">
          <input
            type="date"
            className={`${inputClass} w-40`}
            value={date}
            onChange={(e) => {
              setExpandedId(null);
              setDate(e.target.value);
            }}
          />
        </Field>
      </div>

      {isLoading && <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">Loading…</div>}
      {error ? <ErrorNotice error={error} /> : null}
      {data && data.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          Nothing on your schedule for this date.
        </div>
      )}

      <div className="space-y-3">
        {data?.map((appt) => (
          <VisitCard
            key={appt.id}
            appointment={appt}
            expanded={expandedId === appt.id}
            onToggle={() => setExpandedId((cur) => (cur === appt.id ? null : appt.id))}
          />
        ))}
      </div>
    </div>
  );
}

function VisitCard({ appointment, expanded, onToggle }: { appointment: Appointment; expanded: boolean; onToggle: () => void }) {
  const queryClient = useQueryClient();
  const [gpsLat, setGpsLat] = useState('');
  const [gpsLng, setGpsLng] = useState('');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [serialNumber, setSerialNumber] = useState('');
  const [brand, setBrand] = useState(appointment.brand ?? '');
  const [faultCode, setFaultCode] = useState('');
  const [symptomCode, setSymptomCode] = useState('');

  const {
    data: visit,
    error: visitError,
    isLoading: visitLoading,
  } = useQuery({
    queryKey: ['technician-visit', appointment.id],
    queryFn: () => getVisit(appointment.id),
    enabled: expanded,
    retry: false,
  });
  const visitNotFound = (visitError as AxiosError)?.response?.status === 404;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['technician-visit', appointment.id] });
    queryClient.invalidateQueries({ queryKey: ['technician-schedule'] });
  }

  const startMutation = useMutation({
    mutationFn: (input: { gpsLat: number; gpsLng: number }) => startVisit(appointment.id, input),
    onSuccess: invalidate,
  });
  const serialMutation = useMutation({
    mutationFn: () => captureSerialNumber(appointment.id, { serialNumber, brand: brand || undefined }),
    onSuccess: invalidate,
  });
  const faultMutation = useMutation({
    mutationFn: () => captureFaultSymptom(appointment.id, { faultCode, symptomCode }),
    onSuccess: invalidate,
  });

  async function handleUseMyLocation() {
    setGpsError(null);
    setLocating(true);
    try {
      const pos = await getBrowserPosition();
      setGpsLat(String(pos.lat));
      setGpsLng(String(pos.lng));
    } catch (err) {
      setGpsError((err as Error).message || 'Could not get your location — enter it manually below.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div>
          <p className="text-sm font-medium text-slate-900">{appointment.appointmentNumber} · {appointment.customerName}</p>
          <p className="text-xs text-slate-400">{new Date(appointment.scheduledAt).toLocaleString()} · {appointment.serviceCentre?.name ?? appointment.serviceCentreId}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={appointment.status} />
          <span className="text-xs text-slate-400">{expanded ? 'Hide' : 'Open'}</span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-slate-200 px-4 py-4">
          {visitLoading && <p className="text-sm text-slate-400">Loading visit…</p>}
          {visitError && !visitNotFound && <ErrorNotice error={visitError} />}

          {/* Step 1: start visit */}
          {(visitNotFound || !visit) && (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 1 · Start visit (captures GPS + time)</p>
              <ErrorNotice error={startMutation.error} />
              {gpsError && <p className="text-xs text-amber-600">{gpsError}</p>}
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={locating}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {locating ? 'Locating…' : 'Use my location'}
                </button>
                <Field label="Latitude">
                  <input className={`${inputClass} w-32`} value={gpsLat} onChange={(e) => setGpsLat(e.target.value)} placeholder="25.2048" />
                </Field>
                <Field label="Longitude">
                  <input className={`${inputClass} w-32`} value={gpsLng} onChange={(e) => setGpsLng(e.target.value)} placeholder="55.2708" />
                </Field>
                <button
                  disabled={!gpsLat || !gpsLng || startMutation.isPending}
                  onClick={() => startMutation.mutate({ gpsLat: Number(gpsLat), gpsLng: Number(gpsLng) })}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Start visit
                </button>
              </div>
            </div>
          )}

          {/* Step 2: serial number + warranty */}
          {visit && (
            <div className="space-y-3 border-t border-slate-100 pt-4 first:border-0 first:pt-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 2 · Serial number + warranty check</p>
              {visit.serialNumber && (
                <p className="text-sm text-slate-700">
                  Captured: <span className="font-medium">{visit.serialNumber}</span>{' '}
                  {visit.warrantyStatus && <StatusBadge status={visit.warrantyStatus} />}
                  {visit.warrantySupplier && <span className="ml-2 text-xs text-slate-400">Supplier: {visit.warrantySupplier}</span>}
                </p>
              )}
              <ErrorNotice error={serialMutation.error} />
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Serial number">
                  <input className={`${inputClass} w-48`} value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
                </Field>
                <Field label="Brand (optional)">
                  <input className={`${inputClass} w-36`} value={brand} onChange={(e) => setBrand(e.target.value)} />
                </Field>
                <button
                  disabled={!serialNumber || serialMutation.isPending}
                  onClick={() => serialMutation.mutate()}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {visit.serialNumber ? 'Re-capture' : 'Capture'}
                </button>
              </div>
              {visit.serialNumber && (
                <p className="text-xs text-slate-400">
                  Re-capturing clears any fault/symptom already recorded below (the backend
                  requires the current, validated S/N before fault/symptom can be recorded).
                </p>
              )}
            </div>
          )}

          {/* Step 3: fault + symptom */}
          {visit && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 3 · Fault + symptom codes</p>
              {visit.faultCode && (
                <p className="text-sm text-slate-700">
                  Captured: <span className="font-medium">{visit.faultCode}</span> / <span className="font-medium">{visit.symptomCode}</span>
                </p>
              )}
              <ErrorNotice error={faultMutation.error} />
              {!visit.serialNumber ? (
                <p className="text-xs text-slate-400">Capture the serial number first — the backend blocks this until then.</p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Fault code">
                    <input className={`${inputClass} w-32`} value={faultCode} onChange={(e) => setFaultCode(e.target.value)} placeholder="F001" />
                  </Field>
                  <Field label="Symptom code">
                    <input className={`${inputClass} w-32`} value={symptomCode} onChange={(e) => setSymptomCode(e.target.value)} placeholder="S001" />
                  </Field>
                  <button
                    disabled={!faultCode || !symptomCode || faultMutation.isPending}
                    onClick={() => faultMutation.mutate()}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {visit.faultCode ? 'Re-capture' : 'Capture'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
