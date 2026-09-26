import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCartSnapshot, cartFingerprint, ContextGuard, expiryTime } from '../extension/core.js';

const url = 'http://localhost:3001/store?product=alo-jacket&ignored=private';
const data = {
  merchantId: 'alo', productId: 'alo-jacket', quantity: '1',
  merchandiseCents: '10400', shippingCents: '0', taxCents: '0',
  currency: 'USD', version: '1', cartRevision: '7',
};

test('controlled extraction sends only shopping context and strips unrelated URL data', () => {
  const snapshot = parseCartSnapshot(url, { ...data, password: 'never-copy', cardNumber: 'never-copy' });
  assert.deepEqual(snapshot, {
    merchantId: 'alo', productId: 'alo-jacket', quantity: 1,
    merchandiseCents: 10400, shippingCents: 0, taxCents: 0,
    currency: 'USD', version: 1, cartRevision: 7,
    sourceUrl: 'http://localhost:3001/store',
  });
});

test('adapter rejects unapproved origins, paths, and merchants before reading a quote', () => {
  for (const source of ['https://alo.com/store', 'http://localhost:3002/store', 'http://localhost:3001/account', 'http://localhost.evil.test:3001/store', 'http://user:secret@localhost:3001/store']) {
    assert.throws(() => parseCartSnapshot(source, data), /supported/i);
  }
  assert.throws(() => parseCartSnapshot(url, { ...data, merchantId: 'unknown' }), /merchant/i);
  assert.throws(() => parseCartSnapshot(url, { ...data, merchantId: 'nike' }), /product/i);
  assert.equal(parseCartSnapshot('http://127.0.0.1:3001/store', data).productId, 'alo-jacket');
});

test('invalid quantities, unknown totals and malformed cents cannot become a final cart', () => {
  for (const quantity of ['0', '-1', '1.5', '11', 'NaN', '']) {
    assert.throws(() => parseCartSnapshot(url, { ...data, quantity }), /quantity/i);
  }
  for (const cents of ['', '-1', 'unknown', '1.1', '9007199254740992']) {
    assert.throws(() => parseCartSnapshot(url, { ...data, taxCents: cents }), /tax/i);
  }
  assert.throws(() => parseCartSnapshot(url, { ...data, currency: 'EUR' }), /currency/i);
  assert.throws(() => parseCartSnapshot(url, { ...data, version: '0' }), /version/i);
});

test('cart fingerprint changes when quantity, price, catalog version or cart revision changes', () => {
  const snapshot = parseCartSnapshot(url, data);
  for (const change of [{ quantity: 2, merchandiseCents: 20800 }, { merchandiseCents: 10000 }, { version: 2 }, { cartRevision: 8 }]) {
    assert.notEqual(cartFingerprint(snapshot), cartFingerprint({ ...snapshot, ...change }));
  }
});

test('storefront timestamp revisions remain valid and invalidate quotes after a page reload', () => {
  const before = parseCartSnapshot(url, { ...data, cartRevision: '1790000000000' });
  const after = parseCartSnapshot(url, { ...data, cartRevision: '1790000000001' });
  assert.equal(before.cartRevision, 1790000000000);
  assert.notEqual(cartFingerprint(before), cartFingerprint(after));
});

test('server cart identity is sent without the update secret and changes the fingerprint', () => {
  const snapshot = parseCartSnapshot(url, { ...data, cartId: 'cart-123', secret: 'private-update-secret' });
  assert.equal(snapshot.cartId, 'cart-123');
  assert.equal(Object.hasOwn(snapshot, 'secret'), false);
  assert.notEqual(cartFingerprint(snapshot), cartFingerprint({ ...snapshot, cartId: 'cart-456' }));
  assert.throws(() => parseCartSnapshot(url, { ...data, cartId: 'bad/cart?secret' }), /cart identity/i);
});

test('cart and tab changes invalidate a pending quote even when the old context returns', () => {
  const guard = new ContextGuard();
  const cart = parseCartSnapshot(url, data);
  guard.update(10, cart);
  const first = guard.capture();
  assert.equal(guard.isCurrent(first), true);
  guard.update(10, cart);
  assert.equal(guard.isCurrent(first), true);
  guard.update(10, { ...cart, quantity: 2 });
  assert.equal(guard.isCurrent(first), false);
  guard.update(10, cart);
  assert.equal(guard.isCurrent(first), false);
  const second = guard.capture();
  guard.update(11, cart);
  assert.equal(guard.isCurrent(second), false);
  guard.update(10, cart);
  assert.equal(guard.isCurrent(second), false);
});

test('explicit invalidation drops pending work after disconnect or navigation', () => {
  const guard = new ContextGuard();
  guard.update(10, parseCartSnapshot(url, data));
  const pending = guard.capture();
  guard.invalidate();
  assert.equal(guard.isCurrent(pending), false);
});

test('numeric session expiry and ISO quote expiry both reject expired sessions', () => {
  assert.equal(expiryTime(1800000000000), 1800000000000);
  assert.equal(expiryTime('2027-01-15T08:00:00.000Z'), 1800000000000);
  assert.equal(expiryTime(undefined), 0);
  assert.equal(expiryTime('not a date'), 0);
});
