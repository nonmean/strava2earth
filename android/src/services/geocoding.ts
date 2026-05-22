let _lastGeocodeTime = 0;

export async function reverseGeocode(
  lat: number,
  lng: number,
  osmUserAgent: string,
): Promise<[string, string]> {
  const now = Date.now();
  const wait = 1100 - (now - _lastGeocodeTime);
  if (wait > 0) await new Promise<void>(r => setTimeout(r, wait));
  _lastGeocodeTime = Date.now();

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      {
        headers: {
          'User-Agent': osmUserAgent || 'strava2earth/1.0',
          'Accept-Language': 'en',
        },
      },
    );
    if (!res.ok) return ['', ''];
    const data = await res.json();
    const addr = data.address ?? {};
    const city =
      addr.city ?? addr.town ?? addr.village ?? addr.county ?? addr.municipality ?? '';
    const country = addr.country ?? '';
    return [city, country];
  } catch {
    return ['', ''];
  }
}
