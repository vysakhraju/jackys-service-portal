// Phase 4: the offline action queue (NFR-03), per docs/planning/MOBILE_APP_SCOPE_v1.md §5.
// This module is the storage + replay engine only - deliberately free of React so it can
// be unit-tested in isolation (the "spike" the scope doc asks for: prove the mechanism
// works before trusting it everywhere) before any UI is wired on top of it.
//
// Design, matching §5 + the 2026-09-04 decision on replay failures:
// - Every write action from Phases 2-3 (Start Visit, capture serial number, capture
//   fault/symptom) can be enqueued instead of sent immediately. Reads (schedule, visit
//   status) are NOT queued here - they just use react-query's normal in-memory cache,
//   per §5's "reads... just a local cache for display."
// - A queued item carries a client-generated id, a client timestamp (for the "last
//   write wins" rule NFR-03 asks for), and starts 'pending'.
// - Replaying it can fail two different ways, and they're handled differently:
//   - A NETWORK failure (the request never reached the backend at all) leaves the item
//     'pending' and stops the sync run there - if connectivity just dropped, the rest
//     of the queue will fail identically, so there's no point hammering every item.
//     Nothing is shown to the technician; from their side this still just reads
//     "queued, will sync when back online."
//   - A BACKEND rejection (a real response came back - 400/403/404/409, e.g. the
//     appointment was reassigned or cancelled while offline) marks the item 'failed'
//     with the extracted message and moves on to the next item. Per the 2026-09-04
//     decision, this is surfaced to the technician to dismiss or retry - it is NOT
//     retried automatically, since retrying a real rejection forever would never
//     succeed on its own.
// - Enqueuing dedupes on {type, appointmentId}: a fresh action targeting the same
//   appointment replaces whatever was already queued (pending OR failed) for it,
//   rather than piling up duplicates - this is "last write wins" applied client-side,
//   before the item ever reaches the server.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAxiosError } from 'axios';
import { captureFaultSymptom, captureSerialNumber, completeVisit, requestNeedSpare, startVisit } from './technicianApi';
import type {
  CaptureFaultSymptomInput,
  CaptureSerialNumberInput,
  CompleteVisitInput,
  NeedSpareInput,
  StartVisitInput,
} from './types';

const STORAGE_KEY = '@jackys/offline-queue';

// Mobile Phase 5 adds NEED_SPARE and COMPLETE_VISIT to the same queue engine Phase 4
// built for Start Visit/Serial Number/Fault-Symptom - same storage, same replay/dedup
// rules. NEED_SPARE's payload carries its own idempotencyKey (generated once by the
// screen at enqueue time, NOT here) - a queued item's payload never changes once
// enqueued, so every retry of the SAME queued action replays with that SAME key, and the
// (jobCardId, idempotencyKey) unique index on the backend correctly treats it as one
// retried request rather than a second one. A genuinely new "Need Spare" tap always goes
// through enqueueAction() again with a freshly generated key, which (per the dedup rule
// below) replaces whatever NEED_SPARE item was already queued for this appointment -
// exactly one open Need Spare request queued per appointment at a time, matching how the
// other three action types already work.
export type QueuedActionType =
  | 'START_VISIT'
  | 'CAPTURE_SERIAL_NUMBER'
  | 'CAPTURE_FAULT_SYMPTOM'
  | 'NEED_SPARE'
  | 'COMPLETE_VISIT';

type PayloadFor<T extends QueuedActionType> = T extends 'START_VISIT'
  ? StartVisitInput
  : T extends 'CAPTURE_SERIAL_NUMBER'
    ? CaptureSerialNumberInput
    : T extends 'CAPTURE_FAULT_SYMPTOM'
      ? CaptureFaultSymptomInput
      : T extends 'NEED_SPARE'
        ? NeedSpareInput
        : CompleteVisitInput;

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  appointmentId: string;
  // Display-only, e.g. "Fatima Al Sayed (APT-0001)" - captured from the screen that
  // enqueued this action, since the queue engine itself only knows the appointmentId.
  // Not sent to the backend.
  label: string;
  payload: StartVisitInput | CaptureSerialNumberInput | CaptureFaultSymptomInput | NeedSpareInput | CompleteVisitInput;
  clientTimestamp: string;
  status: 'pending' | 'failed';
  errorMessage: string | null;
  attempts: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Mobile Phase 5: exported so the appointment detail screen can generate ONE
