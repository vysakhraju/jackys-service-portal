// Shapes and enums mirrored from the backend's Master Data module
// (src/master-data/entities/*.entity.ts and dto/create-*.dto.ts).
// Kept as plain `as const` arrays (not TS enums) so they can drive <select> options
// directly without an extra mapping step.

export const COUNTRIES = ['UAE', 'KSA'] as const;
export type CountryValue = (typeof COUNTRIES)[number];

export const APPLIANCE_CATEGORIES = [
  'REFRIGERATOR',
  'WASHING_MACHINE',
  'AC',
  'MICROWAVE',
  'OVEN',
  'COOKING_RANGE',
  'DISHWASHER',
  'WATER_HEATER',
  'DRYER',
  'OTHER',
] as const;
export type ApplianceCategoryValue = (typeof APPLIANCE_CATEGORIES)[number];

// Price List rebuild (requested 2026-09-22, Phase 3) - moved here from
// appointmentsTypes.ts (which now just re-exports it) so master-data and the New
// Appointment popup share ONE list instead of two that could drift, same reasoning as
// the backend's JobType move into service-price-list.entity.ts. Retires the old,
// separate SERVICE_ACTIVITY_TYPES list (INSTALL/REPAIR/DEMO/ON_SITE/PM/DISMANTLE) that
// Price Lists used to key off - see PriceListsPage.tsx.
export const JOB_TYPES = ['REPAIR', 'INSTALLATION', 'DELIVERY_INSTALLATION', 'MAINTENANCE'] as const;
export type JobTypeValue = (typeof JOB_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['WHATSAPP', 'EMAIL', 'SMS'] as const;
export type NotificationChannelValue = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TRIGGERS = [
  'APPOINTMENT_CONFIRMED',
  'TECHNICIAN_DISPATCHED',
  'TECHNICIAN_ARRIVED',
  'ESTIMATE_SENT',
  'ESTIMATE_APPROVED',
  'ESTIMATE_REJECTED',
  'JOB_COMPLETED',
  'INVOICE_READY',
  'PAYMENT_RECEIVED',
  'DELIVERY_SCHEDULED',
  'DELIVERED',
  'AMC_RENEWAL_REMINDER',
  'WARRANTY_EXPIRY',
] as const;
export type NotificationTriggerValue = (typeof NOTIFICATION_TRIGGERS)[number];

export const RECOVERY_CATEGORIES = ['RECOVERABLE_SPARE', 'CONSUMABLE', 'SCRAP'] as const;
export type RecoveryCategoryValue = (typeof RECOVERY_CATEGORIES)[number];

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DaySchedule {
  isOpen: boolean;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
  maxJobsPerDay: number;
}

export function defaultDaySchedule(isOpen: boolean): DaySchedule {
  return { isOpen, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00', maxJobsPerDay: 20 };
}

export function defaultWeekSchedule(): Record<Weekday, DaySchedule> {
  return WEEKDAYS.reduce(
    (acc, day) => {
      acc[day] = defaultDaySchedule(day !== 'sunday');
      return acc;
    },
    {} as Record<Weekday, DaySchedule>,
  );
}

// === Service Centres ===
export interface ServiceCentre {
  id: string;
  code: string;
  name: string;
  country: CountryValue;
  address: string | null;
  city: string | null;
  schedule: Record<string, DaySchedule>;
  assignedTechnicianIds: string[];
  isActive: boolean;
  vatRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceCentreInput {
  code: string;
  name: string;
  country: CountryValue;
  address?: string;
  city?: string;
  schedule?: Record<string, DaySchedule>;
  assignedTechnicianIds?: string[];
  isActive?: boolean;
  vatRate?: number;
}

// === Fault & Symptoms ===
export interface FaultSymptom {
  id: string;
  faultCode: string;
  faultDescription: string;
  symptomCode: string;
  symptomDescription: string;
  category: ApplianceCategoryValue;
  requiresWorkshop: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFaultSymptomInput {
  faultCode: string;
  faultDescription: string;
  symptomCode: string;
  symptomDescription: string;
  category: ApplianceCategoryValue;
  requiresWorkshop?: boolean;
  isActive?: boolean;
}

// === Spare Parts ===
export interface SparePart {
  id: string;
  code: string;
  name: string;
  category: string;
  brand: string | null;
  description: string | null;
  unitCost: number;
  unitPriceB2B: number;
  unitPriceB2C: number;
  minStockLevel: number;
  vanStockLevel: number;
  isActive: boolean;
  attributes: Record<string, unknown> | null;
  models?: SparePartModel[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSparePartInput {
  code: string;
  name: string;
  category: string;
  brand?: string;
  description?: string;
  unitCost?: number;
  unitPriceB2B?: number;
  unitPriceB2C?: number;
  minStockLevel?: number;
  vanStockLevel?: number;
  isActive?: boolean;
}

// === Spare Part Models ===
export interface SparePartModel {
  id: string;
  modelId: string;
  brand: string;
  modelName: string;
  attributes: Record<string, unknown>;
  spareParts?: SparePart[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSparePartModelInput {
  modelId: string;
  brand: string;
  modelName: string;
}

// === Service Price List === (rebuilt 2026-09-22, Phase 3 - see the backend
// service-price-list.entity.ts's own doc comment for the row-shape reasoning). Row key
// is now (category, jobType) instead of (activityType, modelId); billingChannelId/Rate
// is an optional interdepartment-billing override on that same row.
export interface ServicePriceList {
  id: string;
  category: ApplianceCategoryValue;
  jobType: JobTypeValue;
  priceB2B: number;
  priceB2C: number;
  billingChannelId: string | null;
  billingChannel: BillingChannel | null;
  billingChannelRate: number;
  warrantyLaborCost: number;
  currency: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePriceListInput {
  category: ApplianceCategoryValue;
  jobType: JobTypeValue;
  priceB2B?: number;
  priceB2C?: number;
  billingChannelId?: string;
  billingChannelRate?: number;
  warrantyLaborCost?: number;
  currency?: string;
  isActive?: boolean;
}

// === Technician KPI Rules ===
export interface TechnicianKpiRule {
  id: string;
  kpiName: string;
  weightage: number;
  target: number;
  incentivePoints: number;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKpiRuleInput {
  kpiName: string;
  weightage: number;
  target: number;
  incentivePoints: number;
  description?: string;
  isActive?: boolean;
}

// === Notification Templates ===
export interface NotificationTemplate {
  id: string;
  trigger: NotificationTriggerValue;
  channel: NotificationChannelValue;
  subject: string;
  body: string;
  placeholders: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotificationTemplateInput {
  trigger: NotificationTriggerValue;
  channel: NotificationChannelValue;
  subject: string;
  body: string;
  placeholders?: string[];
  isActive?: boolean;
}

// === Warranty Master ===
export interface WarrantyMaster {
  id: string;
  serialNumberRange: string;
  brand: string;
  model: string;
  warrantyPeriodMonths: number;
  supplier: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWarrantyMasterInput {
  serialNumberRange: string;
  brand: string;
  model: string;
  warrantyPeriodMonths: number;
  supplier: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  isActive?: boolean;
}

// === Component Yield Matrix ===
export interface ComponentYieldMatrix {
  id: string;
  modelId: string;
  originalBomItemCode: string;
  itemName: string;
  category: RecoveryCategoryValue;
  defaultRecoveryEvaluation: number;
  convertedSparePartCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateComponentYieldInput {
  modelId: string;
  originalBomItemCode: string;
  itemName: string;
  category: RecoveryCategoryValue;
  defaultRecoveryEvaluation?: number;
  convertedSparePartCode?: string;
  isActive?: boolean;
}

// === City / Cancellation Reason / Appliance Model (Appointment/Mobile/Job Card
// overhaul, Phase 1 backend / Phase 2 frontend, 2026-09-16) â€” mirrors
// src/master-data/entities/city.entity.ts, cancellation-reason.entity.ts,
// appliance-model.entity.ts, and their create-*.dto.ts pairs exactly. ===
export interface City {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCityInput {
  name: string;
  isActive?: boolean;
}

export interface CancellationReason {
  id: string;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCancellationReasonInput {
  label: string;
  isActive?: boolean;
}

export interface ApplianceModel {
  id: string;
  brand: string;
  model: string;
  description: string | null;
  // #301 (2026-09-21) - links this model to the Fault & Symptoms picker. Nullable:
  // existing models predate this field and have none until an admin sets it.
  category: ApplianceCategoryValue | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApplianceModelInput {
  brand: string;
  model: string;
  description?: string;
  category?: ApplianceCategoryValue;
  isActive?: boolean;
}

// === Billing Channel / Appointment Field Config (Master-Data/New-Appointment billing
// modification Phase 1 backend / Phase 2 frontend, 2026-09-22) - mirrors
// src/master-data/entities/billing-channel.entity.ts and
// appointment-field-config.entity.ts exactly. ===
export interface BillingChannel {
  id: string;
  name: string;
  isActive: boolean;
  // Phase 5 (2026-09-22, per-appointment Billing Channel override) - the flat rate this
  // channel bills at when picked directly on an appointment, overriding a Price List
  // row's own billingChannelRate. See billing-channel-resolution.util.ts on the backend.
  defaultRate: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBillingChannelInput {
  name: string;
  isActive?: boolean;
  defaultRate?: number;
}

export interface AppointmentFieldConfig {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  isMandatory: boolean;
  createdAt: string;
  updatedAt: string;
}
