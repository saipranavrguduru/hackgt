import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupNearbyPlaces, validateLocationInput, classifyPlace, createNearbyPlacesService } from '../src/places.js';

const location = { latitude: 0, longitude: 0, accuracyMeters: 25, consent: true };
const response = (elements = [], extra = {}) => Response.json({ version: 0.6, generator: 'Overpass API', elements, ...extra });
const node = (id, name, tags, lat = 0.001, lon = 0) => ({ type: 'node', id, lat, lon, tags: { name, ...tags } });

test('location requires explicit consent and strict finite numeric coordinates before any request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(); };
  for (const consent of [undefined, false, 'true', 1]) {
    await assert.rejects(lookupNearbyPlaces({ ...location, consent }, { fetchImpl }), { code: 'LOCATION_CONSENT_REQUIRED', status: 400 });
  }
  for (const input of [null, [], {}, { ...location, latitude: '0' }, { ...location, latitude: NaN }, { ...location, latitude: 90.001 }, { ...location, latitude: -90.001 }, { ...location, longitude: Infinity }, { ...location, longitude: 180.001 }, { ...location, longitude: -180.001 }, { ...location, accuracyMeters: -1 }, { ...location, accuracyMeters: 1001 }, { ...location, accuracyMeters: '25' }, { ...location, accuracyMeters: undefined }]) {
    await assert.rejects(lookupNearbyPlaces(input, { fetchImpl }), error => error.status === 400);
  }
  assert.equal(calls, 0);
  assert.deepEqual(validateLocationInput({ latitude: -90, longitude: 180, accuracyMeters: 1000, consent: true, ignored: 'field' }), { latitude: -90, longitude: 180, accuracyMeters: 1000, consent: true });
  assert.deepEqual(validateLocationInput({ latitude: 90, longitude: -180, accuracyMeters: 0, consent: true }), { latitude: 90, longitude: -180, accuracyMeters: 0, consent: true });
});

test('place classification preserves uncertainty for mixed use, convenience stores and warehouses', () => {
  for (const [tags, want] of [
    [{ amenity: 'restaurant' }, 'dining'], [{ amenity: 'cafe' }, 'dining'], [{ amenity: 'fast_food' }, 'dining'],
    [{ shop: 'supermarket' }, 'groceries'], [{ amenity: 'fuel' }, 'gas'],
    [{ amenity: 'pharmacy' }, 'drugstores'], [{ shop: 'chemist' }, 'drugstores'],
    [{ amenity: 'fuel', shop: 'supermarket' }, 'other'], [{ amenity: 'fuel', shop: 'convenience' }, 'other'],
    [{ shop: 'convenience' }, 'other'], [{ shop: 'wholesale' }, 'other'], [{ shop: 'warehouse' }, 'other'],
    [{ amenity: 'restaurant', shop: 'supermarket' }, 'other'], [{ shop: 'supermarket;convenience' }, 'other'],
    [{ shop: 'bakery' }, 'other'], [{ amenity: ['restaurant'] }, 'other'], [null, 'other'],
  ]) assert.equal(classifyPlace(tags), want, JSON.stringify(tags));
});

