// Thin wrappers over the real backend endpoints in src/master-data/master-data.controller.ts.
// One function per route actually exposed by the API — no function here invents an
// endpoint the backend doesn't have (e.g. there is no "list all warranty rules" or
// "list all component yield rows" route, so none is offered here either).
import { api } from './api';
import type {
  ComponentYieldMatrix,
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

// === Fault & Symptoms (create + list; no update/delete in the backend) ===
export const listFaultSymptoms = (category?: string) =>
  api.get<FaultSymptom[]>(`${BASE}/fault-symptoms`, { params: category ? { category } : {} }).then((r) => r.data);
export const createFaultSymptom = (data: CreateFaultSymptomInput) =>
  api.post<FaultSymptom>(`${BASE}/fault-symptoms`, data).then((r) => r.data);

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

// === Service Price List (create; list REQUIRES activityType — no unfiltered list route) ===
export const getPriceList = (activityType: string, modelId?: string) =>
  api
    .get<ServicePriceList[]>(`${BASE}/price-lists`, { params: { activityType, modelId: modelId || undefined } })
    .then((r) => r.data);
export const createPriceList = (data: CreatePriceListInput) =>
  api.post<ServicePriceList>(`${BASE}/price-lists`, data).then((r) => r.data);

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
