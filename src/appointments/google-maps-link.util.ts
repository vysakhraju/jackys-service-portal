// Resolves a Google Maps short link (maps.app.goo.gl/..., goo.gl/maps/..., or an ordinary
// google.com/maps URL) into { lat, lng } server-side, per the user's own idea from the
// REDTRA360 review call (10:29-11:08): a customer shares a short link from the Google Maps
// app, and the CCE pastes it in rather than typing coordinates by hand.
//
// SECURITY - this function makes an outbound HTTP request to a URL supplied by the client,
// which is a textbook SSRF vector if left unrestricted (an attacker could point it at an
// internal service, a cloud metadata endpoint, etc., or use it as an open port-scanner via
// the timing/error differences). Two things keep this closed down to "talks to Google Maps
// and nothing else, ever":
//   1. Every URL this function actually contacts - the input, and every redirect hop after
//      it - is checked against a hostname allowlist AND required to be https before it's
//      fetched. A redirect to any non-Google host aborts immediately rather than following
//      it.
//   2. There's a hard cap on redirect hops and a per-request timeout, so this can't be used
//      to hang a request thread or chain redirects indefinitely.
// It does NOT download or parse the destination page's HTML - coordinates are read out of
// the URL itself (either the input URL, or wherever each redirect's Location header points),
// which is where Google actually puts them (.../@25.2048,55.2708,17z/... or
// ...!3d25.2048!4d55.2708... or ?q=25.2048,55.2708) - so this stays a handful of HEAD-ish
// requests rather than a page fetch+scrape.
const ALLOWED_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com', 'maps.google.com']);

const MAX_REDIRECTS = 6;
const FETCH_TIMEOUT_MS = 6000;
const USER_AGENT = 'Mozilla/5.0 (compatible; JackysServicePortal/1.0; +service-desk)';

export class GoogleMapsLinkError extends Error {}

export interface LatLng {
  lat: number;
  lng: number;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.has(hostname.toLowerCase());
}

function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Tries the precise-pin form first (!3d<lat>!4d<lng>, present on a "place" URL once
// Google's resolved the short link to an actual pin) since that's more accurate than the
// map-viewport center a plain @lat,lng carries; falls back to @lat,lng, then to a handful of
// query-param spellings Maps uses for a bare coordinate (q=, query=, daddr=, destination=).
function extractCoordinates(url: string): LatLng | null {
  const pinMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (pinMatch) {
    return { lat: parseFloat(pinMatch[1]), lng: parseFloat(pinMatch[2]) };
  }
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }
  const queryMatch = url.match(/[?&](?:q|query|daddr|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (queryMatch) {
    return { lat: parseFloat(queryMatch[1]), lng: parseFloat(queryMatch[2]) };
  }
  return null;
}

function parseAndValidateUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new GoogleMapsLinkError('That does not look like a valid URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new GoogleMapsLinkError('Only https Google Maps links are supported.');
  }
  if (!isAllowedHost(parsed.hostname)) {
    throw new GoogleMapsLinkError('That does not look like a Google Maps link (maps.app.goo.gl or google.com/maps).');
  }
  return parsed;
}

export async function resolveGoogleMapsLink(inputUrl: string, fetchImpl: FetchLike = fetch): Promise<LatLng> {
  let current = parseAndValidateUrl(inputUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Check before every network call, including the first - a full (already-expanded)
    // google.com/maps URL needs zero requests, and this also catches the destination as
    // soon as a redirect lands on it without waiting for one hop too many.
    const found = extractCoordinates(current.toString());
    if (found && isValidLatLng(found.lat, found.lng)) {
      return found;
    }

    if (hop === MAX_REDIRECTS) break;

    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new GoogleMapsLinkError(
        `Could not reach Google Maps to resolve that link (${(err as Error).message || 'network error'}).`,
      );
    }

    if (res.status < 300 || res.status >= 400) {
      // No further redirect and no coordinates found on the last URL we had - nothing more
      // to try.
      break;
    }

    const location = res.headers.get('location');
    if (!location) {
      throw new GoogleMapsLinkError('Google Maps redirected without a destination - could not resolve this link.');
    }
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || !isAllowedHost(next.hostname)) {
      throw new GoogleMapsLinkError('That link redirected outside Google Maps - refusing to follow it.');
    }
    current = next;
  }

  throw new GoogleMapsLinkError(
    'Could not find coordinates in that Google Maps link. Try opening it in a browser and pasting the full address-bar URL once the map loads, or enter latitude/longitude manually.',
  );
}
