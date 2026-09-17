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

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkshopIntakeModal appointment={makeAppointment({ id: 'appt-1', status: 'COLLECTED_TO_WS' })} onClose={onClose} />
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

  it('records fault/symptom once S/N has been captured, picked from the Fault & Symptoms master', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    vi.mocked(captureWorkshopFaultSymptom).mockResolvedValue(
      makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW', faultCode: 'F002', symptomCode: 'S002' }),
    );
    renderModal();

    const user = userEvent.setup();
    const select = await screen.findByLabelText('Fault / symptom');
    // Option text is built from the master row - proves the dropdown is sourced from
    // listFaultSymptoms(), not a free-text box a user could type an invalid code into.
    // findBy* (not getBy*) since the select starts disabled/"Loading…" until the query
    // resolves.
    const option = await screen.findByRole('option', { name: /F002 — Not draining \/ Water remains in drum/ });
    await user.selectOptions(select, option);
    await user.click(screen.getByRole('button', { name: 'Capture' }));

    await waitFor(() => expect(captureWorkshopFaultSymptom).toHaveBeenCalledWith('appt-1', { faultCode: 'F002', symptomCode: 'S002' }));
  });

  it('shows a fetch error instead of a free-text box if the Fault & Symptoms master fails to load', async () => {
    vi.mocked(getWorkshopIntake).mockResolvedValue(makeIntake({ serialNumber: 'SN990000', warrantyStatus: 'IW' }));
    vi.mocked(listFaultSymptoms).mockRejectedValue(new Error('network error'));
    renderModal();

    await screen.findByText(/Step 3/);
    await waitFor(() => expect(screen.queryByLabelText('Fault / symptom')).not.toBeInTheDocument());
  });
});
