// Shared fixture builders for tests - full, type-complete objects with sensible defaults,
// overridable per-test via a Partial<> merge. Keeps individual test files from having to
// restate every field of these fairly large backend-mirrored shapes.
import type { Appointment } from '../lib/appointmentsTypes';
import type { JobCard } from '../lib/jobCardsTypes';
import type { Estimate } from '../lib/estimatesTypes';
import type { InventoryReservation, InventoryReservationWithAge } from '../lib/inventoryTypes';
import type { WorkshopState } from '../lib/workshopTypes';
import type { UserPermissionGrant } from '../lib/permissionsTypes';
import type { Delivery, ReadyForDeliveryRow } from '../lib/deliveryTypes';
import type { AgingBucket, Invoice, Payment } from '../lib/invoicingTypes';
import type { PortalInvoiceView, PortalSummaryView, PortalTrackView } from '../lib/customerPortalTypes';
import type { AmcBillingInvoice, AmcContract, AmcScheduleVisit, AmcVisitCompletion, UpsellCandidate } from '../lib/amcTypes';
import type { DismantlingRecord, HarvestedComponent } from '../lib/dismantlingTypes';
import type { ComponentYieldMatrix } from '../lib/masterDataTypes';
import type { RecoveryRate, WarrantyClaim, WarrantyClaimLine } from '../lib/warrantyClaimsTypes';
import type {
  ApprovalAgingItem,
  ApprovalAgingReport,
  DashboardOverview,
  FinanceSummary,
  FirstTimeFixRateReport,
  GpByServiceCentreRow,
  InterdepartmentRechargeRow,
  KanbanBoard,
  KanbanCard,
  ProductFailureRatioRow,
  ProfitTrendPoint,
  RepeatComplaintItem,
  RwrAnalysisRow,
  ServiceEfficiencyReport,
  SlaBreachReport,
  SpareConsumptionReport,
  TechnicianProductivityReport,
  UnpaidInvoicesReport,
} from '../lib/reportsTypes';
import type { AppointmentDashboardStats } from '../lib/appointmentsTypes';
import type { GlPosting } from '../lib/glLedgerTypes';
import type { Role, User } from '../lib/types';
import type { RoleAccessGrant, RoleCapabilityModule } from '../lib/roleAccessTypes';
import type { CapabilityMatrixEntry, RolePermissionUserRef } from '../lib/rolePermissionsTypes';

