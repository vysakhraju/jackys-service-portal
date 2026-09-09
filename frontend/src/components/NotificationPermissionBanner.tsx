import { useState } from 'react';
import {
  getBrowserNotificationSupport,
  getNotificationPermission,
  requestNotificationPermission,
} from '../lib/browserNotifications';

const DISMISSED_KEY = 'jsp:notification-banner-dismissed';

/**
 * Shown only to reviewer roles (gated by the caller, same REVIEW_ROLES as
 * NeedSpareNotifier) so the Need Spare pop-up can actually reach the OS level instead of
 * just the in-app toast - browsers require a user gesture (this button click) before
 * `Notification.requestPermission()` is allowed to prompt at all, so this can't be done
 * automatically on page load.
 *
 * Renders nothing when: the API isn't available/secure here (see browserNotifications.ts's
 * LAN-over-http caveat - there is nothing a banner can do about that, so we don't nag about
 * a permission that can never be granted), permission is already decided (granted or
 * denied - re-prompting a denial does nothing in every major browser, the user has to
 * change it in their own browser settings), or the user dismissed it this session.
 */
export function NotificationPermissionBanner() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermission(),
  );
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const support = getBrowserNotificationSupport();
  if (support !== 'supported' || permission !== 'default' || dismissed) {
    return null;
  }

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // best-effort only - worst case the banner reappears next reload, not a real problem
    }
  };

  return (
    <div
      role="status"
      data-testid="notification-permission-banner"
      className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <span>
        Turn on browser notifications to get an OS pop-up for new Need Spare requests, even
        when this tab isn't focused.
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={async () => {
            const result = await requestNotificationPermission();
            setPermission(result);
          }}
          className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800"
        >
          Enable notifications
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-amber-500 hover:text-amber-700"
        >
          ×
        </button>
      </div>
    </div>
  );
}
