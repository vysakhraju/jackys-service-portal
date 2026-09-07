import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { makeNeedSpareRequest } from '../test/fixtures';

const navigateMock = vi.fn();
const pushMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/useNeedSpareSocket', () => ({ useNeedSpareSocket: vi.fn() }));
vi.mock('../lib/toast', () => ({ useToast: () => ({ push: pushMock }) }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../pages/inventory/NeedSpareReviewPage', () => ({
  PENDING_NEED_SPARE_QUERY_KEY: ['reservations', 'pending-need-spare'],
}));

import { useAuth } from '../lib/auth';
import { useNeedSpareSocket } from '../lib/useNeedSpareSocket';
import { NeedSpareNotifier } from './NeedSpareNotifier';

function mockUser(roleName: string | null) {
  vi.mocked(useAuth).mockReturnValue({
    user: roleName
      ? {
          id: 'user-1',
          firstName: 'Test',
          lastName: 'User',
          email: 't@example.com',
          employeeId: 'E1',
          status: 'ACTIVE',
          lastLoginAt: null,
          role: { id: 'r1', name: roleName, displayName: roleName },
        }
      : null,
    isLoading: false,
    isAuthenticated: !!roleName,
    login: vi.fn(),
    logout: vi.fn(),
  } as any);
}

beforeEach(() => {
  navigateMock.mockReset();
  pushMock.mockReset();
  invalidateQueriesMock.mockReset();
  vi.mocked(useNeedSpareSocket).mockReset();
});

describe('NeedSpareNotifier - enablement', () => {
  it('renders nothing (returns null)', () => {
    mockUser('SUPER_ADMIN');
    vi.mocked(useNeedSpareSocket).mockReturnValue({ pending: [] });
    const { container } = render(<NeedSpareNotifier />);
    expect(container).toBeEmptyDOMElement();
  });

  it('enables the socket for a reviewer role (Technical Team Leader)', () => {
    mockUser('TECHNICAL_TEAM_LEADER');
    vi.mocked(useNeedSpareSocket).mockReturnValue({ pending: [] });
    render(<NeedSpareNotifier />);
    expect(useNeedSpareSocket).toHaveBeenCalledWith(true, expect.any(Function));
  });

  it('does not enable the socket for a non-reviewer role', () => {
    mockUser('TECHNICIAN_FIELD');
    vi.mocked(useNeedSpareSocket).mockReturnValue({ pending: [] });
    render(<NeedSpareNotifier />);
    expect(useNeedSpareSocket).toHaveBeenCalledWith(false, expect.any(Function));
  });

  it('does not enable the socket when there is no logged-in user', () => {
    mockUser(null);
    vi.mocked(useNeedSpareSocket).mockReturnValue({ pending: [] });
    render(<NeedSpareNotifier />);
    expect(useNeedSpareSocket).toHaveBeenCalledWith(false, expect.any(Function));
  });
});

describe('NeedSpareNotifier - handling a newly-arrived request', () => {
  function renderAndCaptureCallback() {
    mockUser('SERVICE_HEAD');
    let onNewRequest: ((request: ReturnType<typeof makeNeedSpareRequest>) => void) | undefined;
    vi.mocked(useNeedSpareSocket).mockImplementation((_enabled, cb) => {
      onNewRequest = cb as any;
      return { pending: [] };
    });
    render(<NeedSpareNotifier />);
    return () => onNewRequest!;
  }

  it('pushes a toast naming the part, quantity, and job card', () => {
    const getCallback = renderAndCaptureCallback();
    getCallback()(makeNeedSpareRequest());

    expect(pushMock).toHaveBeenCalledTimes(1);
    const toast = pushMock.mock.calls[0][0];
    expect(toast.title).toBe('New Need Spare request');
    expect(toast.description).toBe('2 × Drum Belt (SP-001) for job card JC-0001');
  });

  it('falls back to generic part/job-card labels when sparePart/jobCard relations were not loaded', () => {
    const getCallback = renderAndCaptureCallback();
    getCallback()(makeNeedSpareRequest({ sparePart: undefined, jobCard: undefined }));

    const toast = pushMock.mock.calls[0][0];
    expect(toast.description).toBe('2 × a spare part for job card jc-1');
  });

  it('invalidates the pending-need-spare query so an open review page refreshes', () => {
    const getCallback = renderAndCaptureCallback();
    getCallback()(makeNeedSpareRequest());

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['reservations', 'pending-need-spare'],
    });
  });

  it("the toast's action button navigates to the review screen", () => {
    const getCallback = renderAndCaptureCallback();
    getCallback()(makeNeedSpareRequest());

    const toast = pushMock.mock.calls[0][0];
    toast.action.onClick();
    expect(navigateMock).toHaveBeenCalledWith('/workshop-inventory/need-spare');
  });
});
