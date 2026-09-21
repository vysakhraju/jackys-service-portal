import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeAppointment } from '../../test/fixtures';

vi.mock('../../lib/workshopIntakeApi', () => ({
  getWorkshopIntake: vi.fn(),
  markWorkshopReceived: vi.fn(),
  captureWorkshopSerialNumber: vi.fn(),
  captureWorkshopFaultSymptom: vi.fn(),
}));
vi.mock('../../lib/masterDataApi', () => ({
  listFaultSymptoms: vi.fn(),
}));

import {
  captureWorkshopFaultSymptom,
  captureWorkshopSerialNumber,
  getWorkshopIntake,
  markWorkshopReceived,
} from '../../lib/workshopIntakeApi';
import { listFaultSymptoms } from '../../lib/masterDataApi';
import { WorkshopIntakeModal } from './WorkshopIntakeModal';

function makeFaultSymptom(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'fs-1',
    faultCode: 'F002',
    faultDescription: 'Not draining',
    symptomCode: 'S002',
    symptomDescription: 'Water remains in drum',
    category: 'WASHING_MACHINE',
    requiresWorkshop: true,
    isActive: true,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function makeIntake(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'intake-1',
    appointmentId: 'appt-1',
    receivedByUserId: 'user-1',
    receivedAt: '2026-09-16T08:00:00Z',
    serialNumber: null,
    brand: null,
    warrantyStatus: null,
    warrantySupplier: null,
    warrantyPeriodMonths: null,
    serialNumberCapturedAt: null,
    faultCode: null,
    symptomCode: null,
    faultSymptomCapturedAt: null,
    createdAt: '2026-09-16T08:00:00Z',
    updatedAt: '2026-09-16T08:00:00Z',
    ...overrides,
  };
}

function renderModal(onClose = vi.fn(), appointmentOverrides: Partial<Record<string, unknown>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkshopIntakeModal
          appointment={makeAppointment({ id: 'appt-1', status: 'COLLECTED_TO_WS', ...appointmentOverrides })}
          onClose={onClose}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getWorkshopIntake).mockReset();
  vi.mocked(markWorkshopReceived).mockReset();
  vi.mocked(captureWorkshopSerialNumber).mockReset();
  vi.mocked(captureWorkshopFaultSymptom).mockReset();
  vi.mocked(listFaultSymptoms).mockReset();
  vi.mocked(listFaultSymptoms).mockResolvedValue([makeFaultSymptom()]);
});

