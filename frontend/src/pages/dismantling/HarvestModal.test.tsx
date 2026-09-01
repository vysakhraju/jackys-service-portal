import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeComponentYieldMatrix, makeDismantlingRecord } from '../../test/fixtures';

vi.mock('../../lib/masterDataApi', () => ({ listYieldByModel: vi.fn() }));
vi.mock('../../lib/dismantlingApi', () => ({ harvestDismantlingComponents: vi.fn() }));

import { listYieldByModel } from '../../lib/masterDataApi';
import { harvestDismantlingComponents } from '../../lib/dismantlingApi';
import { HarvestModal } from './HarvestModal';

function renderModal(record = makeDismantlingRecord({ id: 'r1', modelId: 'M100' })) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HarvestModal open onClose={vi.fn()} record={record} onHarvested={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listYieldByModel).mockReset();
  vi.mocked(harvestDismantlingComponents).mockReset();
});

describe('HarvestModal - BOM code yield-matrix warning (the-fool finding #1)', () => {
  it('shows a "not in yield matrix" warning under a code that does not match the fetched matrix for this model', async () => {
    vi.mocked(listYieldByModel).mockResolvedValue([makeComponentYieldMatrix({ originalBomItemCode: 'COMP-COMPRESSOR-01' })]);
    const user = userEvent.setup();
    renderModal();

    // "M100" renders inside its own <b> tag, so it isn't part of the same text node as
    // the rest of the sentence - wait on a substring that doesn't cross that boundary.
    await screen.findByText(/known yield matrix/);
    const codeInput = screen.getByPlaceholderText('COMP-COMPRESSOR-01');
    await user.type(codeInput, 'COMP-COMRPESSOR-01'); // typo'd

    expect(await screen.findByText(/isn't in M100's known yield matrix/)).toBeInTheDocument();
  });

  it('shows no warning for a code that matches a known yield-matrix row', async () => {
    vi.mocked(listYieldByModel).mockResolvedValue([makeComponentYieldMatrix({ originalBomItemCode: 'COMP-COMPRESSOR-01' })]);
    const user = userEvent.setup();
    renderModal();

    // "M100" renders inside its own <b> tag, so it isn't part of the same text node as
    // the rest of the sentence - wait on a substring that doesn't cross that boundary.
    await screen.findByText(/known yield matrix/);
    const codeInput = screen.getByPlaceholderText('COMP-COMPRESSOR-01');
    await user.type(codeInput, 'COMP-COMPRESSOR-01');

    expect(screen.queryByText(/isn't in M100's known yield matrix/)).not.toBeInTheDocument();
  });

  it('shows no warning while the yield matrix is empty for this model (nothing to compare against yet)', async () => {
    vi.mocked(listYieldByModel).mockResolvedValue([]);
    const user = userEvent.setup();
    renderModal();

    const codeInput = screen.getByPlaceholderText('COMP-COMPRESSOR-01');
    await user.type(codeInput, 'ANYTHING-AT-ALL');

    expect(screen.queryByText(/isn't in M100's known yield matrix/)).not.toBeInTheDocument();
  });

  it('submits the harvest with the entered component lines', async () => {
    vi.mocked(listYieldByModel).mockResolvedValue([makeComponentYieldMatrix({ originalBomItemCode: 'COMP-COMPRESSOR-01' })]);
    vi.mocked(harvestDismantlingComponents).mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('COMP-COMPRESSOR-01'), 'COMP-COMPRESSOR-01');
    await user.clear(screen.getAllByRole('spinbutton')[0]);
    await user.type(screen.getAllByRole('spinbutton')[0], '2');
    await user.click(screen.getByRole('button', { name: 'Log harvest' }));

    expect(harvestDismantlingComponents).toHaveBeenCalledWith('r1', {
      components: [{ originalBomItemCode: 'COMP-COMPRESSOR-01', testedCondition: 'GOOD_WORKING', quantity: 2 }],
    });
  });
});
