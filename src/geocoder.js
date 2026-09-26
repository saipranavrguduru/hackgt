import { fail, requireValue } from './errors.js';

const inRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '';

export function createShoppingLocationResolver({
  fetchImpl = fetch,
  endpoint = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/reverse',
  now = Date.now
} = {}) {
  const cache = new Map();
  let active = false, lastRequestAt = 0;
  async function locate(input) {
    requireValue(input && typeof input === 'object' && input.consent === true, 'LOCATION_CONSENT_REQUIRED', 'Allow a one-time location lookup first.');
    requireValue(inRange(input.latitude, -90, 90) && inRange(input.longitude, -180, 180), 'INVALID_LOCATION', 'Your browser returned invalid coordinates.');
    requireValue(inRange(input.accuracyMeters, 0, 50000), 'INVALID_LOCATION', 'Your location is too imprecise. Enter a city manually.');
    const key = `${input.latitude.toFixed(2)},${input.longitude.toFixed(2)}`;
    const cached = cache.get(key);
    if (cached && now() - cached.savedAt < 86400000) return cached.result;
    requireValue(!active && now() - lastRequestAt >= 1000, 'LOCATION_RATE_LIMITED', 'Wait a moment before locating again.', 429);
    const url = new URL(endpoint);
    for (const [name, value] of Object.entries({ format:'jsonv2', lat:String(input.latitude), lon:String(input.longitude), zoom:'10', addressdetails:'1' })) url.searchParams.set(name, value);
    active = true; lastRequestAt = now();
    try {
      let response;
      try { response = await fetchImpl(url, { headers: { Accept:'application/json', 'User-Agent':'PerkPilot/1.0 (user-initiated shopping location)' }, signal:AbortSignal.timeout(10000) }); }
      catch { fail('LOCATION_UNAVAILABLE', 'Location lookup is temporarily unavailable. Enter a city manually.', 502); }
      const length = Number(response.headers?.get?.('content-length') || 0);
      requireValue(!length || length <= 65536, 'LOCATION_UNAVAILABLE', 'Location lookup returned too much data.', 502);
      let data; try { data = await response.json(); } catch { fail('LOCATION_UNAVAILABLE', 'Location lookup returned an invalid response.', 502); }
      requireValue(response.ok && data && typeof data.address === 'object', 'LOCATION_UNAVAILABLE', 'Location lookup could not identify a city. Enter it manually.', 502);
      const address = data.address;
      const city = text(address.city || address.town || address.village || address.municipality || address.county);
      const state = text(address.state || address.region);
      const country = text(address.country);
      requireValue(city && country, 'LOCATION_UNAVAILABLE', 'Location lookup could not identify a city. Enter it manually.', 502);
      const location = [...new Set([city, state, country].filter(Boolean))].join(', ').slice(0, 120);
      const result = { location, source:'OpenStreetMap Nominatim', attributionUrl:'https://www.openstreetmap.org/copyright' };
      cache.set(key, { savedAt:now(), result });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return result;
    } finally { active = false; }
  }
  return { locate };
}
