import { fail, requireValue } from './errors.js';

const query = `query PerkPilotProducts($query: String!, $first: Int!) {
  products(first: $first, query: $query) {
    nodes { id title handle onlineStoreUrl description vendor productType updatedAt
      variants(first: 1) { nodes { id availableForSale price { amount currencyCode } compareAtPrice { amount currencyCode } } }
    }
  }
}`;
const usdCents = money => {
  if (!money || money.currencyCode !== 'USD' || !/^\d+(?:\.\d{1,2})?$/.test(String(money.amount))) return null;
  const [whole, fractional = ''] = String(money.amount).split('.');
  const result = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? result : null;
};
export function normalizeShopifyProduct(node, storeDomain, observedAt) {
  const variant = node.variants?.nodes?.[0];
  if (!variant) return null;
  const priceCents = usdCents(variant.price);
  if (priceCents === null) return null;
  const referencePriceCents = usdCents(variant.compareAtPrice);
  const fallbackUrl = `https://${storeDomain}/products/${encodeURIComponent(node.handle || '')}`;
  let productUrl;
  try { const parsed = new URL(node.onlineStoreUrl || fallbackUrl); productUrl = parsed.protocol === 'https:' && parsed.hostname === storeDomain ? parsed.toString() : fallbackUrl; }
  catch { productUrl = fallbackUrl; }
  return { id: `shopify:${node.id}`, variantId: variant.id, name: String(node.title || '').slice(0, 180),
    merchantName: String(node.vendor || storeDomain).slice(0, 120), category: String(node.productType || 'other').slice(0, 80),
    description: String(node.description || '').slice(0, 500), priceCents, referencePriceCents: referencePriceCents > priceCents ? referencePriceCents : null,
    currency: 'USD', availability: variant.availableForSale ? 'in_stock' : 'unavailable',
    taxCents: null, shippingCents: null, url: productUrl, observedAt, source: 'Shopify Storefront API', provenance: 'shopify',
    priceNote: 'Merchant product price. Final tax, shipping, discounts, and availability are confirmed at merchant checkout.' };
}

export function createShopifyClient({ storeDomain = process.env.SHOPIFY_STORE_DOMAIN, token = process.env.SHOPIFY_STOREFRONT_TOKEN, apiVersion = process.env.SHOPIFY_API_VERSION || '2026-07', fetchImpl = fetch } = {}) {
  const configured = Boolean(storeDomain && token);
  if (storeDomain) requireValue(/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/i.test(storeDomain), 'INVALID_SHOPIFY_STORE', 'Use a myshopify.com store domain.');
  requireValue(/^20\d\d-(01|04|07|10)$/.test(apiVersion), 'INVALID_SHOPIFY_VERSION', 'Use a supported Shopify API version.');
  async function search(searchText) {
    requireValue(configured, 'PROVIDER_NOT_CONFIGURED', 'Shopify catalog is not configured.', 503);
    requireValue(typeof searchText === 'string' && searchText.trim().length >= 2 && searchText.length <= 120, 'INVALID_SEARCH', 'Enter 2–120 characters.');
    const safeTerms = searchText.trim().replace(/["'\\():*]/g, ' ').replace(/\s+/g, ' ');
    let response;
    try {
      response = await fetchImpl(`https://${storeDomain}/api/${apiVersion}/graphql.json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
        body: JSON.stringify({ query, variables: { query: safeTerms, first: 12 } }), signal: AbortSignal.timeout(10000)
      });
    } catch { fail('CATALOG_UNAVAILABLE', 'Merchant catalog is temporarily unavailable.', 502); }
    let data;
    try { data = await response.json(); } catch { fail('CATALOG_UNAVAILABLE', 'Merchant catalog returned an invalid response.', 502); }
    if (!response.ok || data.errors) fail('CATALOG_UNAVAILABLE', 'Merchant catalog could not complete the search.', 502);
    const nodes = data.data?.products?.nodes;
    requireValue(Array.isArray(nodes), 'CATALOG_UNAVAILABLE', 'Merchant catalog response is incomplete.', 502);
    const observedAt = new Date().toISOString();
    return { products: nodes.map(node => normalizeShopifyProduct(node, storeDomain, observedAt)).filter(Boolean), observedAt, source: 'Shopify Storefront API' };
  }
  return { configured, search };
}
