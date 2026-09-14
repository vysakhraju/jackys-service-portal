import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Live-tested bug (2026-09-14): a CCE (holding zero Master Data capabilities) could open
// this whole section and browse/attempt to edit Service Centres, only finding out at the
// backend that most actions were blocked. This layout now gates the entire section up
// front on whether the caller holds ANY Master Data capability, before its child route
// (and whatever queries it fires) ever mounts - see ServiceCentresPage.test.tsx for the
// separate, finer-grained per-action gating within a tab the user IS let into.
vi.mock('../../lib/useMyCapabilities', () => ({ useMyCapabilities: vi.fn() }));

import { useMyCapabilities } from '../../lib/useMyCapabilities';
import { MasterDataLayout } from './MasterDataLayout';

function mockCapabilities(opts: { loading?: boolean; fullAccess?: boolean; capabilities?: string[] }) {
  const { loading = false, fullAccess = false, capabilities = [] } = opts;
  vi.mocked(useMyCapabilities).mockReturnValue({
    loading,
    error: null,
    fullAccess,
    capabilities,
    has: (key: string) => fullAccess || capabilities.includes(key),
    hasAny: (keys: string[]) => fullAccess || keys.some((k) => capabilities.includes(k)),
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/master-data" element={<MasterDataLayout />}>
          <Route path="service-centres" element={<div>Service Centres Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('MasterDataLayout - section access gating', () => {
  it('shows a loading placeholder and never renders the child route while the capability check is in flight', () => {
    mockCapabilities({ loading: true });
    renderAt('/master-data/service-centres');
    expect(screen.getByText('Checking access…')).toBeInTheDocument();
    expect(screen.queryByText('Service Centres Content')).not.toBeInTheDocument();
  });

  it('shows the access-denied notice and never mounts the child route for a role with zero Master Data capabilities', () => {
    mockCapabilities({ capabilities: [] });
    renderAt('/master-data/service-centres');
    expect(screen.getByText("You don't have access to Master Data yet.")).toBeInTheDocument();
    expect(screen.queryByText('Service Centres Content')).not.toBeInTheDocument();
    // The tab nav itself is safe to always show (it's just links) - only the routed content is gated.
    expect(screen.getByText('Service Centres')).toBeInTheDocument();
  });

  it('renders the child route once the caller holds at least one Master Data capability', () => {
    mockCapabilities({ capabilities: ['MASTER_DATA_SERVICE_CENTRE_CREATE'] });
    renderAt('/master-data/service-centres');
    expect(screen.getByText('Service Centres Content')).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to Master Data yet.")).not.toBeInTheDocument();
  });

  it('renders the child route for fullAccess (SUPER_ADMIN/SERVICE_HEAD) even with an empty capability list', () => {
    mockCapabilities({ capabilities: [], fullAccess: true });
    renderAt('/master-data/service-centres');
    expect(screen.getByText('Service Centres Content')).toBeInTheDocument();
  });
});
