// Thin wrappers over the real backend endpoints in src/master-data/master-data.controller.ts.
// One function per route actually exposed by the API — no function here invents an
// endpoint the backend doesn't have (e.g. there is no "list all warranty rules" or
// "list all component yield rows" route, so none is offered here either).
import { api } from './api';
import type {
  ApplianceModel,
  AppointmentFieldConfig,
  BillingChannel,
  CancellationReason,
  City,
  ComponentYieldMatrix,
  CreateApplianceModelInput,
  CreateBillingChannelInput,
  CreateCancellationReasonInput,
  CreateCityInput,
  CreateComponentYieldInput,
  CreateFaultSymptomInput,
  CreateKpiRuleInput,
  CreateNotificationTemplateInput,
  CreatePriceListInput,
  CreateServiceCentreInput,
  CreateSparePartInput,
  CreateSparePartModelInput,
  CreateWarrantyMasterInput,
  FaultSymptom,
  NotificationTemplate,
  RecoveryCategoryValue,
  ServiceCentre,
  ServicePriceList,
  SparePart,
  SparePartModel,
  TechnicianKpiRule,
  WarrantyMaster,
} from './masterDataTypes';

const BASE = '/master-data';

// === Service Centres (full CRUD) ===
export const listServiceCentres = (country?: string) =>
  api.get<ServiceCentre[]>(`${BASE}/service-centres`, { params: country ? { country } : {} }).then((r) => r.data);
export const createServiceCentre = (data: CreateServiceCentreInput) =>
  api.post<ServiceCentre>(`${BASE}/service-centres`, data).then((r) => r.data);
export const updateServiceCentre = (id: string, data: Partial<CreateServiceCentreInput>) =>
  api.put<ServiceCentre>(`${BASE}/service-centres/${id}`, data).then((r) => r.data);
export const deleteServiceCentre = (id: string) =>
  api.delete(`${BASE}/service-centres/${id}`).then((r) => r.data);

// === Fault & Symptoms (full CRUD, #301 follow-up + bulk CSV import) ===
export const listFaultSymptoms = (category?: string) =>
  api.get<FaultSymptom[]>(`${BASE}/fault-symptoms`, { params: category ? { category } : {} }).then((r) => r.data);
export const createFaultSymptom = (data: CreateFaultSymptomInput) =>
  api.post<FaultSymptom>(`${BASE}/fault-symptoms`, data).then((r) => r.data);
export const updateFaultSymptom = (id: string, data: Partial<CreateFaultSymptomInput>) =>
  api.put<FaultSymptom>(`${BASE}/fault-symptoms/${id}`, data).then((r) => r.data);
export const deleteFaultSymptom = (id: string) =>
  api.delete(`${BASE}/fault-symptoms/${id}`).then((r) => r.data);

// Generic bulk-import route (POST /master-data/bulk-import/:entityType) - backend accepts
// an already-parsed array of row objects for any master type; this wrapper is scoped to
// fault-symptom rows since that's the only screen with an import UI so far.
export const bulkImportFaultSymptoms = (rows: Partial<CreateFaultSymptomInput>[]) =>
  api
    .post<{ success: number; errors: string[] }>(`${BASE}/bulk-import/fault-symptom`, rows)
    .then((r) => r.data);

// === Spare Parts (create + list/filter + link-to-model; no update/delete) ===
export const listSpareParts = (filters: { category?: string; brand?: string; active?: boolean }) =>
  api
    .get<SparePart[]>(`${BASE}/spare-parts`, {
      params: {
        category: filters.category || undefined,
        brand: filters.brand || undefined,
        active: filters.active === undefined ? undefined : String(filters.active),
      },
    })
    .then((r) => r.data);
export const createSparePart = (data: CreateSparePartInput) =>
  api.post<SparePart>(`${BASE}/spare-parts`, data).then((r) => r.data);
export const linkSparePartToModel = (sparePartId: string, modelId: string) =>
  api.post<SparePart>(`${BASE}/spare-parts/${sparePartId}/link-model`, { modelId }).then((r) => r.data);