export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    appointmentNumber: 'APT-0001',
    type: 'OUT_OF_WARRANTY',
    status: 'COMPLETED',
    channel: 'PHONE',
    customerType: 'B2C',
    customerName: 'Test Customer',
    customerPhone: '+971501112222',
    customerEmail: 'customer@example.com',
    customerAddress: null,
    customerLat: null,
    customerLng: null,
    customerCity: null,
    customerCountry: null,
    customerVatNumber: null,
    brand: 'Samsung',
    modelNumber: 'WA80J5710',
    serialNumber: 'SN150000',
    purchaseDate: null,
    invoiceNumber: 'INV-0001',
    problemDescription: 'Not draining',
    preferredDate: null,
    preferredTimeSlot: null,
    scheduledAt: '2026-08-01T09:00:00Z',
    estimatedDurationMinutes: null,
    actualStartAt: null,
    actualEndAt: null,
    notes: null,
    cancellationReason: null,
    serviceCentre: undefined,
    serviceCentreId: 'sc-1',
    technician: null,
    technicianId: null,
    createdBy: null,
    createdById: null,
    amcContractId: null,
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeJobCard(overrides: Partial<JobCard> = {}): JobCard {
  return {
    id: 'jc-1',
    jobCardNumber: 'JC-0001',
    appointment: makeAppointment(),
    appointmentId: 'appt-1',
    status: 'SN_VALIDATED',
    section: null,
    serialNumber: 'SN150000',
    brand: 'Samsung',
    faultCode: 'F-1',
    symptomCode: 'S-1',
    originalWarrantyStatus: 'OOW',
    warrantyStatus: 'OOW',
    snValidatedAgainstInvoice: true,
    snValidationNotes: null,
    warrantyOverridden: false,
    warrantyOverrideReason: null,
    warrantyOverrideByUser: null,
    warrantyOverrideBy: null,
    warrantyOverrideAt: null,
    overrideCount: 0,
    customerApproved: false,
    customerApprovalNotes: null,
    assignedWorkshopTechnicianId: null,
    workshopAssignedAt: null,
    qcApprovedByUserId: null,
    qcApprovedAt: null,
    qcRejectionCount: 0,
    lastQcRejectedAt: null,
    lastQcRejectionReason: null,
    cancellationReason: null,
    deliveryId: null,
    publicToken: null,
    publicTokenExpiresAt: null,
    createdBy: undefined,
    createdById: 'user-1',
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeGrant(overrides: Partial<UserPermissionGrant> = {}): UserPermissionGrant {
  return {
    id: 'grant-1',
    user: { id: 'user-2', firstName: 'Quinn', lastName: 'Carter', email: 'quinn@jackys.com' },
    userId: 'user-2',
    permissionType: 'QC_APPROVAL',
    grantedBy: { id: 'admin-1', firstName: 'Admin', lastName: 'User', email: 'admin@jackys.com' },
    grantedByUserId: 'admin-1',
    grantedAt: '2026-08-01T08:00:00Z',
    revokedAt: null,
    revokedBy: null,
    revokedByUserId: null,
    notes: null,
    ...overrides,
  };
}

export function makeReservation(overrides: Partial<InventoryReservationWithAge> = {}): InventoryReservationWithAge {
  return {
    id: 'res-1',
    sparePartId: 'sp-1',
    jobCardId: 'jc-1',
    custodian: undefined,
    custodianUserId: 'tech-1',
    quantityRequested: 2,
    quantityReserved: 2,
    status: 'HELD',
    requestedBy: undefined,
    requestedByUserId: 'tech-1',
    requestedAt: '2026-08-01T08:00:00Z',
    lastReviewedAt: null,
    reviewedBy: null,
    reviewedByUserId: null,
    reviewDecision: null,
    notes: null,
    quantityReturned: null,
    returnConfirmedByUserId: null,
    returnConfirmedAt: null,
    consumedAt: null,
    consumedBy: null,
    consumedByUserId: null,
    reworkApprovedByUserId: null,
    reworkApprovedBy: null,
    reworkVerbalOverrideBy: null,
    reworkVerbalOverrideNotes: null,
    updatedAt: '2026-08-01T08:00:00Z',
    ageHours: 30,
    custodianActive: true,
    ...overrides,
  };
}

// GET /inventory/reservations/pending-need-spare's shape - a PENDING_REVIEW reservation
// with sparePart/jobCard/requestedBy relations loaded (see
// InventoryService.getPendingNeedSpareRequests()), used by NeedSpareReviewPage and the
// NeedSpareNotifier toast - both added 2026-09-07.
export function makeNeedSpareRequest(overrides: Partial<InventoryReservation> = {}): InventoryReservation {
  return {
    id: 'res-need-spare-1',
    sparePartId: 'sp-1',
    sparePart: { id: 'sp-1', code: 'SP-001', name: 'Drum Belt' },
    jobCardId: 'jc-1',
    jobCard: { id: 'jc-1', jobCardNumber: 'JC-0001' },
    custodian: undefined,
    custodianUserId: 'tech-1',
    quantityRequested: 2,
    quantityReserved: 0,
    status: 'PENDING_REVIEW',
    requestedBy: { id: 'tech-1', firstName: 'Ravi', lastName: 'Kumar', email: 'ravi@jackys.com' },
    requestedByUserId: 'tech-1',
    requestedAt: '2026-09-07T08:00:00Z',
    lastReviewedAt: null,
    reviewedBy: null,
    reviewedByUserId: null,
    reviewDecision: null,
    notes: null,
    quantityReturned: null,
    returnConfirmedByUserId: null,
    returnConfirmedAt: null,
    consumedAt: null,
    consumedBy: null,
    consumedByUserId: null,
    reworkApprovedByUserId: null,
    reworkApprovedBy: null,
    reworkVerbalOverrideBy: null,
    reworkVerbalOverrideNotes: null,
    updatedAt: '2026-09-07T08:00:00Z',
    ...overrides,
  };
}

export function makeWorkshopState(overrides: Partial<WorkshopState> = {}): WorkshopState {
  return {
    jobCard: makeJobCard({ status: 'IN_PROGRESS', section: 'WORKSHOP', assignedWorkshopTechnicianId: 'tech-1' }),
    staleReservations: [],
    ...overrides,
  };
}

export function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'del-1',
    deliveryNumber: 'DLV-0001',
    status: 'PENDING',
    dispatcherUserId: 'dispatcher-1',
    driverUserId: null,
    dispatchedAt: null,
    deliveredAt: null,
    podSignatureBase64: null,
    podPhotoBase64: null,
    podRecipientName: null,
    podNotes: null,
    cancellationReason: null,
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeReadyRow(overrides: Partial<ReadyForDeliveryRow> = {}): ReadyForDeliveryRow {
  return {
    jobCard: makeJobCard({ status: 'QC_PASSED', warrantyStatus: 'OOW' }),
    invoiceStatus: null,
    payable: true,
    ...overrides,
  };
}

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-0001',
    jobCardId: 'jc-1',
    amount: 367.5,
    subtotal: 350,
    vatRate: 5,
    vatAmount: 17.5,
    dueDate: '2026-08-31T08:00:00Z',
    status: 'DRAFT',
    paymentMethod: null,
    amountReceived: null,
    paymentReference: null,
    paidAt: null,
    recordedByUser: null,
    recordedByUserId: null,
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    invoiceId: 'inv-1',
    method: 'CASH',
    amount: 367.5,
    reference: null,
    recordedByUser: { id: 'user-1', firstName: 'Test', lastName: 'User', email: 't@example.com' },
    recordedByUserId: 'user-1',
    recordedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeEstimate(overrides: Partial<Estimate> = {}): Estimate {
  return {
    id: 'est-1',
    jobCardId: 'jc-1',
    lineItems: [{ description: 'Drum Motor Assembly', quantity: 1, unitPrice: 350 }],
    subtotal: 350,
    vatAmount: 17.5,
    totalAmount: 367.5,
    status: 'DRAFT',
    accessToken: null,
    tokenExpiresAt: null,
    sentAt: null,
    respondedAt: null,
    respondedVia: null,
    recordedByUser: null,
    recordedByUserId: null,
    contactMethod: null,
    contactValue: null,
    responseNotes: null,
    channelsAttempted: [],
    channelsDelivered: [],
    previousEstimateId: null,
    createdBy: undefined,
    createdById: 'user-1',
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

// Frontend Phase 9 additions below.

export function makeAgingBucket(overrides: Partial<AgingBucket> = {}): AgingBucket {
  return {
    label: '0-30 days',
    invoices: [],
    totalOutstanding: 0,
    ...overrides,
  };
}

export function makePortalTrackView(overrides: Partial<PortalTrackView> = {}): PortalTrackView {
  return {
    jobCardNumber: 'JC-0001',
    brand: 'Samsung',
    status: 'IN_PROGRESS',
    warrantyStatus: 'OOW',
    customerApproved: true,
    qcApprovedAt: null,
    delivery: null,
    createdAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

// Only the "real invoice with an amount due" branch needs a builder - the other two
// (not-applicable/IW, and no-invoice-yet) are tiny two/three-field literals tests can just
// write inline.
export function makePortalInvoiceView(
  overrides: Partial<Extract<PortalInvoiceView, { invoiceCreated: true }>> = {},
): Extract<PortalInvoiceView, { invoiceCreated: true }> {
  return {
    applicable: true,
    invoiceCreated: true,
    invoiceNumber: 'INV-0001',
    subtotal: 350,
    vatRate: 5,
    vatAmount: 17.5,
    totalAmount: 367.5,
    amountPaid: 0,
    amountDue: 367.5,
    status: 'DRAFT',
    message: 'Please contact us to arrange payment - Cash, Card, or Bank Transfer.',
    ...overrides,
  };
}

export function makePortalSummaryView(overrides: Partial<PortalSummaryView> = {}): PortalSummaryView {
  return {
    jobCardNumber: 'JC-0001',
    brand: 'Samsung',
    faultCode: 'FLT-01',
    symptomCode: 'SYM-01',
    status: 'QC_PASSED',
    warrantyStatus: 'OOW',
    createdAt: '2026-08-01T08:00:00Z',
    estimate: {
      lineItems: [{ description: 'Drum Motor Assembly', quantity: 1, unitPrice: 350 }],
      subtotal: 350,
      vatAmount: 17.5,
      totalAmount: 367.5,
      status: 'APPROVED',
    },
    invoice: makePortalInvoiceView(),
    delivery: null,
    ...overrides,
  };
}

// Frontend Phase 10 additions below.

export function makeAmcContract(overrides: Partial<AmcContract> = {}): AmcContract {
  return {
    id: 'contract-1',
    contractNumber: 'AMC-0001',
    customerName: 'Al Futtaim Facilities LLC',
    customerPhone: '+971501234567',
    customerEmail: 'facilities@example.com',
    customerAddress: null,
    customerType: 'B2C',
    serviceCentre: { id: 'sc-1', code: 'SC01', name: 'Dubai Main' },
    serviceCentreId: 'sc-1',
    coveredSerialNumbers: ['SN-000123'],
    brand: 'Samsung',
    modelNumber: 'WA80J5710',
    coverageType: 'COMPREHENSIVE',
    serviceLevel: 'Standard',
    visitFrequency: 'QUARTERLY',
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2027-08-31T00:00:00.000Z',
    totalAmount: 4800,
    paymentTerms: 'FULL_UPFRONT',
    assignedTechnician: null,
    assignedTechnicianId: null,
    status: 'ACTIVE',
    cancellationReason: null,
    renewalReminderSentAt: null,
    renewalReminderChannelsAttempted: [],
    renewalReminderChannelsDelivered: [],
    previousContractId: null,
    createdById: 'user-1',
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeAmcScheduleVisit(overrides: Partial<AmcScheduleVisit> = {}): AmcScheduleVisit {
  return {
    id: 'apt-amc-1',
    appointmentNumber: 'APT-20260901-0001',
    status: 'SCHEDULED',
    scheduledAt: '2026-09-01T09:00:00Z',
    amcContractId: 'contract-1',
    ...overrides,
  };
}

export function makeAmcVisitCompletion(overrides: Partial<AmcVisitCompletion> = {}): AmcVisitCompletion {
  return {
    id: 'avc-1',
    amcContractId: 'contract-1',
    appointmentId: 'apt-amc-1',
    visitNumber: 1,
    checklistNotes: 'Checked filters, cleaned drum.',
    customerSignatureBase64: null,
    extraChargeDescription: null,
    extraChargeAmount: null,
    extraChargeApprovedByCustomer: false,
    completedByUserId: 'user-1',
    completedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

export function makeAmcBillingInvoice(overrides: Partial<AmcBillingInvoice> = {}): AmcBillingInvoice {
  return {
    id: 'bi-1',
    invoiceNumber: 'AMCINV-0001',
    amcContractId: 'contract-1',
    periodLabel: 'Full Term',
    amount: 4800,
    status: 'DRAFT',
    paymentMethod: null,
    paymentReference: null,
    paidAt: null,
    recordedByUser: null,
    recordedByUserId: null,
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeUpsellCandidate(overrides: Partial<UpsellCandidate> = {}): UpsellCandidate {
  return {
    jobCardId: 'jc-1',
    jobCardNumber: 'JC-0001',
    customerName: 'Jane Doe',
    customerPhone: '+971509998888',
    estimateAmount: 420,
    ...overrides,
  };
}

// Frontend Phase 11 additions below.

export function makeHarvestedComponent(overrides: Partial<HarvestedComponent> = {}): HarvestedComponent {
  return {
    originalBomItemCode: 'COMP-COMPRESSOR-01',
    itemName: 'Compressor Assembly',
    category: 'RECOVERABLE_SPARE',
    convertedSparePartCode: 'SP-COMPRESSOR-01',
    testedCondition: 'GOOD_WORKING',
    quantity: 1,
    eligibleForConversion: true,
    selectedForConversion: false,
    recoveryUnitPrice: null,
    quantityConverted: null,
    convertedSparePartId: null,
    ...overrides,
  };
}

export function makeDismantlingRecord(overrides: Partial<DismantlingRecord> = {}): DismantlingRecord {
  return {
    id: 'dism-1',
    recordNumber: 'DISM-0001',
    applianceSerialNumber: 'SN-000987',
    modelId: 'M100',
    damageLocationNotes: 'Confirmed DOA, water damage, bay 3',
    status: 'PENDING_HARVEST',
    harvestedComponents: [],
    createdById: 'user-1',
    harvestedByUserId: null,
    harvestedAt: null,
    verifiedByUserId: null,
    verifiedAt: null,
    verificationNotes: null,
    pricedByUserId: null,
    postedAt: null,
    totalRecoveredValue: 0,
    cancellationReason: null,
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeComponentYieldMatrix(overrides: Partial<ComponentYieldMatrix> = {}): ComponentYieldMatrix {
  return {
    id: 'cym-1',
    modelId: 'M100',
    originalBomItemCode: 'COMP-COMPRESSOR-01',
    itemName: 'Compressor Assembly',
    category: 'RECOVERABLE_SPARE',
    defaultRecoveryEvaluation: 85,
    convertedSparePartCode: 'SP-COMPRESSOR-01',
    isActive: true,
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

// Frontend Phase 12 additions below.

export function makeKanbanCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    jobCardId: 'jc-1',
    jobCardNumber: 'JC-0001',
    status: 'IN_PROGRESS',
    section: 'WORKSHOP_REPAIR',
    serialNumber: 'SN-000123',
    brand: 'Samsung',
    warrantyStatus: 'OOW',
    deliveryNumber: null,
    updatedAt: '2026-09-01T09:00:00Z',
    ...overrides,
  };
}

export function makeKanbanBoard(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
  return {
    asOf: '2026-09-01T09:00:05Z',
    columns: [
      { key: 'SCHEDULED', label: 'Scheduled', count: 0, jobCards: [] },
      { key: 'ON_SITE', label: 'On-Site', count: 0, jobCards: [] },
      { key: 'WIP', label: 'WIP', count: 1, jobCards: [makeKanbanCard()] },
      { key: 'SPARE_PENDING', label: 'Spare Pending', count: 0, jobCards: [] },
      { key: 'APPROVAL_PENDING', label: 'Approval Pending', count: 0, jobCards: [] },
      { key: 'QC_COMPLETED', label: 'QC Completed', count: 0, jobCards: [] },
      { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', count: 0, jobCards: [] },
      { key: 'DELIVERED', label: 'Delivered', count: 0, jobCards: [] },
    ],
    totalActiveJobs: 1,
    ...overrides,
  };
}

export function makeApprovalAgingItem(overrides: Partial<ApprovalAgingItem> = {}): ApprovalAgingItem {
  return {
    estimateId: 'est-1',
    jobCardId: 'jc-1',
    jobCardNumber: 'JC-0001',
    sentAt: '2026-09-01T04:00:00Z',
    ageHours: 5.25,
    breached: true,
    ...overrides,
  };
}

export function makeApprovalAgingReport(overrides: Partial<ApprovalAgingReport> = {}): ApprovalAgingReport {
  return {
    asOf: '2026-09-01T09:00:00Z',
    thresholdHours: 4,
    breachedCount: 1,
    items: [makeApprovalAgingItem()],
    ...overrides,
  };
}

export function makeServiceEfficiencyReport(overrides: Partial<ServiceEfficiencyReport> = {}): ServiceEfficiencyReport {
  return {
    asOf: '2026-09-01T09:00:00Z',
    overallAvgHours: 3.5,
    sampleSize: 4,
    byTechnician: [{ key: 'user-1', label: 'Test Technician', jobCount: 4, avgHours: 3.5 }],
    byCategory: [{ key: 'WASHING_MACHINE', label: 'WASHING_MACHINE', jobCount: 4, avgHours: 3.5 }],
    ...overrides,
  };
}

export function makeFirstTimeFixRateReport(overrides: Partial<FirstTimeFixRateReport> = {}): FirstTimeFixRateReport {
  return {
    asOf: '2026-09-01T09:00:00Z',
    totalCompletedJobs: 10,
    onSiteOnlyCompletedJobs: 6,
    rate: 0.6,
    ...overrides,
  };
}

export function makeDashboardOverview(overrides: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    asOf: '2026-09-01T09:00:00Z',
    kanbanSummary: {
      asOf: '2026-09-01T09:00:00Z',
      columns: [
        { key: 'SCHEDULED', label: 'Scheduled', count: 0 },
        { key: 'ON_SITE', label: 'On-Site', count: 0 },
        { key: 'WIP', label: 'WIP', count: 1 },
        { key: 'SPARE_PENDING', label: 'Spare Pending', count: 0 },
        { key: 'APPROVAL_PENDING', label: 'Approval Pending', count: 0 },
        { key: 'QC_COMPLETED', label: 'QC Completed', count: 0 },
        { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', count: 0 },
        { key: 'DELIVERED', label: 'Delivered', count: 0 },
      ],
      totalActiveJobs: 1,
    },
    approvalAging: { breachedCount: 1, oldestAgeHours: 5.25 },
    firstTimeFixRate: makeFirstTimeFixRateReport(),
    serviceEfficiency: { overallAvgHours: 3.5, sampleSize: 4 },
    ...overrides,
  };
}

export function makeAppointmentDashboardStats(overrides: Partial<AppointmentDashboardStats> = {}): AppointmentDashboardStats {
  return {
    today: { scheduled: 2, confirmed: 3, onSite: 1, completed: 4, cancelled: 0 },
    week: { total: 20, byStatus: { SCHEDULED: 2, CONFIRMED: 3, ON_SITE: 1, COMPLETED: 13, CANCELLED: 1 } },
    ...overrides,
  };
}

export function makeGlPosting(overrides: Partial<GlPosting> = {}): GlPosting {
  return {
    id: 'gl-1',
    sourceType: 'INVOICE_PAYMENT',
    sourceId: 'inv-1',
    description: 'Payment received for INV-0001 (CASH)',
    debitAccount: '1000-CASH',
    creditAccount: '4000-SERVICE-REVENUE',
    amount: 250,
    postedAt: '2026-09-01T09:00:00Z',
    ...overrides,
  };
}

export function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-cce',
    name: 'CCE',
    displayName: 'Customer Care Executive',
    description: 'Customer care executive',
    permissions: ['manage:appointments', 'manage:job-cards'],
    isSystem: true,
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-2',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya@jackys.com',
    employeeId: 'E-2',
    phone: null,
    status: 'ACTIVE',
    role: makeRole(),
    lastLoginAt: null,
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
    ...overrides,
  };
}

export function makeRoleAccessGrant(overrides: Partial<RoleAccessGrant> = {}): RoleAccessGrant {
  return {
    id: 'grant-1',
    userId: 'user-2',
    grantedRoleName: 'TECHNICAL_TEAM_LEADER',
    grantedByUserId: 'admin-1',
    grantedAt: '2026-09-03T08:00:00Z',
    expiresAt: '2026-09-20T08:00:00Z',
    revokedAt: null,
    revokedByUserId: null,
    notes: null,
    ...overrides,
  };
}

export function makeCapabilityMatrixEntry(overrides: Partial<CapabilityMatrixEntry> = {}): CapabilityMatrixEntry {
  return {
    key: 'SCHEDULE_CCE_MANAGE',
    label: 'Create & manage appointments (create, cancel, confirm, map link, scheduling grid)',
    module: 'Appointments',
    migrated: true,
    grantedRoleIds: ['role-cce'],
    ...overrides,
  };
}

export function makeRolePermissionUserRef(overrides: Partial<RolePermissionUserRef> = {}): RolePermissionUserRef {
  return {
    id: 'user-2',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya@jackys.com',
    status: 'ACTIVE',
    ...overrides,
  };
}

export function makeRoleCapabilityModule(overrides: Partial<RoleCapabilityModule> = {}): RoleCapabilityModule {
  return {
    module: 'job-cards',
    endpoints: [
      { method: 'POST', path: '/job-cards/:id/warranty-override', summary: 'Warranty Override (FR-17/AC-18)', requiresSeparatePermissionGrant: null },
      { method: 'POST', path: '/job-cards/:id/qc/approve', summary: 'QC approve (FR-10)', requiresSeparatePermissionGrant: 'QC_APPROVAL' },
    ],
    ...overrides,
  };
}

// Frontend Phase 14 additions below (BRD 18.2/18.3/18.4 reports).

export function makeFinanceSummary(overrides: Partial<FinanceSummary> = {}): FinanceSummary {
  return {
    periodStart: null,
    periodEnd: null,
    periodBasis: { oow: 'Invoice.createdAt', iw: 'DebitNote.postedAt' },
    revenueSummary: {
      totalServiceRevenue: 5000,
      totalLabourRevenue: null,
      totalSparePartsRevenue: null,
      totalAmcRevenue: 1200,
    },
    costSummary: {
      totalLabourCost: null,
      totalSparePartsCost: null,
      totalAmcCost: null,
      totalCOGS: null,
    },
    profitSummary: { grossProfit: null, grossProfitMarginPct: null },
    oow: {
      totalOowRevenue: 5000,
      totalLabourRevenueOow: null,
      totalLabourCostOow: null,
      labourProfitOow: null,
      totalSpareRevenueOow: null,
      totalSpareCostOow: null,
      spareProfitOow: null,
      totalOowProfit: null,
      oowMarginPct: null,
      note: 'OOW cost is not tracked at a per-job level in this app.',
    },
    warranty: {
      totalSpareCostIw: 800,
      totalLabourCostIw: 200,
      totalWarrantyCost: 1000,
      amountClaimedFromSuppliers: 900,
      amountReceived: 700,
      recoveryRatePct: 70,
    },
    amc: {
      totalAmcRevenue: 1200,
      totalAmcLabourCost: null,
      totalAmcSpareCost: null,
      amcGrossProfit: null,
      amcMarginPct: null,
      activeContractsCount: 3,
      costTrackingNote: 'AMC cost is not tracked per-visit in this app.',
    },
    ...overrides,
  };
}

export function makeGpByServiceCentreRow(overrides: Partial<GpByServiceCentreRow> = {}): GpByServiceCentreRow {
  return {
    serviceCentreId: 'sc-1',
    serviceCentreName: 'Dubai Main',
    oowRevenue: 5000,
    iwRechargeRevenue: 1000,
    iwLabourCost: 200,
    amcRevenue: 1200,
    grossProfit: null,
    gpMarginPct: null,
    ...overrides,
  };
}

export function makeInterdepartmentRechargeRow(overrides: Partial<InterdepartmentRechargeRow> = {}): InterdepartmentRechargeRow {
  return {
    salesChannelName: 'Retail',
    jobCount: 4,
    sparePartsCostInternal: 400,
    labourCostInternal: 100,
    totalDebitNoteAmount: 500,
    pendingCount: 1,
    postedToGlCount: 3,
    ...overrides,
  };
}

export function makeUnpaidInvoicesReport(overrides: Partial<UnpaidInvoicesReport> = {}): UnpaidInvoicesReport {
  return {
    asOf: '2026-09-07T09:00:00Z',
    b2b: [
      {
        jobCardId: 'jc-1',
        jobCardNumber: 'JC-0001',
        customerName: 'Acme LLC',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        invoiceDate: '2026-09-01T00:00:00Z',
        amountDue: 500,
        agingBucket: '3-7 days',
      },
    ],
    b2c: [],
    note: 'Aging buckets: 0-2/3-7/8+ days since invoice date.',
    ...overrides,
  };
}

export function makeProfitTrendPoint(overrides: Partial<ProfitTrendPoint> = {}): ProfitTrendPoint {
  return {
    periodLabel: '2026-09',
    periodStart: '2026-09-01T00:00:00Z',
    periodEnd: '2026-09-30T00:00:00Z',
    oowRevenue: 5000,
    iwRechargeRevenue: 1000,
    amcRevenue: 1200,
    iwCost: 200,
    iwGrossProfit: 800,
    totalCOGS: null,
    totalGrossProfit: null,
    gpMarginPct: null,
    ...overrides,
  };
}

export function makeProductFailureRatioRow(overrides: Partial<ProductFailureRatioRow> = {}): ProductFailureRatioRow {
  return {
    periodLabel: '2026-09',
    model: 'WM-500',
    brand: 'Samsung',
    count: 3,
    ...overrides,
  };
}

export function makeRepeatComplaintItem(overrides: Partial<RepeatComplaintItem> = {}): RepeatComplaintItem {
  return {
    serialNumber: 'SN-000123',
    totalJobCount: 2,
    repeatWithin30Days: true,
    jobCardNumbers: ['JC-0001', 'JC-0002'],
    minGapDays: 10,
    ...overrides,
  };
}

export function makeRwrAnalysisRow(overrides: Partial<RwrAnalysisRow> = {}): RwrAnalysisRow {
  return {
    model: 'WM-500',
    reason: 'Customer declined repair cost',
    region: 'Dubai',
    count: 2,
    ...overrides,
  };
}

export function makeTechnicianProductivityReport(overrides: Partial<TechnicianProductivityReport> = {}): TechnicianProductivityReport {
  return {
    asOf: '2026-09-07T09:00:00Z',
    periodStart: null,
    periodEnd: null,
    rows: [
      {
        technicianId: 'user-1',
        technicianName: 'Test Technician',
        jobsCompleted: 4,
        avgHoursLoginToQc: 3.5,
        onTimeArrivalPct: 90,
      },
    ],
    note: 'Customer rating is not captured anywhere in this app.',
    ...overrides,
  };
}

export function makeSlaBreachReport(overrides: Partial<SlaBreachReport> = {}): SlaBreachReport {
  return {
    asOf: '2026-09-07T09:00:00Z',
    thresholdHours: 48,
    breachedCount: 1,
    items: [
      {
        jobCardId: 'jc-1',
        jobCardNumber: 'JC-0001',
        createdAt: '2026-09-01T00:00:00Z',
        qcApprovedAt: '2026-09-05T00:00:00Z',
        hoursElapsed: 96,
        hoursOverThreshold: 48,
      },
    ],
    ...overrides,
  };
}

export function makeSpareConsumptionReport(overrides: Partial<SpareConsumptionReport> = {}): SpareConsumptionReport {
  return {
    periodStart: null,
    periodEnd: null,
    topByQuantity: [{ sparePartId: 'sp-1', code: 'SP-001', name: 'Drum Belt', totalQuantity: 10, totalValue: 500 }],
    topByValue: [{ sparePartId: 'sp-2', code: 'SP-002', name: 'Motor', totalQuantity: 2, totalValue: 2000 }],
    byModel: [{ key: 'WM-500', totalQuantity: 6, totalValue: 1200 }],
    byWarrantyStatus: [{ key: 'OOW', totalQuantity: 8, totalValue: 1800 }],
    ...overrides,
  };
}

// Frontend Phase 15 additions below (Warranty Claims, BRD Workflow 12).

export function makeWarrantyClaimLine(overrides: Partial<WarrantyClaimLine> = {}): WarrantyClaimLine {
  return {
    id: 'line-1',
    warrantyClaimId: 'claim-1',
    inventoryReservationId: 'res-1',
    jobCardId: 'jc-1',
    jobCardNumber: 'JC-0001',
    serialNumber: 'SN-000123',
    sparePartCode: 'SP-001',
    sparePartName: 'Drum Belt',
    quantity: 1,
    unitCost: 85,
    lineAmount: 85,
    consumedAt: '2026-08-15T10:00:00Z',
    createdAt: '2026-09-01T09:00:00Z',
    ...overrides,
  };
}

export function makeWarrantyClaim(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: 'claim-1',
    claimNumber: 'WCLM-0001',
    supplier: 'Samsung Gulf FZE',
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: '2026-08-31T00:00:00Z',
    status: 'DRAFT',
    totalClaimedAmount: 85,
    generatedByUserId: 'user-1',
    claimReferenceNumber: null,
    submittedByUserId: null,
    submittedAt: null,
    creditNoteNumber: null,
    creditNoteAmount: null,
    creditReceivedByUserId: null,
    creditReceivedAt: null,
    notes: null,
    cancellationReason: null,
    lines: [makeWarrantyClaimLine()],
    createdAt: '2026-09-01T09:00:00Z',
    updatedAt: '2026-09-01T09:00:00Z',
    ...overrides,
  };
}

export function makeRecoveryRate(overrides: Partial<RecoveryRate> = {}): RecoveryRate {
  return {
    supplier: null,
    totalClaimed: 850,
    totalRecovered: 700,
    rate: 82.35,
    ...overrides,
  };
}
