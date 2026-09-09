import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationPermissionBanner } from './NotificationPermissionBanner';

const originalNotification = (window as any).Notification;
const originalIsSecureContext = window.isSecureContext;

function installNotificationStub(permission: NotificationPermission = 'default') {
  class NotificationStub {
    static permission: NotificationPermission = permission;
    static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  }
  (window as any).Notification = NotificationStub;
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  return NotificationStub;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  (window as any).Notification = originalNotification;
  Object.defineProperty(window, 'isSecureContext', { value: originalIsSecureContext, configurable: true });
});

describe('NotificationPermissionBanner', () => {
  it('renders nothing when the Notifications API is unavailable', () => {
    delete (window as any).Notification;
    const { container } = render(<NotificationPermissionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on an insecure context (e.g. LAN http testing)', () => {
    installNotificationStub();
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const { container } = render(<NotificationPermissionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when permission was already granted', () => {
    installNotificationStub('granted');
    const { container } = render(<NotificationPermissionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when permission was already denied (re-prompting cannot work)', () => {
    installNotificationStub('denied');
    const { container } = render(<NotificationPermissionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the enable prompt when permission is still undecided', () => {
    installNotificationStub('default');
    render(<NotificationPermissionBanner />);
    expect(screen.getByTestId('notification-permission-banner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
  });

  it('requests permission on click and hides itself once granted', async () => {
    const stub = installNotificationStub('default');
    render(<NotificationPermissionBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));

    expect(stub.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('notification-permission-banner')).not.toBeInTheDocument());
  });

  it('dismisses on the × button and stays dismissed across remounts this session', () => {
    installNotificationStub('default');
    const { unmount } = render(<NotificationPermissionBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('notification-permission-banner')).not.toBeInTheDocument();

    unmount();
    render(<NotificationPermissionBanner />);
    expect(screen.queryByTestId('notification-permission-banner')).not.toBeInTheDocument();
  });
});