// === Spare Part Models (create + list; no update/delete) ===
export const listSparePartModels = () =>
  api.get<SparePartModel[]>(`${BASE}/spare-part-models`).then((r) => r.data);
export const createSparePartModel = (data: CreateSparePartModelInput) =>
  api.post<SparePartModel>(`${BASE}/spare-part-models`, data).then((r) => r.data);

// #218/#253: backs the Service Centres page's field-technician picker. GET /users is
// admin-only and GET /technician-schedule/gantt is Team-Leader-only - neither reachable by
// CCE, who is exactly who creates/edits service centres - so this reads the same
// MASTER_DATA_SERVICE_CENTRE_CREATE-gated list the backend built for it, not a general
// user directory.
export const listFieldTechnicians = () =>
  api.get<{ id: string; name: string }[]>(`${BASE}/service-centres/field-technicians`).then((r) => r.data);

// === Service Price List (full CRUD, Price List rebuild 2026-09-22 Phase 3) — grid is
// Appliance Category x Job Type, one row per pair, same CRUD shape as Billing Channel's
// own block above. List takes optional category/jobType filters (both ungated, same
// "every screen that needs the dropdown can read it" rule as City/BillingChannel). ===
export const listPriceLists = (category?: string, jobType?: string) =>
  api
    .get<ServicePriceList[]>(`${BASE}/price-lists`, { params: { category: category || undefined, jobType: jobType || undefined } })
    .then((r) => r.data);
export const createPriceList = (data: CreatePriceListInput) =>
  api.post<ServicePriceList>(`${BASE}/price-lists`, data).then((r) => r.data);
export const updatePriceList = (id: string, data: Partial<CreatePriceListInput>) =>
  api.put<ServicePriceList>(`${BASE}/price-lists/${id}`, data).then((r) => r.data);
export const deletePriceList = (id: string) => api.delete(`${BASE}/price-lists/${id}`).then((r) => r.data);

// === Technician KPI Rules (create + list; no update/delete) ===
export const listKpiRules = () => api.get<TechnicianKpiRule[]>(`${BASE}/kpi-rules`).then((r) => r.data);
export const createKpiRule = (data: CreateKpiRuleInput) =>
  api.post<TechnicianKpiRule>(`${BASE}/kpi-rules`, data).then((r) => r.data);

// === Notification Templates (create + list; no update/delete) ===
export const listNotificationTemplates = () =>
  api.get<NotificationTemplate[]>(`${BASE}/notification-templates`).then((r) => r.data);
export const createNotificationTemplate = (data: CreateNotificationTemplateInput) =>
  api.post<NotificationTemplate>(`${BASE}/notification-templates`, data).then((r) => r.data);

// === Warranty Master (create + check-by-serial LOOKUP ONLY — no list-all route) ===
export const createWarrantyMaster = (data: CreateWarrantyMasterInput) =>
  api.post<WarrantyMaster>(`${BASE}/warranty-master`, data).then((r) => r.data);
export const checkWarranty = (serialNumber: string, brand?: string) =>
  api
    .get(`${BASE}/warranty-master/check/${encodeURIComponent(serialNumber)}`, { params: brand ? { brand } : {} })
    .then((r) => r.data);

// === Component Yield Matrix (create; list is BY MODEL or BY CATEGORY — no list-all route) ===
export const createComponentYield = (data: CreateComponentYieldInput) =>
  api.post<ComponentYieldMatrix>(`${BASE}/component-yield`, data).then((r) => r.data);
export const listYieldByModel = (modelId: string) =>
  api.get<ComponentYieldMatrix[]>(`${BASE}/component-yield/model/${encodeURIComponent(modelId)}`).then((r) => r.data);
export const listYieldByCategory = (category: RecoveryCategoryValue) =>
  api.get<ComponentYieldMatrix[]>(`${BASE}/component-yield/category/${category}`).then((r) => r.data);

