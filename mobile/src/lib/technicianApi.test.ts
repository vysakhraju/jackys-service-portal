// Holistic test-master pass (2026-09-07): same gap as masterDataApi.test.ts - every
// screen test mocks this whole module wholesale, so these wrappers' actual URLs/HTTP
// methods have never been exercised anywhere. Covers all seven exported functions,
// including the two newest (Phase 5's getOwnJobCard/requestNeedSpare/completeVisit).
import { api } from './api';
import {
  captureFaultSymptom,
  captureSerialNumber,
  completeVisit,
  getMySchedule,
  getOwnJobCard,
  getVisit,
  requestNeedSpare,
  startVisit,
} from './technicianApi';

jest.mock('./api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue({ data: null });
  mockedPost.mockResolvedValue({ data: null });
});

describe('getMySchedule', () => {
  it('calls GET /technician/schedule with no date param by default', async () => {
    await getMySchedule();
    expect(mockedGet).toHaveBeenCalledWith('/technician/schedule', { params: {} });
  });

  it('calls GET /technician/schedule with a date param when given', async () => {
    await getMySchedule('2026-09-07');
    expect(mockedGet).toHaveBeenCalledWith('/technician/schedule', { params: { date: '2026-09-07' } });
  });
});

describe('startVisit', () => {
  it('calls POST /technician/visits/:id/start with the GPS payload', async () => {
    await startVisit('appt-1', { gpsLat: 25.2, gpsLng: 55.3 });
    expect(mockedPost).toHaveBeenCalledWith('/technician/visits/appt-1/start', { gpsLat: 25.2, gpsLng: 55.3 });
  });
});

describe('getVisit', () => {
  it('calls GET /technician/visits/:id', async () => {
    await getVisit('appt-1');
    expect(mockedGet).toHaveBeenCalledWith('/technician/visits/appt-1');
  });
});

describe('captureSerialNumber', () => {
  it('calls POST /technician/visits/:id/serial-number with the payload', async () => {
    await captureSerialNumber('appt-1', { serialNumber: 'SN123', brand: 'Samsung' });
    expect(mockedPost).toHaveBeenCalledWith('/technician/visits/appt-1/serial-number', {
      serialNumber: 'SN123',
      brand: 'Samsung',
    });
  });
});

describe('captureFaultSymptom', () => {
  it('calls POST /technician/visits/:id/fault-symptom with the payload', async () => {
    await captureFaultSymptom('appt-1', { faultCode: 'F001', symptomCode: 'S001' });
    expect(mockedPost).toHaveBeenCalledWith('/technician/visits/appt-1/fault-symptom', {
      faultCode: 'F001',
      symptomCode: 'S001',
    });
  });
});

describe('getOwnJobCard', () => {
  it('calls GET /technician/visits/:id/job-card', async () => {
    await getOwnJobCard('appt-1');
    expect(mockedGet).toHaveBeenCalledWith('/technician/visits/appt-1/job-card');
  });

  // 2026-09-07: the response is always the {jobCard, spareRequest} wrapper now, never a
  // bare null - jobCard itself is null until staff create one.
  it('resolves with jobCard: null when the backend has not created a Job Card yet', async () => {
    mockedGet.mockResolvedValue({ data: { jobCard: null, spareRequest: null } });
    await expect(getOwnJobCard('appt-1')).resolves.toEqual({ jobCard: null, spareRequest: null });
  });

  it('resolves with the latest Need Spare request alongside the Job Card', async () => {
    mockedGet.mockResolvedValue({
      data: {
        jobCard: { id: 'jc-1', jobCardNumber: 'JC-0001', status: 'SECTION_ASSIGNED', section: 'ON_SITE_REPAIR', onSiteCompletionNotes: null },
        spareRequest: { id: 'res-1', sparePartId: 'part-1', quantityRequested: 2, status: 'PENDING_REVIEW' },
      },
    });
    const result = await getOwnJobCard('appt-1');
    expect(result.spareRequest).toEqual({ id: 'res-1', sparePartId: 'part-1', quantityRequested: 2, status: 'PENDING_REVIEW' });
  });
});

describe('requestNeedSpare', () => {
  it('calls POST /technician/visits/:id/need-spare with the payload, including the idempotency key', async () => {
    await requestNeedSpare('appt-1', { sparePartId: 'part-1', quantity: 2, idempotencyKey: 'need-spare-abc' });
    expect(mockedPost).toHaveBeenCalledWith('/technician/visits/appt-1/need-spare', {
      sparePartId: 'part-1',
      quantity: 2,
      idempotencyKey: 'need-spare-abc',
    });
  });
});

describe('completeVisit', () => {
  it('calls POST /technician/visits/:id/complete with the notes payload', async () => {
    await completeVisit('appt-1', { notes: 'Replaced relay on-site' });
    expect(mockedPost).toHaveBeenCalledWith('/technician/visits/appt-1/complete', { notes: 'Replaced relay on-site' });
  });

  it('calls POST /technician/visits/:id/complete with undefined notes when none are given', async () => {
    await completeVisit('appt-1', {});
    expect(mockedPost).toHaveBeenCalledWith('/technician/visits/appt-1/complete', {});
  });
});
