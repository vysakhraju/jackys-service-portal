// Read-only master-data lookups this app needs. Mirrors the web app's
// src/lib/masterDataApi.ts naming for the one endpoint both apps share so far.
import { api } from './api';
import type { ApplianceCategoryValue, FaultSymptom, SparePart } from './types';

const BASE = '/master-data';

// No @Roles() on this endpoint server-side (see src/master-data/master-data.controller.ts)
// - RolesGuard allows any authenticated user through when a handler has no role
// requirement, so TECHNICIAN_FIELD can call this like every other logged-in role.
export const listFaultSymptoms = (category?: ApplianceCategoryValue) =>
  api.get<FaultSymptom[]>(`${BASE}/fault-symptoms`, { params: category ? { category } : {} }).then((r) => r.data);

// Mobile Phase 5 (Need Spare picker). Same no-@Roles() shape as fault-symptoms above.
// No server-side free-text search - fetched once (active parts only) and filtered
// client-side, same pattern as FaultSymptomPicker.
export const listSpareParts = () =>
  api.get<SparePart[]>(`${BASE}/spare-parts`, { params: { active: true } }).then((r) => r.data);
