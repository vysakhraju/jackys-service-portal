// Appointment/Mobile/Job Card overhaul Phase 4 (2026-09-16) - see
// claude/APPOINTMENT_MOBILE_JOBCARD_SPEC.md section 3.4. Opened from SchedulePage's
// "Mark Received →" row action (only rendered for a COLLECTED_TO_WS appointment, after the
// CCE/workshop user has verified/updated the appointment's own details in the Edit popup -
// see SchedulePage's openMarkReceived()/openedForIntake). Mirrors FieldVisitsPage's own
// Start Visit -> S/N+warranty -> fault/symptom step shape almost exactly, since
// WorkshopIntake is deliberately the same data, captured here instead of on-site.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ErrorNotice } from '../../components/DataTable';
import { Field, inputClass } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { captureWorkshopFaultSymptom, captureWorkshopSerialNumber, getWorkshopIntake, markWorkshopReceived } from '../../lib/workshopIntakeApi';
import type { Appointment } from '../../lib/appointmentsTypes';

export function WorkshopIntakeModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serialNumber, setSerialNumber] = useState('');
  const [brand, setBrand] = useState(appointment?.brand ?? '');
  const [faultCode, setFaultCode] = useState('');
  const [symptomCode, setSymptomCode] = useState('');

  const {
    data: intake,
    error: intakeError,
    isLoading: intakeLoading,
  } = useQuery({
    queryKey: ['workshop-intake', appointment?.id],
    queryFn: () => getWorkshopIntake(appointment!.id),
    enabled: !!appointment,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['workshop-intake', appointment?.id] });
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
  }

  const receiveMutation = useMutation({
    mutationFn: () => markWorkshopReceived(appointment!.id),
    onSuccess: invalidate,
  });
  const serialMutation = useMutation({
    mutationFn: () => captureWorkshopSerialNumber(appointment!.id, { serialNumber, brand: brand || undefined }),
    onSuccess: invalidate,
  });
  const faultMutation = useMutation({
    mutationFn: () => captureWorkshopFaultSymptom(appointment!.id, { faultCode, symptomCode }),
    onSuccess: invalidate,
  });

  if (!appointment) return null;
  const ready = !!(intake?.serialNumber && intake?.warrantyStatus && intake?.faultCode && intake?.symptomCode);

  return (
    <Modal open={!!appointment} onClose={onClose} title={`Workshop intake — ${appointment.appointmentNumber}`}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-500">
          {appointment.customerName} · {[appointment.brand, appointment.modelNumber].filter(Boolean).join(' / ') || 'Brand/model not on file'}
        </p>

        {intakeLoading && <p className="text-slate-400">Loading…</p>}
        {intakeError && <ErrorNotice error={intakeError} />}

        {/* Step 1: Mark Received */}
        {!intake && !intakeLoading && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 1 · Mark received</p>
            <p className="text-slate-500">Confirm the unit has physically arrived at the workshop.</p>
            <ErrorNotice error={receiveMutation.error} />
            <button
              onClick={() => receiveMutation.mutate()}
              disabled={receiveMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Mark received
            </button>
          </div>
        )}

        {/* Step 2: serial number + warranty */}
        {intake && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 2 · Serial number + warranty check</p>
            {intake.serialNumber && (
              <p className="text-slate-700">
                Captured: <span className="font-medium">{intake.serialNumber}</span>{' '}
                {intake.warrantyStatus && <StatusBadge status={intake.warrantyStatus} />}
                {intake.warrantySupplier && <span className="ml-2 text-xs text-slate-400">Supplier: {intake.warrantySupplier}</span>}
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
                {intake.serialNumber ? 'Re-capture' : 'Capture'}
              </button>
            </div>
            {intake.serialNumber && (
              <p className="text-xs text-slate-400">
                Re-capturing clears any fault/symptom already recorded below (the backend
                requires the current, validated S/N before fault/symptom can be recorded).
              </p>
            )}
          </div>
        )}

        {/* Step 3: fault + symptom */}
        {intake && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 3 · Fault + symptom codes</p>
            {intake.faultCode && (
              <p className="text-slate-700">
                Captured: <span className="font-medium">{intake.faultCode}</span> / <span className="font-medium">{intake.symptomCode}</span>
              </p>
            )}
            <ErrorNotice error={faultMutation.error} />
            {!intake.serialNumber ? (
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
                  {intake.faultCode ? 'Re-capture' : 'Capture'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: hand off to Job Cards, once everything's captured */}
        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Step 4 · Create Job Card</p>
          {!ready ? (
            <p className="mt-1 text-slate-400">Complete steps 1-3 above first.</p>
          ) : (
            <Link
              to={`/job-cards?appointmentId=${appointment.id}`}
              onClick={onClose}
              className="mt-2 block rounded-md bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-700"
            >
              Continue to Job Cards →
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}
