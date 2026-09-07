// Holistic test-master pass (2026-09-07): getCurrentLocationOrBlock() was only ever
// exercised indirectly through appointment-detail.test.tsx, and only for two of its
// four outcomes (permission denied / denied permanently). The GPS-fix success path,
// the 15s timeout race, and the generic "location services off" catch-all had no
// coverage anywhere - real gaps, since Start Visit is hard-blocked on this function's
// result with no manual-entry fallback (see this file's own top-of-file comment).
import * as Location from 'expo-location';
import { getCurrentLocationOrBlock } from './location';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));

const mockedRequestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockedGetCurrentPosition = Location.getCurrentPositionAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('getCurrentLocationOrBlock', () => {
  it('returns the GPS fix when permission is granted and a position resolves', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    mockedGetCurrentPosition.mockResolvedValue({ coords: { latitude: 25.2048, longitude: 55.2708, altitude: null } });

    const result = await getCurrentLocationOrBlock();

    expect(result).toEqual({ ok: true, coords: { latitude: 25.2048, longitude: 55.2708 } });
    expect(mockedGetCurrentPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
  });

  it('returns a retryable permission-denied result when permission is denied but can be asked again', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: false, canAskAgain: true, status: 'denied' });

    const result = await getCurrentLocationOrBlock();

    expect(result).toEqual({
      ok: false,
      reason: 'permission-denied',
      message: 'Location permission is needed to start a visit.',
    });
    expect(mockedGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('returns a permanently-denied result (Settings escape hatch) when the OS will not ask again', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });

    const result = await getCurrentLocationOrBlock();

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe('permission-denied-permanently');
    expect(mockedGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('returns an "unavailable" result when getCurrentPositionAsync rejects for a reason other than timeout', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    mockedGetCurrentPosition.mockRejectedValue(new Error('Location services are disabled'));

    const result = await getCurrentLocationOrBlock();

    expect(result).toEqual({
      ok: false,
      reason: 'unavailable',
      message: 'Could not get your location. Check that location services are turned on and try again.',
    });
  });

  it('returns a "timeout" result when no GPS fix arrives within 15 seconds', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    // A position promise that never resolves - only the internal 15s timeout can
    // settle this call, proving withTimeout() actually races the two.
    mockedGetCurrentPosition.mockReturnValue(new Promise(() => {}));
    jest.useFakeTimers();

    const pending = getCurrentLocationOrBlock();
    await jest.advanceTimersByTimeAsync(15000);
    const result = await pending;

    expect(result).toEqual({
      ok: false,
      reason: 'timeout',
      message: 'Could not get a GPS fix. Move to an area with a clearer view of the sky and try again.',
    });
  });

  it('does not misreport a genuinely slow-but-successful fix (just under the timeout) as a timeout', async () => {
    mockedRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    jest.useFakeTimers();
    mockedGetCurrentPosition.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ coords: { latitude: 1, longitude: 2 } }), 14000);
        }),
    );

    const pending = getCurrentLocationOrBlock();
    await jest.advanceTimersByTimeAsync(14000);
    const result = await pending;

    expect(result).toEqual({ ok: true, coords: { latitude: 1, longitude: 2 } });
  });
});
