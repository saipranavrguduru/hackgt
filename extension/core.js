const MERCHANT_PRODUCTS = { alo: ['alo-jacket'], nike: ['nike-pegasus'] };

export function expiryTime(value) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function supportedStoreUrl(source) {
  try {
    const url = new URL(source);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.port === '3001' && ['/store', '/store.html'].includes(url.pathname)
      && !url.username && !url.password;
  } catch { return false; }
}

function integer(value, name, minimum = 0, maximum = 100_000_000) {
  if (!/^\d+$/.test(String(value))) throw new Error(`Unreadable ${name}. Refresh the demo cart.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`Invalid ${name}. Refresh the demo cart.`);
  }
  return result;
}

export function parseCartSnapshot(source, data) {
  if (!supportedStoreUrl(source)) throw new Error('Site not supported. Open a controlled Alo or Nike storefront.');
  if (!data) throw new Error('No readable demo cart. Wait for the storefront to load.');
  if (!Object.hasOwn(MERCHANT_PRODUCTS, data.merchantId)) throw new Error('Unsupported merchant.');
  if (!MERCHANT_PRODUCTS[data.merchantId].includes(data.productId)) throw new Error('Unsupported product for this merchant.');
  if (data.currency !== 'USD') throw new Error('Unsupported currency.');
  if (data.cartId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(data.cartId)) throw new Error('Invalid cart identity.');
  const url = new URL(source);
  return {
    merchantId: data.merchantId,
    productId: data.productId,
    quantity: integer(data.quantity, 'quantity', 1, 10),
    merchandiseCents: integer(data.merchandiseCents, 'merchandise amount'),
    shippingCents: integer(data.shippingCents, 'shipping amount'),
    taxCents: integer(data.taxCents, 'tax amount'),
    currency: 'USD',
    version: integer(data.version, 'catalog version', 1),
    cartRevision: integer(data.cartRevision, 'cart revision', 0, Number.MAX_SAFE_INTEGER),
    ...(data.cartId ? { cartId: data.cartId } : {}),
    sourceUrl: url.origin + url.pathname,
  };
}

export function cartFingerprint(cart) {
  return JSON.stringify([
    cart.sourceUrl, cart.merchantId, cart.productId, cart.quantity,
    cart.merchandiseCents, cart.shippingCents, cart.taxCents,
    cart.currency, cart.version, cart.cartRevision, cart.cartId,
  ]);
}

export class ContextGuard {
  constructor() { this.revision = 0; this.tabId = null; this.fingerprint = null; }
  update(tabId, cart) {
    const fingerprint = cartFingerprint(cart);
    if (this.tabId !== tabId || this.fingerprint !== fingerprint) this.revision += 1;
    this.tabId = tabId;
    this.fingerprint = fingerprint;
  }
  capture() { return { revision: this.revision, tabId: this.tabId, fingerprint: this.fingerprint }; }
  isCurrent(context) {
    return this.fingerprint !== null && context.revision === this.revision
      && context.tabId === this.tabId && context.fingerprint === this.fingerprint;
  }
  invalidate() { this.revision += 1; this.fingerprint = null; }
}
