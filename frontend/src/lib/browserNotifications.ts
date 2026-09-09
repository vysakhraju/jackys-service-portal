// OS/browser-level push notifications, added 2026-09-09 after live-testing revealed the
// original 2026-09-07 Need Spare fix only ever built the in-app toast (lib/toast.tsx) -
// visible while the tab is open and focused-or-not, but nothing at the OS level. The user
// tested it and confirmed (via clarifying question) they were expecting an actual
// browser/OS pop-up, so this adds the real Notifications API on top of, not instead of,
// the toast - the toast still works everywhere (including insecure LAN origins where this
// API is unavailable, see below), this is additive.
//
// IMPORTANT CAVEAT, worth knowing before assuming this "fixes" every environment: the
// Notifications API only works in a "secure context" - https, or http://localhost /
// http://127.0.0.1. A colleague testing over the same Wi-Fi via
// http://<your-LAN-IP>:5173 (see README's "Letting a Colleague Test Over the Same Wi-Fi"
// section) is NOT a secure context, so `window.Notification` is undefined there and this
// module silently no-ops for them - they still get the in-app toast, just not the OS
// pop-up. There is no workaround short of serving the dev server over HTTPS or a real
// deployment domain.

export type BrowserNotificationSupport = 'unsupported' | 'insecure-context' | 'supported';

export function getBrowserNotificationSupport(): BrowserNotificationSupport {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return 'unsupported';
  }
  // isSecureContext is the standard, browser-computed answer to "would a permission
  // request even be allowed here" - covers https, localhost, and 127.0.0.1 correctly
  // without us having to hand-parse location.hostname/protocol ourselves.
  if (!window.isSecureContext) {
    return 'insecure-context';
  }
  return 'supported';
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  const support = getBrowserNotificationSupport();
  if (support !== 'supported') return 'unsupported';
  return window.Notification.permission;
}

/** Must be called from a user-gesture handler (a click) - Chrome silently ignores/ throws
 * on a permission request made outside one. Resolves to the resulting permission, or
 * 'unsupported' if the API isn't available/secure here at all. */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (getBrowserNotificationSupport() !== 'supported') return 'unsupported';
  try {
    return await window.Notification.requestPermission();
  } catch {
    // Some older browsers only support the callback form; retry that way rather than
    // failing the whole enable-notifications flow over an API-shape difference.
    return new Promise((resolve) => {
      window.Notification.requestPermission((result) => resolve(result));
    });
  }
}

export interface ShowNotificationInput {
  title: string;
  body?: string;
  /** Called if the user clicks the OS notification itself. */
  onClick?: () => void;
  /** Notifications sharing a tag replace each other instead of piling up - used so a
   * reviewer who ignores five pop-ups in a row doesn't get an OS notification-center full
   * of stale ones once they finally look. */
  tag?: string;
}

/** Best-effort - never throws. No-ops quietly when unsupported, insecure, or not yet
 * granted, since the toast (lib/toast.tsx) already covers those cases visibly in-app. */
export function showBrowserNotification({ title, body, onClick, tag }: ShowNotificationInput): void {
  if (getNotificationPermission() !== 'granted') return;
  try {
    const notification = new window.Notification(title, { body, tag });
    if (onClick) {
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    }
  } catch {
    // Construction can still throw in a handful of browser/OS combinations (e.g. some
    // mobile Chrome builds require a Service Worker-backed notification instead of the
    // page-level constructor) - swallow it, the toast already carried the message.
  }
}