describe('WorkshopIntakeModal', () => {
  it('renders nothing when no appointment is given', () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkshopIntakeModal appointment={null} onClose={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a Mark received button when no intake exists yet', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(null);
    renderModal();

    expect(await screen.findByRole('button', { name: 'Mark received' })).toBeInTheDocument();
    // Later steps aren't reachable yet.
    expect(screen.queryByText(/Serial number \+ warranty check/)).not.toBeInTheDocument();
  });

  it('marks received, then invalidates so the intake query re-fetches', async () => {
    const user = userEvent.setup();
    vi.mocked(getWorkshopIntake).mockResolvedValue(null);
    vi.mocked(markWorkshopReceived).mockResolvedValue(makeIntake());
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Mark received' }));
    await waitFor(() => expect(markWorkshopReceived).toHaveBeenCalledWith('appt-1'));
  });

  it('captures serial number + warranty once received, and blocks fault/symptom until then', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake());
    renderModal();

    expect(await screen.findByText(/Serial number \+ warranty check/)).toBeInTheDocument();
    expect(screen.getByText('Capture the serial number first — the backend blocks this until then.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Serial number'), 'SN990000');
    vi.mocked(captureWorkshopSerialNumber).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    await user.click(screen.getByRole('button', { name: 'Capture' }));

    // Brand pre-fills from the appointment's own brand (Samsung, per the fixture) - the
    // same "prefill, don't force a re-type" convention FieldVisitsPage uses.
    await waitFor(() => expect(captureWorkshopSerialNumber).toHaveBeenCalledWith('appt-1', { serialNumber: 'SN990000', brand: 'Samsung' }));
  });

  it('shows the Create Job Card link only once S/N, warranty, fault, and symptom are all captured', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(
      makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW', faultCode: 'F001', symptomCode: 'S001' }),
    );
    renderModal();

    const link = await screen.findByRole('link', { name: /Continue to Job Cards/ });
    expect(link).toHaveAttribute('href', '/job-cards?appointmentId=appt-1');
    expect(screen.queryByText('Complete steps 1-3 above first.')).not.toBeInTheDocument();
  });

  it('does not show the Create Job Card link while intake is incomplete', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    renderModal();

    await screen.findByText('Complete steps 1-3 above first.');
    expect(screen.queryByRole('link', { name: /Continue to Job Cards/ })).not.toBeInTheDocument();
  });

  it('records fault/symptom once S/N has been captured, picked from the Fault & Symptoms master in two cascaded steps', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    vi.mocked(captureWorkshopFaultSymptom).mockResolvedValue(
      makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW', faultCode: 'F002', symptomCode: 'S002' }),
    );
    renderModal();

    const user = userEvent.setup();
    // Step one: pick the symptom (customer complaint).
    const symptomSelect = await screen.findByLabelText('Symptom (customer complaint)');
    const symptomOption = await screen.findByRole('option', { name: /S002 — Water remains in drum/ });
    await user.selectOptions(symptomSelect, symptomOption);

    // Step two: only now does the Fault dropdown offer the row(s) recorded against that
    // symptom - proves it's sourced from the master, not free text.
    const faultSelect = await screen.findByLabelText('Fault (technician diagnosis)');
    const faultOption = await screen.findByRole('option', { name: /F002 — Not draining/ });
    await user.selectOptions(faultSelect, faultOption);
    await user.click(screen.getByRole('button', { name: 'Capture' }));

    await waitFor(() => expect(captureWorkshopFaultSymptom).toHaveBeenCalledWith('appt-1', { faultCode: 'F002', symptomCode: 'S002' }));
  });

  it('offers only the faults recorded against the chosen symptom, deduping the symptom list itself', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    // Two faults share one symptom (S002) - the real after-sales case this feature exists
    // for: one customer complaint, several possible diagnoses.
    vi.mocked(listFaultSymptoms).mockResolvedValue([
      makeFaultSymptom({ id: 'fs-1', faultCode: 'F002', faultDescription: 'Not draining' }),
      makeFaultSymptom({ id: 'fs-2', faultCode: 'F003', faultDescription: 'Pump blocked' }),
      makeFaultSymptom({ id: 'fs-3', faultCode: 'F010', symptomCode: 'S010', symptomDescription: 'Excess noise' }),
    ]);
    renderModal();

    const user = userEvent.setup();
    const symptomSelect = await screen.findByLabelText('Symptom (customer complaint)');
    // Only ONE option per distinct symptomCode, even though S002 backs two rows. findAllBy*
    // (not getAllBy*) since the options only render once the query resolves.
    expect(await screen.findAllByRole('option', { name: /^S002 —/ })).toHaveLength(1);

    await user.selectOptions(symptomSelect, await screen.findByRole('option', { name: /S002 —/ }));

    const faultSelect = await screen.findByLabelText('Fault (technician diagnosis)');
    expect(faultSelect).not.toBeDisabled();
    expect(screen.getByRole('option', { name: /F002 — Not draining/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /F003 — Pump blocked/ })).toBeInTheDocument();
    // The S010-symptom row must not leak into this symptom's fault list.
    expect(screen.queryByRole('option', { name: /F010/ })).not.toBeInTheDocument();
  });

  it('scopes the Fault & Symptoms query to the appointment model\'s category when it has one', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    renderModal(vi.fn(), { applianceModel: { id: 'model-1', brand: 'Samsung', model: 'WA80J5710', category: 'WASHING_MACHINE' } });

    await screen.findByLabelText('Symptom (customer complaint)');
    await waitFor(() => expect(listFaultSymptoms).toHaveBeenLastCalledWith('WASHING_MACHINE'));
  });

  it('falls back to every category, with an explanatory note, when the model has no category set', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    renderModal(); // default fixture's applianceModel is null

    await screen.findByLabelText('Symptom (customer complaint)');
    await waitFor(() => expect(listFaultSymptoms).toHaveBeenLastCalledWith(undefined));
    expect(screen.getByText(/no category set, so every category's symptoms are shown/)).toBeInTheDocument();
  });

  it('shows a fetch error instead of a free-text box if the Fault & Symptoms master fails to load', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    vi.mocked(listFaultSymptoms).mockRejectedValue(new Error('network error'));
    renderModal();

    await screen.findByText(/Step 3/);
    await waitFor(() => expect(screen.queryByLabelText('Symptom (customer complaint)')).not.toBeInTheDocument());
  });
});
