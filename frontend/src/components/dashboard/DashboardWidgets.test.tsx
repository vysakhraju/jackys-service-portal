import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  JobsByStatusChart,
  WorkshopQueueChart,
  SlaBreachCard,
  SpareConsumptionChart,
  AmcStatusCard,
  DeliveryInvoicingCard,
  FinanceSummaryCard,
} from './DashboardWidgets';

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom doesn't implement - a
// no-op stub is enough for it to render its children (chart geometry itself isn't what
// these tests care about, see this file's own assertions below).
beforeAll(() => {
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('JobsByStatusChart', () => {
  it('shows the total active jobs count and calls onOpenReports when the card action is clicked', () => {
    const onOpenReports = vi.fn();
    render(
      <JobsByStatusChart
        data={{ columns: [{ key: 'WIP', label: 'WIP', count: 5 }], totalActiveJobs: 5 }}
        onOpenReports={onOpenReports}
      />,
    );

    expect(screen.getByText('5 active jobs on the board')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Job Status Board →' }));
    expect(onOpenReports).toHaveBeenCalled();
  });
});

describe('WorkshopQueueChart', () => {
  it('shows totals and an empty state when there are no technicians', () => {
    const onOpen = vi.fn();
    render(<WorkshopQueueChart data={{ technicians: [], totalActive: 0, unassignedCount: 2 }} onOpen={onOpen} />);

    expect(screen.getByText('0 active jobs in workshop · 2 unassigned')).toBeInTheDocument();
    expect(screen.getByText('No active workshop technicians.')).toBeInTheDocument();
  });

  it('shows the capacity-status legend when there are technicians', () => {
    render(
      <WorkshopQueueChart
        data={{
          technicians: [{ id: 't-1', name: 'Alice', activeCount: 8, capacity: 6, overCapacity: true }],
          totalActive: 8,
          unassignedCount: 0,
        }}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('Normal')).toBeInTheDocument();
    expect(screen.getByText('Near capacity')).toBeInTheDocument();
    expect(screen.getByText('Over capacity')).toBeInTheDocument();
  });
});

describe('SlaBreachCard', () => {
  it('shows the breached count and navigates to the job journey when a row is clicked', () => {
    const onOpen = vi.fn();
    const onOpenJob = vi.fn();
    render(
      <SlaBreachCard
        data={{
          asOf: '2026-09-15T00:00:00Z',
          thresholdHours: 48,
          breachedCount: 2,
          topItems: [{ jobCardId: 'jc-1', jobCardNumber: 'JC-0001', hoursOverThreshold: 5 }],
        }}
        onOpen={onOpen}
        onOpenJob={onOpenJob}
      />,
    );

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('breached')).toBeInTheDocument();
    fireEvent.click(screen.getByText('JC-0001'));
    expect(onOpenJob).toHaveBeenCalledWith('jc-1');
  });

  it('shows a no-breaches message when topItems is empty', () => {
    render(
      <SlaBreachCard
        data={{ asOf: '2026-09-15T00:00:00Z', thresholdHours: 48, breachedCount: 0, topItems: [] }}
        onOpen={vi.fn()}
        onOpenJob={vi.fn()}
      />,
    );
    expect(screen.getByText('No breaches at this threshold.')).toBeInTheDocument();
  });
});

describe('SpareConsumptionChart', () => {
  it('shows an empty state with no consumption data', () => {
    render(<SpareConsumptionChart data={{ topByQuantity: [], topByValue: [] }} onOpen={vi.fn()} />);
    expect(screen.getByText('No consumption recorded.')).toBeInTheDocument();
  });

  it('calls onOpen when the card action is clicked, with consumption data present', () => {
    const onOpen = vi.fn();
    render(
      <SpareConsumptionChart
        data={{
          topByQuantity: [{ sparePartId: 'sp-1', code: 'C1', name: 'Compressor', totalQuantity: 9 }],
          topByValue: [],
        }}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Operational Reports →' }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('AmcStatusCard', () => {
  it('shows the three counts and calls onOpen when the card action is clicked', () => {
    const onOpen = vi.fn();
    render(
      <AmcStatusCard
        data={{ activeCount: 42, expiringSoonCount: 3, expiringSoonWithinDays: 30, upsellCandidatesCount: 5 }}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Expiring within 30d')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open AMC Contracts →' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('has no expiring-soon warning styling when the count is zero', () => {
    render(
      <AmcStatusCard
        data={{ activeCount: 10, expiringSoonCount: 0, expiringSoonWithinDays: 30, upsellCandidatesCount: 0 }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('Expiring within 30d').previousSibling).toHaveClass('text-slate-900');
  });
});

describe('DeliveryInvoicingCard', () => {
  it('shows both stats and routes each to its own destination', () => {
    const onOpenDelivery = vi.fn();
    const onOpenInvoicing = vi.fn();
    render(
      <DeliveryInvoicingCard
        data={{ readyForDeliveryCount: 7, b2bOutstandingAmount: 1234.5 }}
        onOpenDelivery={onOpenDelivery}
        onOpenInvoicing={onOpenInvoicing}
      />,
    );

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('AED 1234.50')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Ready for Delivery →' }));
    expect(onOpenDelivery).toHaveBeenCalled();

    fireEvent.click(screen.getByText('AED 1234.50'));
    expect(onOpenInvoicing).toHaveBeenCalled();
    expect(onOpenDelivery).toHaveBeenCalledTimes(1);
  });
});

describe('FinanceSummaryCard', () => {
  it('shows revenue and contract counts and calls onOpen when the card action is clicked', () => {
    const onOpen = vi.fn();
    render(
      <FinanceSummaryCard
        data={{ totalServiceRevenue: 5000, totalAmcRevenue: 800, activeAmcContracts: 12 }}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText('AED 5000.00')).toBeInTheDocument();
    expect(screen.getByText('AED 800.00')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Finance Reports →' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
