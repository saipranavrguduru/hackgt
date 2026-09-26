import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/server.js';
import { parseCartSnapshot } from '../extension/core.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const origin = `chrome-extension://${extensionId}`;

async function fixture(t) {
  const app = createApplication({ persist: false });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}/api/v1`;
  const request = async (path, { body, method = body ? 'POST' : 'GET', headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  };
  return { app, request };
}

async function pairExtension(request) {
  const pair = await request('/extension/pairings', { body: { extensionId }, headers: { origin, 'sec-fetch-site': 'cross-site' } });
  assert.equal(pair.status, 201, JSON.stringify(pair.body));
  const login = await request('/auth/demo', { body: { userId: 'alex' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const approved = await request(`/extension/pairings/${pair.body.id}/approve`, { body: {}, headers: { cookie } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const exchanged = await request(`/extension/pairings/${pair.body.id}/exchange`, { body: { secret: pair.body.secret }, headers: { origin, 'sec-fetch-site': 'cross-site' } });
  assert.equal(exchanged.status, 200, JSON.stringify(exchanged.body));
  return { headers: { origin, authorization: `Bearer ${exchanged.body.token}`, 'sec-fetch-site': 'cross-site' }, cookie, token: exchanged.body.token };
}

test('Chrome origin can pair, preflight idempotent checkout, quote and revoke its scoped token', async (t) => {
  const { request } = await fixture(t);
  const { headers } = await pairExtension(request);
  const options = await request('/checkout/sessions', {
    method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization,idempotency-key' },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-origin'), origin);
  assert.match(options.headers.get('access-control-allow-headers').toLowerCase(), /idempotency-key/);
  const quote = await request('/commerce/quotes', { body: { productId: 'alo-jacket' }, headers });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.bestAvailableNowCardId, 'alex-active-cash');
  assert.ok(Date.parse(quote.body.expiresAt) > Date.now(), 'API quote expiry must reflect actual time, not the fixture clock');
  const checkout = await request('/checkout/sessions', { body: { quoteId: quote.body.id, cardId: quote.body.bestAvailableNowCardId }, headers: { ...headers, 'idempotency-key': 'extension-review-test' } });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const denied = await request(`/checkout/sessions/${checkout.body.id}/confirm`, { body: { approved: true }, headers });
  assert.equal(denied.status, 403);
  assert.equal((await request('/finance/transactions', { headers })).status, 403);
  assert.equal((await request('/extension/session', { method: 'DELETE', headers })).status, 200);
  assert.notEqual((await request('/commerce/quotes', { body: { productId: 'alo-jacket' }, headers })).status, 200);
});

test('visible pairing id, another extension origin, and expired secrets cannot redeem a connection', async (t) => {
  const { app, request } = await fixture(t);
  const pair = (await request('/extension/pairings', { body: { extensionId }, headers: { origin } })).body;
  const forged = await request(`/extension/pairings/${pair.id}/exchange`, { body: { secret: pair.id }, headers: { origin } });
  assert.equal(forged.status, 403);
  const pending = await request(`/extension/pairings/${pair.id}/exchange`, { body: { secret: pair.secret }, headers: { origin } });
  assert.equal(pending.status, 409);
  const login = await request('/auth/demo', { body: { userId: 'alex' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await request(`/extension/pairings/${pair.id}/approve`, { body: {}, headers: { cookie } });
  const wrongOrigin = await request(`/extension/pairings/${pair.id}/exchange`, { body: { secret: pair.secret }, headers: { origin: `chrome-extension://${'b'.repeat(32)}` } });
  assert.equal(wrongOrigin.status, 403);
  app.store.data.pairings.find((p) => p.id === pair.id).expiresAt = Date.now() - 1;
  assert.equal((await request(`/extension/pairings/${pair.id}/exchange`, { body: { secret: pair.secret }, headers: { origin } })).status, 403);
});

test('controlled cart adapter agrees with portal quotes and server rejects tampered page totals', async (t) => {
  const { request } = await fixture(t);
  const { headers, cookie } = await pairExtension(request);
  const products = (await request('/store/products')).body.products;
  for (const productId of ['alo-jacket', 'nike-pegasus']) {
    const product = products.find((p) => p.id === productId);
    const extracted = parseCartSnapshot(`http://localhost:3001/store?product=${product.id}`, {
      productId: product.id, merchantId: product.merchantId, quantity: '2',
      merchandiseCents: String(product.priceCents * 2), shippingCents: String(product.shippingCents), taxCents: String(product.taxCents),
      currency: product.currency, version: String(product.version), cartRevision: '2',
    });
    const { sourceUrl, cartRevision, merchantId, ...cart } = extracted;
    const extensionQuote = await request('/commerce/quotes', { body: { productId, quantity: 2, cart }, headers });
    const portalQuote = await request('/commerce/quotes', { body: { productId, quantity: 2 }, headers: { cookie } });
    assert.equal(extensionQuote.status, 200, JSON.stringify(extensionQuote.body));
    assert.deepEqual(extensionQuote.body.plans, portalQuote.body.plans);
    assert.equal(extensionQuote.body.cartFingerprint, portalQuote.body.cartFingerprint);
    for (const change of [{ merchandiseCents: 1 }, { taxCents: 100 }, { shippingCents: 100 }, { version: 999 }, { quantity: 1 }]) {
      const rejected = await request('/commerce/quotes', { body: { productId, quantity: 2, cart: { ...cart, ...change } }, headers });
      assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    }
  }
});

test('changing the source store cart invalidates checkout already handed to the portal', async (t) => {
  const { request } = await fixture(t);
  const { headers, cookie } = await pairExtension(request);
  const created = await request('/store/carts', { body: { productId: 'alo-jacket', quantity: 1 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cart = created.body;
  assert.ok(cart.secret);
  const publicSnapshot = await request(`/store/carts/${cart.id}`);
  assert.equal(Object.hasOwn(publicSnapshot.body, 'secret'), false);
  const quote = await request('/commerce/quotes', {
    body: { productId: 'alo-jacket', quantity: 1, cart: { ...cart.cart, cartId: cart.id, cartRevision: cart.revision } }, headers,
  });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const checkout = await request('/checkout/sessions', { body: { quoteId: quote.body.id, cardId: quote.body.bestAvailableNowCardId }, headers });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const unauthorized = await request(`/store/carts/${cart.id}`, { method: 'PATCH', body: { secret: 'wrong-secret', quantity: 2 } });
  assert.equal(unauthorized.status, 403);
  const updated = await request(`/store/carts/${cart.id}`, { method: 'PATCH', body: { secret: cart.secret, quantity: 2 } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.ok(updated.body.revision > cart.revision);
  assert.equal(updated.body.cart.merchandiseCents, 20800);
  const confirmation = await request(`/checkout/sessions/${checkout.body.id}/confirm`, { body: { approved: true }, headers: { cookie } });
  assert.equal(confirmation.status, 409, JSON.stringify(confirmation.body));
  assert.equal((await request('/rewards/purchases', { headers: { cookie } })).body.length, 0);
});
