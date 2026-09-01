// Shared fixture builders for tests - full, type-complete objects with sensible defaults,
// overridable per-test via a Partial<> merge. Keeps individual test files from having to
// restate every field of these fairly large backend-mirrored shapes.
import type { Appointment } from '../lib/appointmentsTypes';
import type { JobCard } from '../lib/jobCardsTypes';
import type { Estimate } from '../lib/estimatesTypes';
import type { InventoryReservationWithAge } from '../lib/inventoryTypes';
import type { WorkshopState } from '../lib/workshopTypes';
import type { UserPermissionGrant } from '../lib/permissionsTypes';
import type { Delivery, ReadyForDeliveryRow } from '../lib/deliveryTypes';
import type { AgingBucket, Invoice, Payment } from '../lib/invoicingTypes';
import type { PortalInvoiceView, PortalSummaryView, PortalTrackView } from '../lib/customerPortalTypes';
import type { AmcBillingInvoice, AmcContract, AmcScheduleVisit, AmcVisitCompletion, UpsellCandidate } from '../lib/amcTypes';
import type { DismantlingRecord, HarvestedComponent } from '../lib/dismantlingTypes';
import type { ComponentYieldMatrix } from '../lib/masterDataTypes';

export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    appointmentNumber: 'APT-0001',
    type: 'OUT_OF_WARRANTY',
    status: 'COMPLETED',
    customerType: 'B2C',
    customerName: 'Test Customer',
    customerPhone: '+971501112222',
    customerEmail: 'customer@example.com',
    customerAddress: null,
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