test('nearby lookup uses one bounded fixed-host POST and returns only real mapped places without coordinates', async () => {
  let request;
  const result = await lookupNearbyPlaces(location, { fetchImpl: async (url, options) => {
    request = { url, ...options };
    return response([
      node(3, 'Far Restaurant', { amenity: 'restaurant' }, 0.003),
      { type: 'way', id: 2, center: { lat: 0.002, lon: 0 }, tags: { name: 'Mapped Market', shop: 'supermarket' } },
      node(1, 'Actual Cafe', { amenity: 'cafe' }),
      node(4, 'Outside Radius', { amenity: 'fuel' }, 0.006),
    ]);
  } });
  assert.equal(request.url, 'https://overpass-api.de/api/interpreter');
  assert.equal(request.method, 'POST');
  assert.match(request.headers['user-agent'] || '', /^PerkPilot\//, 'Public map requests must identify this application');
  assert.equal(request.redirect, 'error');
  assert.ok(request.signal instanceof AbortSignal);
  const query = new URLSearchParams(request.body).get('data');
  assert.match(query, /around:500,0,0/);
  assert.match(query, /nwr/);
  assert.match(query, /out[^;]*center[^;]*;/);
  assert.match(query, /\[timeout:\d+\]/);
  assert.match(query, /\[maxsize:\d+\]/);
  assert.deepEqual(result.places.map(place => place.name), ['Actual Cafe', 'Mapped Market', 'Far Restaurant']);
  assert.deepEqual(result.places.map(place => place.distanceMeters), [111, 222, 334]);
  assert.equal(result.places[1].sourceUrl, 'https://www.openstreetmap.org/way/2');
  assert.equal(result.places[0].category, 'dining');
  assert.equal(result.accuracyMeters, 25);
  assert.equal(result.searchRadiusMeters, 500);
  assert.equal(result.requiresConfirmation, true);
  assert.deepEqual(result.source, { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright' });
  assert.doesNotMatch(JSON.stringify(result), /latitude|longitude|"lat"|"lon"|"center"/);
});

test('distance uses longitude and latitude and excludes invalid provider identities or geometry', async () => {
  const result = await lookupNearbyPlaces({ ...location, latitude: 60, longitude: 10 }, { fetchImpl: async () => response([
    node(1, 'East', { amenity: 'cafe' }, 60, 10.001),
    node(2, 'North', { amenity: 'cafe' }, 60.001, 10),
    node('../bad', 'Bad ID', { amenity: 'cafe' }, 60, 10),
    node(Number.MAX_SAFE_INTEGER + 1, 'Unsafe ID', { amenity: 'cafe' }, 60, 10),
    { ...node(5, 'Invalid Type', { amenity: 'cafe' }, 60, 10), type: 'javascript' },
    node(6, 'Invalid Lat', { amenity: 'cafe' }, '60', 10),
    node(7, 'Outside Earth', { amenity: 'cafe' }, 91, 10),
    { type: 'way', id: 8, tags: { amenity: 'cafe' } },
  ]) });
  assert.deepEqual(result.places.map(place => [place.name, place.distanceMeters]), [['East', 56], ['North', 111]]);
});

test('place results deduplicate nearby named node and way copies and cap nearest results at twelve', async () => {
  const elements = [
    node(1, 'Shared Cafe', { amenity: 'cafe' }, 0.0001),
    node(1, 'Shared Cafe', { amenity: 'cafe' }, 0.0001),
    { type: 'way', id: 2, center: { lat: 0.00015, lon: 0 }, tags: { name: 'Shared Cafe', amenity: 'cafe' } },
    ...Array.from({ length: 14 }, (_, i) => node(10 + i, `Cafe ${i}`, { amenity: 'cafe' }, 0.0002 + i * 0.0002)),
  ];
  const result = await lookupNearbyPlaces(location, { fetchImpl: async () => response(elements.reverse()) });
  assert.equal(result.places.length, 12);
  assert.equal(result.places.filter(place => place.name === 'Shared Cafe').length, 1);
  assert.equal(result.places[0].name, 'Shared Cafe');
  assert.equal(result.places.at(-1).name, 'Cafe 10');
  assert.equal(new Set(result.places.map(place => place.id)).size, 12);
});

test('provider names are bounded plain text and unnamed places receive category labels without invented merchants', async () => {
  const result = await lookupNearbyPlaces(location, { fetchImpl: async () => response([
    node(1, '  <img src=x>Mapped\u0000\u202e Cafe  ', { amenity: 'cafe' }),
    node(2, 'x'.repeat(500), { shop: 'supermarket' }, 0.002),
    node(3, undefined, { amenity: 'fuel' }, 0.003),
    { type: 'relation', id: 4, center: { lat: 0.004, lon: 0 }, tags: { amenity: 'pharmacy', 'name:en': 'Mapped Pharmacy' } },
  ]) });
  assert.equal(result.places[0].name, 'Mapped Cafe');
  assert.ok(result.places[1].name.length <= 120);
  assert.equal(result.places[2].name, result.places[2].categoryLabel);
  assert.equal(result.places[3].name, 'Mapped Pharmacy');
  assert.equal(result.places[3].sourceUrl, 'https://www.openstreetmap.org/relation/4');
});

test('empty provider results stay empty with no demo or invented place fallback', async () => {
  const result = await lookupNearbyPlaces(location, { fetchImpl: async () => response() });
  assert.deepEqual(result.places, []);
});

test('valid near-zero coordinates are sent as bounded decimal numbers rather than exponent notation', async () => {
  let query;
  await lookupNearbyPlaces({ ...location, latitude: 0.0000001, longitude: -0.0000001 }, { fetchImpl: async (_url, options) => {
    query = new URLSearchParams(options.body).get('data');
    return response();
  } });
  assert.match(query, /around:500,0\.0000001,-0\.0000001/);
});

test('provider failures and malformed payloads become safe errors without leaking coordinates', async () => {
  for (const fetchImpl of [
    async () => new Response('unavailable', { status: 503 }),
    async () => { throw new Error('Request failed at latitude=0 longitude=0'); },
    async () => new Response('<html>broken</html>'),
    async () => Response.json(null),
    async () => Response.json({ unexpected: [] }),
    async () => Response.json({ elements: {} }),
    async () => response([], { remark: 'runtime error: Query timed out' }),
  ]) await assert.rejects(lookupNearbyPlaces(location, { fetchImpl }), error => {
    assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /latitude|longitude|runtime error/);
    return true;
  });
});

test('provider content length and streamed body are each bounded to one megabyte', async () => {
  await assert.rejects(lookupNearbyPlaces(location, { fetchImpl: async () => new Response('{}', { headers: { 'content-length': '1048577' } }) }), { code: 'PLACES_RESPONSE_TOO_LARGE', status: 502 });
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(600000)); controller.enqueue(new Uint8Array(500000)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(lookupNearbyPlaces(location, { fetchImpl: async () => new Response(body) }), { code: 'PLACES_RESPONSE_TOO_LARGE', status: 502 });
  assert.equal(cancelled, true);
});

test('timeout aborts an unresponsive fetch even when the provider ignores the signal', async () => {
  let signal;
  await assert.rejects(lookupNearbyPlaces(location, { timeoutMs: 10, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } }), { code: 'PLACES_TIMEOUT', status: 504 });
  assert.equal(signal.aborted, true);
});

test('timeout also bounds response streaming and cancels its reader', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"elements":[')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(lookupNearbyPlaces(location, { timeoutMs: 10, fetchImpl: async () => new Response(body) }), { code: 'PLACES_TIMEOUT', status: 504 });
  assert.equal(cancelled, true);
});

test('provider 406 and 429 are safe rate-limit errors and start a shared thirty-second cooldown', async () => {
  for (const status of [406, 429]) {
    let clock = 1000, calls = 0;
    const nearby = createNearbyPlacesService({ now: () => clock, fetchImpl: async () => {
      calls++;
      return calls === 1 ? new Response('private provider details', { status }) : response();
    } });
    await assert.rejects(nearby(location), error => {
      assert.equal(error.code, 'PLACES_RATE_LIMITED');
      assert.equal(error.status, 503);
      assert.match(error.message, /enter a place/i);
      assert.doesNotMatch(error.message, /private provider/);
      return true;
    });
    clock += 29999;
    await assert.rejects(nearby({ ...location, longitude: 1 }), { code: 'PLACES_RATE_LIMITED', status: 503 });
    assert.equal(calls, 1);
    clock++;
    assert.deepEqual((await nearby(location)).places, []);
    assert.equal(calls, 2);
  }
});

test('nearby service permits only one active query and recovers after completion or failure', async () => {
  let complete, calls = 0;
  const nearby = createNearbyPlacesService({ fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { complete = resolve; });
    if (calls === 2) throw new Error('provider unavailable');
    return response();
  } });
  const pending = nearby(location);
  await assert.rejects(nearby(location), error => error.code === 'PLACES_BUSY' && error.status === 503 && /enter a place/i.test(error.message));
  assert.equal(calls, 1);
  complete(response());
  await pending;
  await assert.rejects(nearby(location), { code: 'PLACES_UNAVAILABLE' });
  assert.deepEqual((await nearby(location)).places, []);
  assert.equal(calls, 3);
});

