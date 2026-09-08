import { resolveGoogleMapsLink, GoogleMapsLinkError } from './google-maps-link.util';

// fetchImpl is injected (see the function's default `fetchImpl: FetchLike = fetch` param)
// specifically so these tests never touch the real network - a fake, scripted fetch
// stands in for every scenario below, including the security-relevant ones (redirect to a
// non-Google host, too many redirects) that would be painful/flaky to exercise for real.
function fakeFetch(responses: Array<{ status: number; location?: string } | Error>) {
  let call = 0;
  return jest.fn(async () => {
    const next = responses[call];
    call++;
    if (next instanceof Error) throw next;
    const headers = new Map<string, string>();
    if (next.location) headers.set('location', next.location);
    return {
      status: next.status,
      headers: { get: (key: string) => headers.get(key.toLowerCase()) ?? null },
    } as unknown as Response;
  });
}

describe('resolveGoogleMapsLink', () => {
  it('rejects a URL that is not a Google Maps host without making any request', async () => {
    const fetchImpl = fakeFetch([]);
    await expect(resolveGoogleMapsLink('https://evil.example.com/steal', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-https URL (e.g. http, or a non-URL scheme) without making any request', async () => {
    const fetchImpl = fakeFetch([]);
    await expect(resolveGoogleMapsLink('http://maps.app.goo.gl/AbCdEf', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a value that does not parse as a URL at all', async () => {
    const fetchImpl = fakeFetch([]);
    await expect(resolveGoogleMapsLink('not a url', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('extracts coordinates directly from an already-expanded URL with zero network calls', async () => {
    const fetchImpl = fakeFetch([]);
    const result = await resolveGoogleMapsLink(
      'https://www.google.com/maps/place/Some+Place/@25.2048493,55.2707828,17z/data=xyz',
      fetchImpl,
    );
    expect(result).toEqual({ lat: 25.2048493, lng: 55.2707828 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prefers the precise !3d/!4d pin over the @lat,lng map-center when both are present', async () => {
    const fetchImpl = fakeFetch([]);
    const result = await resolveGoogleMapsLink(
      'https://www.google.com/maps/place/X/@25.0,55.0,17z/data=!4m6!3m5!1s0x0:0x0!8m2!3d25.9999999!4d55.9999999',
      fetchImpl,
    );
    expect(result).toEqual({ lat: 25.9999999, lng: 55.9999999 });
  });

  it('extracts coordinates from a q= query-string form', async () => {
    const fetchImpl = fakeFetch([]);
    const result = await resolveGoogleMapsLink('https://www.google.com/maps?q=25.2048493,55.2707828', fetchImpl);
    expect(result).toEqual({ lat: 25.2048493, lng: 55.2707828 });
  });

  it('follows a single redirect hop from a short link to the coordinate-bearing destination', async () => {
    const fetchImpl = fakeFetch([
      { status: 302, location: 'https://www.google.com/maps/place/X/@25.2048493,55.2707828,17z' },
    ]);
    const result = await resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl);
    expect(result).toEqual({ lat: 25.2048493, lng: 55.2707828 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a chain of several redirects before landing on coordinates', async () => {
    const fetchImpl = fakeFetch([
      { status: 301, location: 'https://goo.gl/maps/intermediate1' },
      { status: 302, location: 'https://www.google.com/maps/place/X/@25.2048493,55.2707828,17z' },
    ]);
    const result = await resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl);
    expect(result).toEqual({ lat: 25.2048493, lng: 55.2707828 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('SECURITY: refuses to follow a redirect that points outside the Google Maps host allowlist', async () => {
    const fetchImpl = fakeFetch([{ status: 302, location: 'https://evil.example.com/@25.2,55.2,17z' }]);
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
    // Only the one hop that revealed the bad redirect target should have been attempted -
    // it must not have gone on to actually fetch the malicious host.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('SECURITY: refuses to follow a redirect that downgrades to plain http even on an allowed host', async () => {
    const fetchImpl = fakeFetch([{ status: 302, location: 'http://www.google.com/maps/@25.2,55.2,17z' }]);
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
  });

  it('gives up with a clear error once the redirect hop cap is exceeded', async () => {
    const responses = Array.from({ length: 10 }, () => ({
      status: 302,
      location: 'https://goo.gl/maps/intermediate',
    }));
    const fetchImpl = fakeFetch(responses);
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
  });

  it('throws a clear error when the final page has no extractable coordinates', async () => {
    const fetchImpl = fakeFetch([{ status: 200 }]);
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl)).rejects.toThrow(
      /could not find coordinates/i,
    );
  });

  it('throws a clear error when a redirect response has no Location header', async () => {
    const fetchImpl = fakeFetch([{ status: 302 }]);
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
  });

  it('wraps a network-level failure in a GoogleMapsLinkError rather than leaking a raw fetch error', async () => {
    const fetchImpl = fakeFetch([new Error('getaddrinfo ENOTFOUND')]);
    await expect(resolveGoogleMapsLink('https://maps.app.goo.gl/AbCdEf', fetchImpl)).rejects.toThrow(GoogleMapsLinkError);
  });

  it('rejects out-of-range coordinates rather than returning garbage', async () => {
    // 200 lat is not a valid latitude - must not be accepted as a real match even though
    // the regex shape matches. Since the (invalid) match doesn't short-circuit the
    // function, it goes on to actually request this URL - give it one 200 response with
    // nothing else extractable so it fails cleanly instead of throwing on a missing mock.
    const fetchImpl = fakeFetch([{ status: 200 }]);
    await expect(
      resolveGoogleMapsLink('https://www.google.com/maps?q=200.0,55.2707828', fetchImpl),
    ).rejects.toThrow(GoogleMapsLinkError);
  });
});
