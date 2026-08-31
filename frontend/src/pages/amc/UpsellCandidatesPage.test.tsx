import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeUpsellCandidate } from '../../test/fixtures';

vi.mock('../../lib/amcApi', () => ({ getAmcUpsellCandidates: vi.fn() }));

import { getAmcUpsellCandidates } from '../../lib/amcApi';
import { UpsellCandidatesPage } from './UpsellCandidatesPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UpsellCandidatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getAmcUpsellCandidates).mockReset();
});

describe('UpsellCandidatesPage', () => {
  it('links each candidate into a pre-filled Create Contract form, not a dead end', async () => {
    vi.mocked(getAmcUpsellCandidates).mockResolvedValue([
      makeUpsellCandidate({ jobCardId: 'jc-1', customerName: 'Jane Doe', customerPhone: '+971509998888' }),
    ]);
    renderPage();

    const link = await screen.findByRole('link', { name: /Create AMC Contract/ });
    expect(link).toHaveAttribute('href', '/amc/contracts?prefillName=Jane%20Doe&prefillPhone=%2B971509998888');
  });

  it('shows an empty message when there are no candidates', async () => {
    vi.mocked(getAmcUpsellCandidates).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No upsell candidates right now.')).toBeInTheDocument();
  });
});
