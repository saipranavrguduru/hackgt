import { fail, requireValue } from './errors.js';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const SEARCH_RADIUS_METERS = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CATEGORY_LABELS = { dining: 'Dining', groceries: 'Grocery store', gas: 'Gas station', drugstores: 'Drugstore', other: 'Other / mixed use' };
const DINING = new Set(['restaurant', 'cafe', 'fast_food', 'food_court', 'bar', 'pub']);
const MIXED_SHOPS = new Set(['convenience', 'wholesale', 'warehouse', 'department_store', 'general', 'superstore']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validateLocationInput(input) {
  requireValue(record(input), 'INVALID_LOCATION', 'Provide a valid location.');
  requireValue(input.consent === true, 'LOCATION_CONSENT_REQUIRED', 'Allow a one-time nearby search before sharing your location.');
  requireValue(inRange(input.latitude, -90, 90) && inRange(input.longitude, -180, 180), 'INVALID_LOCATION', 'Provide valid numeric coordinates.');
  requireValue(inRange(input.accuracyMeters, 0, 1000), 'INVALID_LOCATION', 'Location accuracy must be within 1,000 meters. Try again or enter a place.');
  return { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters, consent: true };
}

// Map features suggest a category; they do not establish the issuer's merchant code.
export function classifyPlace(tags) {
  if (!record(tags)) return 'other';
  const amenity = typeof tags.amenity === 'string' ? tags.amenity.trim().toLowerCase() : '';
  const shop = typeof tags.shop === 'string' ? tags.shop.trim().toLowerCase() : '';
  if (MIXED_SHOPS.has(shop) || shop.includes(';') || amenity.includes(';')) return 'other';
  const categories = new Set();
  if (DINING.has(amenity)) categories.add('dining');
  if (shop === 'supermarket' || shop === 'grocery') categories.add('groceries');
  if (amenity === 'fuel') categories.add('gas');
  if (amenity === 'pharmacy' || shop === 'chemist') categories.add('drugstores');
  return categories.size === 1 ? [...categories][0] : 'other';
}

function distanceMeters(from, to) {
  const radians = Math.PI / 180;
  const deltaLat = (to.latitude - from.latitude) * radians;
  const deltaLon = (to.longitude - from.longitude) * radians;
  const square = Math.sin(deltaLat / 2) ** 2 + Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, square))));
}

function plainName(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(/<[^<>]*>/g, '').replace(/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120).join('');
}