test('nearby service counts failed attempts, rejects the 101st request, and resets after twenty-four hours', async () => {
  let clock = 1000, calls = 0;
  const nearby = createNearbyPlacesService({ now: () => clock, fetchImpl: async () => { calls++; throw new Error('offline'); } });
  await assert.rejects(nearby({ ...location, consent: false }), { code: 'LOCATION_CONSENT_REQUIRED' });
  for (let i = 0; i < 100; i++) await assert.rejects(nearby(location), { code: 'PLACES_UNAVAILABLE' });
  await assert.rejects(nearby(location), error => error.code === 'PLACES_DAILY_LIMIT' && error.status === 503 && /enter a place/i.test(error.message));
  assert.equal(calls, 100);
  clock += 86400000 - 1;
  await assert.rejects(nearby(location), { code: 'PLACES_DAILY_LIMIT' });
  clock++;
  await assert.rejects(nearby(location), { code: 'PLACES_UNAVAILABLE' });
  assert.equal(calls, 101);
});

test('nearby service tracks actual streamed bytes and reserves a full response before the ten-megabyte daily limit', async () => {
  let clock = 1000, calls = 0;
  const prefix = '{"elements":[],"padding":"', suffix = '"}';
  const bytes = new TextEncoder().encode(prefix + 'x'.repeat(600000 - prefix.length - suffix.length) + suffix);
  const nearby = createNearbyPlacesService({ now: () => clock, fetchImpl: async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 120000) controller.enqueue(bytes.slice(offset, offset + 120000));
      controller.close();
    } }), { headers: { 'content-length': '1' } });
  } });
  for (let i = 0; i < 15; i++) assert.deepEqual((await nearby(location)).places, []);
  await assert.rejects(nearby(location), { code: 'PLACES_DAILY_LIMIT', status: 503 });
  assert.equal(calls, 15, 'Nine megabytes used leaves less than a full allowed response');
  clock += 86400000;
  assert.deepEqual((await nearby(location)).places, []);
  assert.equal(calls, 16);
});

test('response-byte accounting includes unreadable JSON and the chunk that exceeds the body limit', async () => {
  let received = 0;
  await assert.rejects(lookupNearbyPlaces(location, {
    fetchImpl: async () => new Response('not json'), onResponseBytes: count => { received += count; },
  }), { code: 'INVALID_PLACES_RESPONSE' });
  assert.equal(received, 8);
  received = 0;
  await assert.rejects(lookupNearbyPlaces(location, {
    fetchImpl: async () => new Response(new Uint8Array(1100000)), onResponseBytes: count => { received += count; },
  }), { code: 'PLACES_RESPONSE_TOO_LARGE' });
  assert.equal(received, 1100000);
});
