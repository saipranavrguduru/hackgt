import { fail, requireValue } from './errors.js';

const toCents = value => {
  if (!value || value.currency !== 'USD' || !/^\d+(?:\.\d{1,2})?$/.test(String(value.value))) return null;
  const [whole, fraction = ''] = String(value.value).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
};
export function normalizeEbayItem(item, observedAt) {
  const priceCents = toCents(item.price);
  if (!item.itemId || priceCents === null || !item.itemWebUrl) return null;
  let url;
  try { const parsed = new URL(item.itemWebUrl); if (parsed.protocol !== 'https:' || !/(^|\.)ebay\.com$/.test(parsed.hostname)) return null; url = parsed.toString(); }
  catch { return null; }
  const shipping = item.shippingOptions?.[0]?.shippingCost;
  return { id: `ebay:${item.itemId}`, name: String(item.title || 'eBay listing').slice(0, 180),
    merchantName: String(item.seller?.username || 'eBay seller').slice(0, 120),
    priceCents, shippingCents: shipping ? toCents(shipping) : null, taxCents: null,
    currency: 'USD', condition: item.condition || null, imageUrl: item.image?.imageUrl || null,
    url, availability: 'listed', observedAt, provenance: 'ebay', source: 'eBay Browse API',
    priceNote: 'Live listing price. Shipping may depend on location; tax and final total are confirmed on eBay.' };
}
export function createEbayClient({ clientId = process.env.EBAY_CLIENT_ID, clientSecret = process.env.EBAY_CLIENT_SECRET, fetchImpl = fetch } = {}) {
  const configured = Boolean(clientId && clientSecret);
  let cached = null;
  async function accessToken() {
    requireValue(configured, 'PROVIDER_NOT_CONFIGURED', 'eBay catalog credentials are not configured.', 503);
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.value;
    let response;
    try { response = await fetchImpl('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }), signal: AbortSignal.timeout(10000)
    }); } catch { fail('CATALOG_UNAVAILABLE', 'eBay authentication is temporarily unavailable.', 502); }
    let data; try { data = await response.json(); } catch { fail('CATALOG_UNAVAILABLE', 'eBay authentication returned an invalid response.', 502); }
    if (!response.ok || !data.access_token) fail('CATALOG_UNAVAILABLE', 'eBay catalog authentication failed.', 502);
    cached = { value: data.access_token, expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 };
    return cached.value;
  }
  async function search(text) {
    requireValue(typeof text === 'string' && text.trim().length >= 2 && text.length <= 120, 'INVALID_SEARCH', 'Enter 2–120 characters.');
    const token = await accessToken();
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.searchParams.set('q', text.trim()); url.searchParams.set('limit', '12');
    url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE}');
    let response;
    try { response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }, signal: AbortSignal.timeout(10000) }); }
    catch { fail('CATALOG_UNAVAILABLE', 'eBay search is temporarily unavailable.', 502); }
    let data; try { data = await response.json(); } catch { fail('CATALOG_UNAVAILABLE', 'eBay returned an invalid response.', 502); }
    if (!response.ok || !Array.isArray(data.itemSummaries || [])) fail('CATALOG_UNAVAILABLE', 'eBay search failed.', 502);
    const observedAt = new Date().toISOString();
    return { products: (data.itemSummaries || []).map(item => normalizeEbayItem(item, observedAt)).filter(Boolean), observedAt, source: 'eBay Browse API' };
  }
  return { configured, search };
}
