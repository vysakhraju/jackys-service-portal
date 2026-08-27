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

export const SERVICE_ACTIVITY_TYPES = ['INSTALL', 'REPAIR', 'DEMO', 'ON_SITE', 'PM', 'DISMANTLE'] as const;
export type ServiceActivityTypeValue = (typeof SERVICE_ACTIVITY_TYPES)[number];

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

// === Service Price List ===
export interface ServicePriceList {
  id: string;
  activityType: ServiceActivityTypeValue;
  modelId: string | null;
  priceB2B: number;
  priceB2C: number;
  warrantyLaborCost: number;
  interdepartmentLaborCost: number;
  currency: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePriceListInput {
  activityType: ServiceActivityTypeValue;
  modelId?: string;
  priceB2B?: number;
  priceB2C?: number;
  warrantyLaborCost?: number;
  interdepartmentLaborCost?: number;
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
