import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserNotificationSupport,
  getNotificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
} from './browserNotifications';

// jsdom (this project's test environment) does not implement window.Notification at all,
// so every test here installs/removes its own stand-in rather than relying on a real
// browser API - that's also exactly the "unsupported" case a real Safari-without-permission
// or embedded-webview environment would hit, so the default (no stub installed) case is
// tested first and is not an artificial gap.

const originalNotification = (window as any).Notification;
const originalIsSecureContext = window.isSecureContext;

function installNotificationStub(permission: NotificationPermission = 'default') {
  class NotificationStub {
    static permission: NotificationPermission = permission;
    static requestPermission = vi.fn(async () => NotificationStub.permission);
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(
      public title: string,
      public options?: NotificationOptions,
    ) {}
  }
  (window as any).Notification = NotificationStub;
  return NotificationStub;
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

afterEach(() => {
  (window as any).Notification = originalNotification;
  Object.defineProperty(window, 'isSecureContext', { value: originalIsSecureContext, configurable: true });
  vi.restoreAllMocks();
});

describe('getBrowserNotificationSupport', () => {
  it('reports unsupported when window.Notification does not exist', () => {
    delete (window as any).Notification;
    expect(getBrowserNotificationSupport()).toBe('unsupported');
  });

  it('reports insecure-context when the API exists but the origin is not secure (e.g. LAN http)', () => {
    installNotificationStub();
    setSecureContext(false);
    expect(getBrowserNotificationSupport()).toBe('insecure-context');
  });

  it('reports supported on a secure context with the API present', () => {
    installNotificationStub();
    setSecureContext(true);
    expect(getBrowserNotificationSupport()).toBe('supported');
  });
});

describe('getNotificationPermission', () => {
  it('returns unsupported rather than throwing when the API is unavailable', () => {
    delete (window as any).Notification;
    expect(getNotificationPermission()).toBe('unsupported');
  });

  it('passes through the real permission value when supported', () => {
    installNotificationStub('denied');
    setSecureContext(true);
    expect(getNotificationPermission()).toBe('denied');
  });
});

describe('requestNotificationPermission', () => {
  it('resolves unsupported without calling requestPermission when unavailable', async () => {
    delete (window as any).Notification;
    await expect(requestNotificationPermission()).resolves.toBe('unsupported');
  });

  it('resolves unsupported on an insecure context without prompting', async () => {
    const stub = installNotificationStub();
    setSecureContext(false);
    await requestNotificationPermission();
    expect(stub.requestPermission).not.toHaveBeenCalled();
  });

  it('resolves the granted/denied result from the real API when supported', async () => {
    const stub = installNotificationStub('granted');
    setSecureContext(true);
    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(stub.requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe('showBrowserNotification', () => {
  it('does nothing when permission was never granted', () => {
    const stub = installNotificationStub('default');
    setSecureContext(true);
    const ctorSpy = vi.fn();
    (window as any).Notification = class extends stub {
      constructor(...args: any[]) {
        super(args[0], args[1]);
        ctorSpy(...args);
      }
    };
    (window as any).Notification.permission = 'default';
    showBrowserNotification({ title: 'New Need Spare request', body: 'x' });
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('does nothing on an insecure context even if permission was somehow granted', () => {
    installNotificationStub('granted');
    setSecureContext(false);
    // getNotificationPermission short-circuits to 'unsupported' for insecure contexts, so
    // this must not throw or construct a notification either.
    expect(() => showBrowserNotification({ title: 'x' })).not.toThrow();
  });

  it('constructs a notification with title/body/tag when permission is granted', () => {
    const Stub = installNotificationStub('granted');
    setSecureContext(true);
    const ctorSpy = vi.spyOn(window as any, 'Notification');
    showBrowserNotification({ title: 'New Need Spare request', body: '2 × Drum Belt', tag: 'need-spare-1' });
    expect(ctorSpy).toHaveBeenCalledWith('New Need Spare request', { body: '2 × Drum Belt', tag: 'need-spare-1' });
    void Stub;
  });

  it('wires onClick to focus the window, run the callback, and close the notification', () => {
    installNotificationStub('granted');
    setSecureContext(true);
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const onClick = vi.fn();
    const ctorSpy = vi.spyOn(window as any, 'Notification');

    showBrowserNotification({ title: 'x', onClick });
    const created: any = ctorSpy.mock.instances[0];
    created.onclick();

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(created.close).toHaveBeenCalledTimes(1);
  });

  it('swallows a construction error instead of throwing (some mobile browsers reject the page-level constructor)', () => {
    setSecureContext(true);
    (window as any).Notification = class {
      static permission: NotificationPermission = 'granted';
      constructor() {
        throw new Error('Illegal constructor');
      }
    };
    expect(() => showBrowserNotification({ title: 'x' })).not.toThrow();
  });
});
