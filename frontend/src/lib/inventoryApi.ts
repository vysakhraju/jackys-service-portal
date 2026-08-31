// Thin wrappers over src/inventory/inventory.controller.ts - one function per route that
// actually exists. GET /inventory/reservations/stale is the ONLY real list endpoint in
// this module; stock and GRN are both scoped to a single spare part id, same "paste an
// id" convention as Spare Parts/Warranty Master.
import { api } from './api';
import type {
  ConfirmReturnInput,
  GrnInput,
  InventoryReservation,
  InventoryReservationWithAge,
  ReviewReservationInput,
  StockLookupResult,
} from './inventoryTypes';

const BASE = '/inventory';

export const grn = (data: GrnInput) => api.post<StockLookupResult>(`${BASE}/grn`, data).then((r) => r.data);

export const getStock = (sparePartId: string, location?: 'MAIN_STORE' | 'DAMAGE_LOCATION') =>
  api
    .get<StockLookupResult>(`${BASE}/stock/${sparePartId}`, { params: location ? { location } : {} })
    .then((r) => r.data);

export const getStaleReservations = () =>
  api.get<InventoryReservationWithAge[]>(`${BASE}/reservations/stale`).then((r) => r.data);

export const reviewReservation = (id: string, data: ReviewReservationInput) =>
  api.post<InventoryReservation>(`${BASE}/reservations/${id}/review`, data).then((r) => r.data);

export const requestReturn = (id: string) =>
  api.post<InventoryReservation>(`${BASE}/reservations/${id}/request-return`).then((r) => r.data);

export const confirmReturn = (id: string, data: ConfirmReturnInput) =>
  api.post<InventoryReservation>(`${BASE}/reservations/${id}/confirm-return`, data).then((r) => r.data);
