import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, ErrorNotice, type Column } from './DataTable';

type Row = { id: string; name: string };
const ROWS: Row[] = [{ id: 'r1', name: 'Alpha' }];
const COLUMNS: Column<Row>[] = [{ key: 'name', label: 'Name', render: (r) => r.name }];

// Modification Request (2026-09-15, Delivery & Invoicing screen): maxHeightClassName/dense
// are purely-additive opt-in props (the ~40 existing DataTable callers pass neither) - these
// pin that the defaults are unchanged and that each opt-in prop actually reaches the DOM.
describe('DataTable', () => {
  it('defaults to text-sm cells and no scroll wrapper when maxHeightClassName/dense are omitted', () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} isLoading={false} error={null} />);
    expect(container.querySelector('table')).toHaveClass('text-sm');
    expect(container.querySelector('td')).toHaveClass('px-4', 'py-2');
    expect(container.querySelector('thead')).not.toHaveClass('sticky');
  });

  it('dense switches cells to text-xs with tighter padding', () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={ROWS} isLoading={false} error={null} dense />);
    expect(container.querySelector('table')).toHaveClass('text-xs');
    expect(container.querySelector('td')).toHaveClass('px-3', 'py-1.5');
  });

  it('maxHeightClassName wraps the table and makes the header sticky, for an internally-scrolling list', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} rows={ROWS} isLoading={false} error={null} maxHeightClassName="max-h-[28rem] overflow-y-auto" />,
    );
    expect(container.querySelector('.overflow-x-auto')).toHaveClass('max-h-[28rem]', 'overflow-y-auto');
    expect(container.querySelector('thead')).toHaveClass('sticky', 'top-0');
  });
});

// Live-tested finding (2026-09-14): a designation-matrix 403 ("Access denied. Missing
// capability: X.") used to render as bare backend text, which read as "this feature
// doesn't exist" rather than "an admin can grant it via Designation access". These tests
// pin the friendlier hint ErrorNotice now appends for that specific 403 shape, while
// making sure every other error (network failure, plain string, a totally different 403,
// no error at all) is completely unaffected.
describe('ErrorNotice', () => {
  it('renders nothing when there is no error', () => {
    const { container } = render(<ErrorNotice error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a plain Error message with no access hint', () => {
    render(<ErrorNotice error={new Error('Network Error')} />);
    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.queryByText(/Designation access/)).not.toBeInTheDocument();
  });

  it('shows the real message plus a Designation-access hint for a "Missing capability" 403', () => {
    render(
      <ErrorNotice
        error={{
          response: {
            status: 403,
            data: { message: 'Access denied. Missing capability: TECHNICIAN_SCHEDULE_GANTT.' },
          },
        }}
      />,
    );
    expect(screen.getByText('Access denied. Missing capability: TECHNICIAN_SCHEDULE_GANTT.')).toBeInTheDocument();
    expect(screen.getByText(/Designation access/)).toBeInTheDocument();
  });

  it('shows the real message plus a Designation-access hint for a "Required roles" 403', () => {
    render(
      <ErrorNotice
        error={{
          response: {
            status: 403,
            data: { message: 'Access denied. Required roles: SUPER_ADMIN. Your role: CCE' },
          },
        }}
      />,
    );
    expect(screen.getByText(/Access denied\. Required roles: SUPER_ADMIN/)).toBeInTheDocument();
    expect(screen.getByText(/Designation access/)).toBeInTheDocument();
  });

  it('does not add the hint for a non-403 error, even one that mentions a role', () => {
    render(
      <ErrorNotice
        error={{
          response: {
            status: 409,
            data: { message: 'Access denied. Required roles: SUPER_ADMIN. Your role: CCE' },
          },
        }}
      />,
    );
    expect(screen.queryByText(/Designation access/)).not.toBeInTheDocument();
  });

  it('does not add the hint for an unrelated 403 message', () => {
    render(
      <ErrorNotice
        error={{
          response: {
            status: 403,
            data: { message: 'Cannot deactivate your own account' },
          },
        }}
      />,
    );
    expect(screen.getByText('Cannot deactivate your own account')).toBeInTheDocument();
    expect(screen.queryByText(/Designation access/)).not.toBeInTheDocument();
  });

  it('joins an array of validation messages without the hint', () => {
    render(
      <ErrorNotice
        error={{ response: { status: 400, data: { message: ['name is required', 'email is invalid'] } } }}
      />,
    );
    expect(screen.getByText('name is required, email is invalid')).toBeInTheDocument();
  });
});
