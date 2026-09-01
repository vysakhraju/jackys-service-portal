import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeDismantlingRecord, makeHarvestedComponent } from '../../test/fixtures';

vi.mock('../../lib/dismantlingApi', () => ({ priceAndPostDismantlingRecord: vi.fn() }));

import { priceAndPostDismantlingRecord } from '../../lib/dismantlingApi';
import { PriceAndPostModal } from './PriceAndPostModal';

const eligibleRecord = makeDismantlingRecord({
  id: 'r1',
  recordNumber: 'DISM-0001',
  status: 'VERIFIED',
  harvestedComponents: [
    makeHarvestedComponent({ originalBomItemCode: 'CODE-A', itemName: 'Compressor', quantity: 2, eligibleForConversion: true }),
    makeHarvestedComponent({ originalBomItemCode: 'CODE-B', itemName: 'PCB Board', quantity: 1, eligibleForConversion: true }),
  ],
});

function renderModal(record = eligibleRecord) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PriceAndPostModal open onClose={vi.fn()} record={record} onPosted={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(priceAndPostDismantlingRecord).mockReset();
});

describe('PriceAndPostModal - finality (the-fool finding #2)', () => {
  it('always shows the "only pricing pass" banner while the modal is open', () => {
    renderModal();
    // "only" is wrapped in its own <b>, so it's not part of the same text node as the
    // rest of the sentence - match the surrounding text instead of spanning the tag.
    expect(screen.getByText('only')).toBeInTheDocument();
    expect(screen.getByText(/pricing pass this record will ever get/)).toBeInTheDocument();
  });

  it('requires the forfeit-confirmation checkbox before submit enables when only a subset is selected', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('checkbox', { name: /CODE-A/ }));
    const priceInputs = screen.getAllByRole('spinbutton');
    await user.type(priceInputs[0], '85');

    expect(screen.getByText(/I understand the 1 component\(s\) I haven't selected will be permanently forfeited/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post recovery' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    expect(screen.getByRole('button', { name: 'Post recovery' })).not.toBeDisabled();
  });

  it('does not require the confirmation checkbox when every eligible component is selected', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('checkbox', { name: /CODE-A/ }));
    await user.click(screen.getByRole('checkbox', { name: /CODE-B/ }));
    const priceInputs = screen.getAllByRole('spinbutton');
    // Two rows, each with price + quantity inputs.
    await user.type(priceInputs[0], '85');
    await user.type(priceInputs[2], '40');

    expect(screen.queryByText(/permanently forfeited/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post recovery' })).not.toBeDisabled();
  });

  it('keeps submit disabled with nothing selected', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Post recovery' })).toBeDisabled();
  });
});

describe('PriceAndPostModal - 409 handling (the-fool finding #3)', () => {
  it('shows the distinct reload-and-retry message on a 409, and keeps the typed values', async () => {
    vi.mocked(priceAndPostDismantlingRecord).mockRejectedValue({ response: { status: 409, data: { message: 'Record status changed before posting completed - reload and retry.' } } });
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('checkbox', { name: /CODE-A/ }));
    await user.click(screen.getByRole('checkbox', { name: /CODE-B/ }));
    const priceInputs = screen.getAllByRole('spinbutton');
    await user.type(priceInputs[0], '85');
    await user.type(priceInputs[2], '40');
    await user.click(screen.getByRole('button', { name: 'Post recovery' }));

    expect(await screen.findByText(/updated by someone else since you opened it/)).toBeInTheDocument();
    // Typed values must still be there - the form was never reset.
    expect(priceInputs[0]).toHaveValue(85);
    expect(priceInputs[2]).toHaveValue(40);
  });

  it('shows the generic error message for a non-409 failure', async () => {
    vi.mocked(priceAndPostDismantlingRecord).mockRejectedValue({ response: { status: 400, data: { message: 'Component CODE-A has already been converted on this record.' } } });
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('checkbox', { name: /CODE-A/ }));
    await user.click(screen.getByRole('checkbox', { name: /CODE-B/ }));
    const priceInputs = screen.getAllByRole('spinbutton');
    await user.type(priceInputs[0], '85');
    await user.type(priceInputs[2], '40');
    await user.click(screen.getByRole('button', { name: 'Post recovery' }));

    expect(await screen.findByText('Component CODE-A has already been converted on this record.')).toBeInTheDocument();
    expect(screen.queryByText(/updated by someone else since you opened it/)).not.toBeInTheDocument();
  });
});

describe('PriceAndPostModal - no eligible components', () => {
  it('shows an empty-state message when nothing is eligible for conversion', () => {
    const record = makeDismantlingRecord({ id: 'r2', status: 'VERIFIED', harvestedComponents: [] });
    renderModal(record);
    expect(screen.getByText('No components on this record are eligible for conversion.')).toBeInTheDocument();
  });
});
