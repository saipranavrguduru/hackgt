import { createHash } from 'node:crypto';
import { fail, requireValue } from './errors.js';

const safeUrl = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
};

const listingId = item => item.product_id || createHash('sha256')
  .update(`${item.title || ''}|${item.source || ''}|${item.link || item.product_link || ''}`)
  .digest('hex').slice(0, 20);

function normalize(item, observedAt) {
  const amount = item.extracted_price;
  const url = safeUrl(item.link || item.product_link);
  const isUsd = typeof item.price === 'string' && /^\s*\$/.test(item.price);
  if (!item.title || !url || !isUsd || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount >= 1e9) return null;
  return {
    id: `serpapi:${listingId(item)}`,
    providerProductId: item.product_id || null,
    name: String(item.title).trim().slice(0, 240),
    merchantName: String(item.source || 'Google Shopping merchant').trim().slice(0, 120),
    priceCents: Math.round(amount * 100),
    currency: 'USD',
    shippingCents: null,
    taxCents: null,
    availability: 'unknown',
    url,
    imageUrl: safeUrl(item.thumbnail),
    rating: typeof item.rating === 'number' && Number.isFinite(item.rating) ? item.rating : null,
    reviewCount: Number.isSafeInteger(item.reviews) && item.reviews >= 0 ? item.reviews : null,
    deliveryText: typeof item.delivery === 'string' ? item.delivery.slice(0, 160) : null,
    observedAt,
    source: 'SerpApi Google Shopping',
    provenance: 'live-provider',
    priceNote: 'Observed Google Shopping merchandise price; shipping, tax, availability, and final merchant total are unverified.'
  };
}

export function createSerpApiClient({
  apiKey = process.env.SERPAPI_API_KEY,
  location = process.env.SERPAPI_LOCATION || 'United States',
  country = process.env.SERPAPI_GL || 'us',
  language = process.env.SERPAPI_HL || 'en',
  fetchImpl = fetch,
  now = () => new Date(),
  cacheTtlMs = 5 * 60 * 1000
} = {}) {
  const configured = Boolean(apiKey);
  const cache = new Map();
  async function search(input, { location: requestedLocation = location } = {}) {
    requireValue(configured, 'PROVIDER_NOT_CONFIGURED', 'SerpApi catalog credentials are not configured.', 503);
    requireValue(typeof input === 'string' && input.trim().length >= 2 && input.length <= 120, 'INVALID_SEARCH', 'Search for 2–120 characters.');
    requireValue(typeof requestedLocation === 'string' && requestedLocation.trim().length >= 2 && requestedLocation.length <= 120, 'INVALID_LOCATION', 'Choose a shopping city or region.');
    const query = input.trim(), searchLocation = requestedLocation.trim(), cacheKey = `${query.toLowerCase()}|${searchLocation.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached && now().getTime() - cached.savedAt < cacheTtlMs) return cached.result;
    const params = new URLSearchParams({ engine: 'google_shopping', q: query, api_key: apiKey, gl: country, hl: language, location:searchLocation, num: '20' });
    let response;
    try { response = await fetchImpl(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(20000) }); }
    catch { fail('CATALOG_UNAVAILABLE', 'Google Shopping search is temporarily unavailable.', 502); }
    let data; try { data = await response.json(); } catch { fail('CATALOG_UNAVAILABLE', 'Google Shopping returned an invalid response.', 502); }
    if (response.status === 429) fail('CATALOG_RATE_LIMITED', 'Google Shopping search quota is temporarily unavailable.', 503);
    if (!response.ok || data.error) fail('CATALOG_UNAVAILABLE', 'Google Shopping could not complete the search.', 502);
    const categorized = Array.isArray(data.categorized_shopping_results)
      ? data.categorized_shopping_results.flatMap(group => Array.isArray(group.shopping_results) ? group.shopping_results : []) : [];
    const candidates = [...(Array.isArray(data.shopping_results) ? data.shopping_results : []), ...categorized];
    const observedAt = now().toISOString(), seen = new Set(), products = [];
    for (const item of candidates) {
      const product = normalize(item, observedAt);
      if (!product || seen.has(product.id)) continue;
      seen.add(product.id); products.push(product);
      if (products.length === 20) break;
    }
    const result = { query, location:searchLocation, observedAt, source: 'SerpApi Google Shopping', products,
      coverage: 'Google Shopping results for the configured location; stores outside Google Shopping may be absent.' };
    cache.set(cacheKey, { savedAt: now().getTime(), result });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return result;
  }
  return { configured, source: 'SerpApi Google Shopping', search };
}
