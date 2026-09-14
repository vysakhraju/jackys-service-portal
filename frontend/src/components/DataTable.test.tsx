import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorNotice } from './DataTable';

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