// idempotencyKey right when the technician taps "Need Spare" (before it's known whether
// this goes straight to the backend or into the offline queue) - same generator shape
// as generateId() above, just exposed under its own name so a NeedSpareInput's key
// doesn't get confused with a QueuedAction's own id.
export function generateIdempotencyKey(): string {
  return `need-spare-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupted entry shouldn't crash the whole queue - drop it rather than throw.
    return [];
  }
}

async function saveQueue(items: QueuedAction[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function enqueueAction<T extends QueuedActionType>(input: {
  type: T;
  appointmentId: string;
  label: string;
  payload: PayloadFor<T>;
}): Promise<QueuedAction[]> {
  const items = await loadQueue();
  const withoutDuplicate = items.filter(
    (item) => !(item.type === input.type && item.appointmentId === input.appointmentId),
  );
  const action: QueuedAction = {
    id: generateId(),
    type: input.type,
    appointmentId: input.appointmentId,
    label: input.label,
    payload: input.payload,
    clientTimestamp: new Date().toISOString(),
    status: 'pending',
    errorMessage: null,
    attempts: 0,
  };
  const next = [...withoutDuplicate, action];
  await saveQueue(next);
  return next;
}

export async function removeAction(id: string): Promise<QueuedAction[]> {
  const items = await loadQueue();
  const next = items.filter((item) => item.id !== id);
  await saveQueue(next);
  return next;
}

// Puts a 'failed' item back to 'pending' so the next processQueue() run retries it -
// used when the technician taps Retry on a surfaced failure.
export async function retryAction(id: string): Promise<QueuedAction[]> {
  const items = await loadQueue();
  const next = items.map((item) => (item.id === id ? { ...item, status: 'pending' as const, errorMessage: null } : item));
  await saveQueue(next);
  return next;
}

export function isNetworkError(err: unknown): boolean {
  // Axios sets `.response` only when the server actually answered - no response at
  // all (dropped connection, DNS failure, timeout) means the request never reached
  // the backend, which is exactly the "still offline" case this needs to detect.
  return isAxiosError(err) && !err.response;
}

export function extractBackendErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join(' ');
  }
  return fallback;
}

async function executeAction(action: QueuedAction): Promise<void> {
  switch (action.type) {
    case 'START_VISIT':
      await startVisit(action.appointmentId, action.payload as StartVisitInput);
      return;
    case 'CAPTURE_SERIAL_NUMBER':
      await captureSerialNumber(action.appointmentId, action.payload as CaptureSerialNumberInput);
      return;
    case 'CAPTURE_FAULT_SYMPTOM':
      await captureFaultSymptom(action.appointmentId, action.payload as CaptureFaultSymptomInput);
      return;
    case 'NEED_SPARE':
      await requestNeedSpare(action.appointmentId, action.payload as NeedSpareInput);
      return;
    case 'COMPLETE_VISIT':
      await completeVisit(action.appointmentId, action.payload as CompleteVisitInput);
      return;
  }
}

export interface ProcessQueueResult {
  synced: string[];
  failed: string[];
  affectedAppointmentIds: string[];
}

// Not reentrant-safe by itself - callers (the useOfflineQueue hook) are responsible
// for not starting a second run while one is already in flight.
export async function processQueue(): Promise<ProcessQueueResult> {
  let items = await loadQueue();
  const pending = items
    .filter((item) => item.status === 'pending')
    .sort((a, b) => a.clientTimestamp.localeCompare(b.clientTimestamp));

  const synced: string[] = [];
  const failed: string[] = [];
  const affectedAppointmentIds: string[] = [];

  for (const action of pending) {
    try {
      await executeAction(action);
      items = items.filter((item) => item.id !== action.id);
      synced.push(action.id);
      affectedAppointmentIds.push(action.appointmentId);
    } catch (err) {
      if (isNetworkError(err)) {
        // Still offline (or dropped again mid-sync) - leave this and everything after
        // it untouched, and stop for this run rather than failing the rest of the
        // queue for the same reason one at a time.
        break;
      }
      items = items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              status: 'failed' as const,
              errorMessage: extractBackendErrorMessage(err, 'Could not sync this action. Review and retry.'),
              attempts: item.attempts + 1,
            }
          : item,
      );
      failed.push(action.id);
      affectedAppointmentIds.push(action.appointmentId);
    }
  }

  await saveQueue(items);
  return { synced, failed, affectedAppointmentIds };
}
