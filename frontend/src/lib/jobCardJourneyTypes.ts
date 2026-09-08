// Shapes mirrored from the backend's new read-only aggregator
// (src/job-card-journey/job-card-journey.service.ts + src/job-cards/job-card-journey.util.ts).
// This module deliberately reads across Job Cards/Appointments/Technician/Inventory/
// Estimates/Invoicing/Delivery but writes nothing - every mutation stays on its own
// existing screen (Job Cards, Workshop, QC, Delivery, ...); this is purely a "where is
// this job right now, end to end" view layered on top.
import type { Appointment, TechnicianVisit } from './appointmentsTypes';
import type { JobCard } from './jobCardsTypes';
import type { JobCardTaskPause } from './jobCardsTypes';
import type { InventoryReservation } from './inventoryTypes';
import type { Estimate } from './estimatesTypes';
import type { Invoice } from './invoicingTypes';
import type { Delivery } from './deliveryTypes';

export type JourneyStepState = 'done' | 'current' | 'pending' | 'skipped' | 'cancelled';

export interface JourneyStep {
  key: string;
  label: string;
  state: JourneyStepState;
  at: string | null;
  detail?: string;
}

export interface JourneySearchResult {
  jobCardId: string;
  jobCardNumber: string;
  jobCardStatus: string;
  appointmentNumber: string;
  customerName: string;
  customerPhone: string;
  deliveryNumber: string | null;
}

export interface JobCardJourney {
  jobCard: JobCard;
  appointment: Appointment;
  visit: TechnicianVisit | null;
  taskPauses: JobCardTaskPause[];
  spareRequest: InventoryReservation | null;
  estimates: Estimate[];
  invoice: Invoice | null;
  delivery: Delivery | null;
  steps: JourneyStep[];
}
