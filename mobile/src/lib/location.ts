// GPS capture for Start Visit (Phase 2). By deliberate decision (unlike the web app's
// FieldVisitsPage.tsx, which falls back to manual lat/lng entry when the browser denies
// geolocation), this app BLOCKS Start Visit until a real GPS fix is obtained - matching
// the backend's StartVisitDto, which requires gpsLat/gpsLng as mandatory numbers with no
// null/best-effort path. See docs/planning/MOBILE_APP_SCOPE_v1.md §8 for the decision.
import * as Location from 'expo-location';

export type LocationResult =
  | { ok: true; coords: { latitude: number; longitude: number } }
  | { ok: false; reason: 'permission-denied' | 'permission-denied-permanently' | 'unavailable' | 'timeout'; message: string };

const FIX_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    // Node's timer keeps the process (and, in tests, the Jest worker) alive until it
    // fires or is cleared - unref it so a fast-resolving promise (the common case) never
    // leaves a dangling handle. No-op in the RN runtime, where setTimeout returns a
    // plain number rather than a Timeout object.
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Requests foreground location permission (if not already granted) and returns a single
 * current GPS fix. Never returns a null/partial location - callers should keep Start
 * Visit blocked and let the technician retry when this resolves to `ok: false`.
 */
export async function getCurrentLocationOrBlock(): Promise<LocationResult> {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    return permission.canAskAgain
      ? {
          ok: false,
          reason: 'permission-denied',
          message: 'Location permission is needed to start a visit.',
        }
      : {
          ok: false,
          reason: 'permission-denied-permanently',
          message: 'Location access is turned off for this app. Enable it in your phone’s Settings to start a visit.',
        };
  }

  try {
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      FIX_TIMEOUT_MS,
    );
    return {
      ok: true,
      coords: { latitude: position.coords.latitude, longitude: position.coords.longitude },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'timeout') {
      return {
        ok: false,
        reason: 'timeout',
        message: 'Could not get a GPS fix. Move to an area with a clearer view of the sky and try again.',
      };
    }
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Could not get your location. Check that location services are turned on and try again.',
    };
  }
}