function toPlace(element, origin) {
  if (!record(element) || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0 || !record(element.tags)) return null;
  const point = element.type === 'node' ? element : element.center;
  if (!record(point) || !inRange(point.lat, -90, 90) || !inRange(point.lon, -180, 180)) return null;
  const position = { latitude: point.lat, longitude: point.lon };
  const distance = distanceMeters(origin, position);
  if (distance > SEARCH_RADIUS_METERS) return null;
  const category = classifyPlace(element.tags);
  const name = plainName(element.tags.name) || plainName(element.tags['name:en']) || plainName(element.tags.brand);
  return {
    place: { id: `${element.type}/${element.id}`, name: name || CATEGORY_LABELS[category], category, categoryLabel: CATEGORY_LABELS[category], distanceMeters: Math.round(distance), sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}` },
    position, distance, nameKey: name.toLocaleLowerCase('en-US'),
  };
}

function placesFromPayload(payload, origin) {
  requireValue(record(payload) && Array.isArray(payload.elements), 'INVALID_PLACES_RESPONSE', 'Nearby places returned an invalid response.', 502);
  requireValue(!payload.remark && !payload.error, 'PLACES_UNAVAILABLE', 'Nearby places are temporarily unavailable. Try again or enter a place.', 502);
  const candidates = payload.elements.map(element => toPlace(element, origin)).filter(Boolean).sort((a, b) => a.distance - b.distance || a.place.id.localeCompare(b.place.id));
  const selected = [], seenIds = new Set();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.place.id)) continue;
    seenIds.add(candidate.place.id);
    // OSM sometimes maps a single shop both as a building and a named point.
    if (candidate.nameKey && selected.some(other => other.nameKey === candidate.nameKey && other.place.category === candidate.place.category && distanceMeters(other.position, candidate.position) <= 25)) continue;
    selected.push(candidate);
    if (selected.length === 12) break;
  }
  return selected.map(candidate => candidate.place);
}

async function readPayload(response, signal, onResponseBytes) {
  const length = response.headers?.get('content-length');
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    response.body?.cancel().catch(() => {});
    fail('PLACES_RESPONSE_TOO_LARGE', 'Nearby places returned too much data. Enter a place instead.', 502);
  }
  requireValue(response.body && typeof response.body.getReader === 'function', 'INVALID_PLACES_RESPONSE', 'Nearby places returned an invalid response.', 502);
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    if (signal.aborted) cancel();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      onResponseBytes(value.byteLength);
      if (size > MAX_RESPONSE_BYTES) {
        cancel();
        fail('PLACES_RESPONSE_TOO_LARGE', 'Nearby places returned too much data. Enter a place instead.', 502);
      }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { fail('INVALID_PLACES_RESPONSE', 'Nearby places returned an invalid response.', 502); }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function lookupNearbyPlaces(input, { fetchImpl = fetch, timeoutMs = 10000, onResponseBytes = () => {} } = {}) {
  const origin = validateLocationInput(input);
  requireValue(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, 'INVALID_LOCATION', 'Nearby search timeout is invalid.');
  const decimal = value => value.toFixed(7).replace(/\.?0+$/, '');
  const around = `around:${SEARCH_RADIUS_METERS},${decimal(origin.latitude)},${decimal(origin.longitude)}`;
  // `body center` keeps node coordinates as well as way/relation centers and tags.
  // `tags center` would omit node coordinates and silently hide point-mapped places.
  const query = `[out:json][timeout:10][maxsize:16777216];(nwr(${around})["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|fuel|pharmacy)$"];nwr(${around})["shop"~"^(supermarket|grocery|convenience|wholesale|chemist)$"];);out body center;`;
  const controller = new AbortController();
  let timedOut = false, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Nearby search timed out.')); }, timeoutMs);
  });
  try {
    const places = await Promise.race([
      (async () => {
        const response = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'PerkPilot/1.0 (local card recommendation prototype)' }, body: new URLSearchParams({ data: query }).toString(), redirect: 'error', signal: controller.signal });
        if (!response?.ok) {
          response?.body?.cancel().catch(() => {});
          if (response?.status === 406 || response?.status === 429) fail('PLACES_RATE_LIMITED', 'Nearby places need a short break. Wait 30 seconds or enter a place manually.', 503);
          fail('PLACES_UNAVAILABLE', 'Nearby places are temporarily unavailable. Try again or enter a place.', 502);
        }
        return placesFromPayload(await readPayload(response, controller.signal, onResponseBytes), origin);
      })(),
      timeout,
    ]);
    return { places, accuracyMeters: origin.accuracyMeters, searchRadiusMeters: SEARCH_RADIUS_METERS, source: { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright' }, requiresConfirmation: true };
  } catch (error) {
    if (timedOut) fail('PLACES_TIMEOUT', 'Nearby search timed out. Try again or enter a place.', 504);
    if (['PLACES_UNAVAILABLE', 'INVALID_PLACES_RESPONSE', 'PLACES_RESPONSE_TOO_LARGE', 'PLACES_RATE_LIMITED'].includes(error?.code)) throw error;
    fail('PLACES_UNAVAILABLE', 'Nearby places are temporarily unavailable. Try again or enter a place.', 502);
  } finally {
    clearTimeout(timer);
  }
}

// One service is shared by every user of this server. Quota records contain
// only timestamps and byte counts, never coordinates, queries or place names.
export function createNearbyPlacesService({ fetchImpl = fetch, now = Date.now } = {}) {
  let active = 0, cooldownUntil = 0, attempts = [];
  return async input => {
    validateLocationInput(input);
    const timestamp = now();
    requireValue(!active, 'PLACES_BUSY', 'Another nearby search is running. Try again shortly or enter a place manually.', 503);
    requireValue(timestamp >= cooldownUntil, 'PLACES_RATE_LIMITED', 'Nearby places need a short break. Wait 30 seconds or enter a place manually.', 503);
    attempts = attempts.filter(attempt => timestamp - attempt.at < 86400000);
    const receivedBytes = attempts.reduce((total, attempt) => total + attempt.bytes, 0);
    requireValue(attempts.length < 100 && receivedBytes + MAX_RESPONSE_BYTES <= 10000000, 'PLACES_DAILY_LIMIT', 'Nearby searches have reached the daily limit. Enter a place manually.', 503);
    const attempt = { at: timestamp, bytes: 0 };
    attempts.push(attempt);
    active = 1;
    try {
      return await lookupNearbyPlaces(input, { fetchImpl, onResponseBytes: count => {
        attempt.bytes += count;
        // Keep bytes in the window for a full day after they were received.
        attempt.at = Math.max(attempt.at, now());
      } });
    } catch (error) {
      if (error?.code === 'PLACES_RATE_LIMITED') cooldownUntil = now() + 30000;
      throw error;
    } finally {
      active = 0;
    }
  };
}
