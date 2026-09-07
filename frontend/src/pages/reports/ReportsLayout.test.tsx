import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReportsLayout } from './ReportsLayout';

// Unlike FinanceLayout, this layout deliberately does NOT gate or filter tabs by role -
// every destination page runs its own canView check (see FinanceReportsPage.test.tsx /
// QualityReportsPage.test.tsx / OperationalReportsPage.test.tsx / ReportsPage.test.tsx for
// the actual role-gate coverage). This test only confirms the tab strip itself renders and
// routes correctly, for any viewer.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports" element={<ReportsLayout />}>
          <Route index element={<div>Live Board Content</div>} />
          <Route path="finance" element={<div>Finance Content</div>} />
          <Route path="quality" element={<div>Quality Content</div>} />
          <Route path="operational" element={<div>Operational Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReportsLayout', () => {
  it('renders all four tabs regardless of role', () => {
    renderAt('/reports');
    expect(screen.getByRole('link', { name: 'Live Board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quality' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Operational' })).toBeInTheDocument();
  });

  it('renders the index route (Live Board) at /reports', () => {
    renderAt('/reports');
    expect(screen.getByText('Live Board Content')).toBeInTheDocument();
  });

  it('renders the Finance tab content at /reports/finance', () => {
    renderAt('/reports/finance');
    expect(screen.getByText('Finance Content')).toBeInTheDocument();
  });

  it('renders the Quality tab content at /reports/quality', () => {
    renderAt('/reports/quality');
    expect(screen.getByText('Quality Content')).toBeInTheDocument();
  });

  it('renders the Operational tab content at /reports/operational', () => {
    renderAt('/reports/operational');
    expect(screen.getByText('Operational Content')).toBeInTheDocument();
  });
});
