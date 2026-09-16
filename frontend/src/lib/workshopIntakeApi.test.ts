import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { captureWorkshopFaultSymptom, captureWorkshopSerialNumber, getWorkshopIntake, markWorkshopReceived } from './workshopIntakeApi';

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe('workshopIntakeApi', () => {
  it('getWorkshopIntake fetches GET /workshop-intake/:appointmentId', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null });
    await getWorkshopIntake('apt-1');
    expect(api.get).toHaveBeenCalledWith('/workshop-intake/apt-1');
  });

  it('markWorkshopReceived posts to the mark-received endpoint', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await markWorkshopReceived('apt-1');
    expect(api.post).toHaveBeenCalledWith('/workshop-intake/apt-1/mark-received');
  });

  it('captureWorkshopSerialNumber posts the serial number + brand', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await captureWorkshopSerialNumber('apt-1', { serialNumber: 'SN1', brand: 'LG' });
    expect(api.post).toHaveBeenCalledWith('/workshop-intake/apt-1/serial-number', { serialNumber: 'SN1', brand: 'LG' });
  });

  it('captureWorkshopFaultSymptom posts the fault + symptom codes', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await captureWorkshopFaultSymptom('apt-1', { faultCode: 'F001', symptomCode: 'S001' });
    expect(api.post).toHaveBeenCalledWith('/workshop-intake/apt-1/fault-symptom', { faultCode: 'F001', symptomCode: 'S001' });
  });
});