// === City / Cancellation Reason / Appliance Model (full CRUD, Appointment/Mobile/Job
// Card overhaul Phase 1) — same shape as Service Centre's own CRUD above: Create/Update
// gated by MANAGE, List ungated (every screen that shows these dropdowns needs it, not
// just admins), Delete is soft (isActive=false) and Super-Admin-only server-side. ===
export const listCities = () => api.get<City[]>(`${BASE}/cities`).then((r) => r.data);
export const createCity = (data: CreateCityInput) => api.post<City>(`${BASE}/cities`, data).then((r) => r.data);
export const updateCity = (id: string, data: Partial<CreateCityInput>) =>
  api.put<City>(`${BASE}/cities/${id}`, data).then((r) => r.data);
export const deleteCity = (id: string) => api.delete(`${BASE}/cities/${id}`).then((r) => r.data);

export const listCancellationReasons = () =>
  api.get<CancellationReason[]>(`${BASE}/cancellation-reasons`).then((r) => r.data);
export const createCancellationReason = (data: CreateCancellationReasonInput) =>
  api.post<CancellationReason>(`${BASE}/cancellation-reasons`, data).then((r) => r.data);
export const updateCancellationReason = (id: string, data: Partial<CreateCancellationReasonInput>) =>
  api.put<CancellationReason>(`${BASE}/cancellation-reasons/${id}`, data).then((r) => r.data);
export const deleteCancellationReason = (id: string) =>
  api.delete(`${BASE}/cancellation-reasons/${id}`).then((r) => r.data);

export const listApplianceModels = (brand?: string) =>
  api.get<ApplianceModel[]>(`${BASE}/appliance-models`, { params: brand ? { brand } : {} }).then((r) => r.data);
export const createApplianceModel = (data: CreateApplianceModelInput) =>
  api.post<ApplianceModel>(`${BASE}/appliance-models`, data).then((r) => r.data);
export const updateApplianceModel = (id: string, data: Partial<CreateApplianceModelInput>) =>
  api.put<ApplianceModel>(`${BASE}/appliance-models/${id}`, data).then((r) => r.data);
export const deleteApplianceModel = (id: string) =>
  api.delete(`${BASE}/appliance-models/${id}`).then((r) => r.data);

// Generic bulk-import route (POST /master-data/bulk-import/:entityType), same one
// Fault & Symptom's import screen uses - bulkImportFromCsv's 'appliance-model' case
// already existed server-side (calls createApplianceModel(row) per row), just never
// had a frontend wrapper until this screen needed it.
export const bulkImportApplianceModels = (rows: Partial<CreateApplianceModelInput>[]) =>
  api
    .post<{ success: number; errors: string[] }>(`${BASE}/bulk-import/appliance-model`, rows)
    .then((r) => r.data);

// === Billing Channel (full CRUD, Master-Data/New-Appointment billing modification req. 4,
// 2026-09-22) — same shape as City's own CRUD above. ===
export const listBillingChannels = () => api.get<BillingChannel[]>(`${BASE}/billing-channels`).then((r) => r.data);
export const createBillingChannel = (data: CreateBillingChannelInput) =>
  api.post<BillingChannel>(`${BASE}/billing-channels`, data).then((r) => r.data);
export const updateBillingChannel = (id: string, data: Partial<CreateBillingChannelInput>) =>
  api.put<BillingChannel>(`${BASE}/billing-channels/${id}`, data).then((r) => r.data);
export const deleteBillingChannel = (id: string) => api.delete(`${BASE}/billing-channels/${id}`).then((r) => r.data);

// === Appointment Field Config (req. 1) — list open, only isMandatory is admin-editable,
// no create/delete route (see the entity's own doc comment). ===
export const listAppointmentFieldConfigs = () =>
  api.get<AppointmentFieldConfig[]>(`${BASE}/appointment-field-configs`).then((r) => r.data);
export const updateAppointmentFieldConfig = (id: string, isMandatory: boolean) =>
  api.put<AppointmentFieldConfig>(`${BASE}/appointment-field-configs/${id}`, { isMandatory }).then((r) => r.data);
