import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/amcApi', () => ({ completeAmcVisit: vi.fn() }));

import { completeAmcVisit } from '../../lib/amcApi';
import { CompleteVisitModal } from './CompleteVisitModal';

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompleteVisitModal open onClose={vi.fn()} appointmentId="apt-1" appointmentNumber="APT-20260901-0001" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(completeAmcVisit).mockReset();
});

describe('CompleteVisitModal', () => {
  it('submits with no extra charge fine (checklist only)', async () => {
    vi.mocked(completeAmcVisit).mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/Checklist notes/i), 'All good');
    await user.click(screen.getByRole('button', { name: 'Complete visit' }));

    expect(completeAmcVisit).toHaveBeenCalledWith('apt-1', expect.objectContaining({ checklistNotes: 'All good' }));
  });

  // the-fool pre-mortem: AMC coverage is pre-paid, nothing extra is billed without the
  // customer explicitly approving it on the spot - this blocks it client-side, matching
  // the backend's own 400 reason, before the request ever fires.
  it('blocks submission client-side when an extra charge is entered without ticking approval', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/Amount \(AED\)/i), '150');
    expect(screen.getByText(/requires the approval box above/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete visit' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Complete visit' }));
    expect(completeAmcVisit).not.toHaveBeenCalled();
  });

  it('allows submission with an extra charge once approval is ticked', async () => {
    vi.mocked(completeAmcVisit).mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/Amount \(AED\)/i), '150');
    await user.type(screen.getByLabelText(/Description/i), 'Extra part');
    await user.click(screen.getByLabelText(/Customer approved this extra charge/i));
    expect(screen.getByRole('button', { name: 'Complete visit' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Complete visit' }));
    expect(completeAmcVisit).toHaveBeenCalledWith(
      'apt-1',
      expect.objectContaining({ extraChargeAmount: 150, extraChargeApprovedByCustomer: true, extraChargeDescription: 'Extra part' }),
    );
  });
});
