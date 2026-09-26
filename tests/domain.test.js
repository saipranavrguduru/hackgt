import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtures } from '../src/fixtures.js';
import { getProfile, rankOffers, createQuote, validateQuote, activateOffer, evaluateNotifications, createMission, missionMatches, applyPurchaseEvent, savingsSummary, financeSummary, roundBps } from '../src/domain.js';

test('Spend DNA uses posted purchases and respects durable gift corrections and consent', () => {
  const s = createFixtures();
  assert.equal(s.transactions.length, 53);
  const p = getProfile(s, 'alex');
  assert.ok(p.merchants.find(m => m.merchantId === 'alo').count >= 6);
  assert.ok(p.evidenceRefs.every(id => {
    const t = s.transactions.find(t => t.id === id);
    return t.status === 'posted' && t.kind === 'purchase' && !t.gift;
  }));
  const excluded = p.evidenceRefs[0];
  s.users[0].preferences.excludedTransactions.push(excluded);
  assert.ok(!getProfile(s, 'alex').evidenceRefs.includes(excluded));
  s.users[0].consent = false;
  assert.equal(getProfile(s, 'alex').evidenceRefs.length, 0);
  assert.equal(getProfile(s, 'alex').merchants.length, 0);
});

test('For You ranks different profiles without missions and never includes expired/unassigned/muted offers', () => {
  const s = createFixtures();
  const a = rankOffers(s, 'alex');
  const t = rankOffers(s, 'taylor');
  assert.equal(a[0].merchantId, 'alo');
  assert.notEqual(t[0].merchantId, 'alo');
  assert.ok(a.every(o => o.reasons.length && !['expired-sale', 'unassigned-credit'].includes(o.id)));
  s.users[0].preferences.mutedMerchants.push('alo');
  assert.ok(rankOffers(s, 'alex').every(o => o.merchantId !== 'alo'));
});

test('golden quote preserves sale price and distinguishes activation from ready savings', () => {
  const s = createFixtures();
  const q = createQuote(s, 'alex', { productId: 'alo-jacket' });
  assert.equal(q.cart.checkoutCents, 10400);
  assert.equal(q.cart.merchantDiscountCents, 2600);
  assert.equal(q.bestAvailableNowCardId, 'alex-active-cash');
  assert.equal(q.bestAfterActionsCardId, 'alex-discover');
  const d = q.plans.find(p => p.cardId === 'alex-discover');
  assert.equal(d.effectiveCostCents, 10296);
  assert.equal(d.conditionalEffectiveCostCents, 8296);
  assert.equal(d.statementCreditCents, 0);
  assert.equal(q.plans.find(p => p.cardId === 'alex-active-cash').effectiveCostCents, 10192);
  activateOffer(s, 'alex', 'alo-discover-credit');
  const fresh = createQuote(s, 'alex', { productId: 'alo-jacket' });
  const ready = fresh.plans.find(p => p.cardId === 'alex-discover');
  assert.equal(fresh.bestAvailableNowCardId, 'alex-discover');
  assert.equal(ready.checkoutCents, 10400);
  assert.equal(ready.statementCreditCents, 2000);
  assert.equal(ready.rewardCents, 104);
  assert.equal(ready.effectiveCostCents, 8296);
});

test('minimum spend uses discounted merchandise, tax rewards round half-up, unknowns stay unknown', () => {
  const s = createFixtures();
  activateOffer(s, 'alex', 'alo-discover-credit');
  const plan = input => createQuote(s, 'alex', { productId: 'alo-jacket', ...input }).plans.find(p => p.cardId === 'alex-discover');
  assert.equal(plan({ merchandiseCents: 9900, taxCents: 1000 }).statementCreditCents, 0);
  assert.equal(plan({ merchandiseCents: 10000 }).statementCreditCents, 2000);
  assert.equal(plan({ taxCents: 832 }).effectiveCostCents, 9120);
  assert.equal(plan({ taxCents: 832 }).rewardCents, 112);
  const q = createQuote(s, 'alex', { productId: 'alo-jacket', taxCents: null });
  assert.equal(q.provisional, true);
  assert.equal(q.executable, false);
  assert.equal(q.cart.checkoutCents, null);
  assert.equal(roundBps(101, 50), 1);
  assert.throws(() => createQuote(s, 'alex', { productId: 'alo-jacket', currency: 'EUR' }), /USD/);
  assert.throws(() => createQuote(s, 'alex', { productId: 'alo-jacket', taxCents: -1 }), /non-negative/);
});

test('expired, unknown-stacking, wrong-card and consumed benefits cannot enter executable plans', () => {
  const s = createFixtures();
  activateOffer(s, 'alex', 'alo-discover-credit');
  const offer = s.offers.find(o => o.id === 'alo-discover-credit');
  const d = () => createQuote(s, 'alex', { productId: 'alo-jacket' }).plans.find(p => p.cardId === 'alex-discover');
  offer.stacking = 'unknown';
  assert.equal(d().statementCreditCents, 0);
  offer.stacking = 'compatible';
  offer.expiresAt = '2020-01-01T00:00:00.000Z';
  assert.equal(d().statementCreditCents, 0);
  offer.expiresAt = '2027-01-01T00:00:00.000Z';
  offer.assignedUserIds = ['taylor'];
  assert.equal(d().statementCreditCents, 0);
});

test('quotes expire and cart changes invalidate approval', () => {
  const s = createFixtures();
  const q = createQuote(s, 'alex', { productId: 'alo-jacket' });
  assert.equal(validateQuote(s, 'alex', q.id).valid, true);
  assert.equal(validateQuote(s, 'taylor', q.id).valid, false);
  s.products.find(p => p.id === 'alo-jacket').priceCents = 10300;
  assert.equal(validateQuote(s, 'alex', q.id).valid, false);
});

test('a second prepared quote cannot reuse a single-use credit consumed by authorization', () => {
  const s = createFixtures();
  activateOffer(s, 'alex', 'alo-discover-credit');
  const first = createQuote(s, 'alex', { productId: 'alo-jacket' });
  const second = createQuote(s, 'alex', { productId: 'alo-jacket' });
  assert.equal(validateQuote(s, 'alex', second.id).valid, true);
  s.purchases.push({ id: 'consuming-purchase', userId: 'alex', quoteId: first.id, cardId: 'alex-discover', status: 'authorized' });
  assert.equal(validateQuote(s, 'alex', second.id).valid, false);
  const third = createQuote(s, 'alex', { productId: 'alo-jacket' });
  assert.equal(third.plans.find(p => p.cardId === 'alex-discover').statementCreditCents, 0);
});

test('silent eligibility changes invalidate a quote even when the provider version is unchanged', () => {
  const s = createFixtures();
  activateOffer(s, 'alex', 'alo-discover-credit');
  const quote = createQuote(s, 'alex', { productId: 'alo-jacket' });
  s.offers.find(o => o.id === 'alo-discover-credit').assignedUserIds = [];
  assert.equal(validateQuote(s, 'alex', quote.id).valid, false);
});

test('discovery notification replay, relevance, muted merchants and consent gates are enforced', () => {
  const s = createFixtures();
  assert.ok(!rankOffers(s, 'alex').some(o => o.id === 'alo-sale'));
  s.offers.find(o => o.id === 'alo-sale').published = true;
  const trigger = { id: 'publish-1', offerId: 'alo-sale' };
  assert.equal(evaluateNotifications(s, 'alex', trigger).length, 1);
  assert.equal(evaluateNotifications(s, 'alex', trigger).length, 0);
  assert.equal(evaluateNotifications(s, 'taylor', trigger).length, 0);
  s.users[0].preferences.mutedMerchants.push('alo');
  assert.equal(evaluateNotifications(s, 'alex', { id: 'publish-2', offerId: 'alo-sale' }).length, 0);
  s.users[1].consent = false;
  assert.equal(evaluateNotifications(s, 'taylor', { id: 'publish-3', offerId: 'bestbuy-sale' }).length, 0);
});

test('notification master switch and mission-only preference keep explicit watching separate', () => {
  const s = createFixtures();
  s.offers.find(o => o.id === 'alo-sale').published = true;
  s.users[0].preferences.notificationsEnabled = false;
  assert.equal(evaluateNotifications(s, 'alex', { id: 'master-off', offerId: 'alo-sale' }).length, 0);
  s.users[0].preferences.notificationsEnabled = true;
  s.users[0].preferences.missionOnly = true;
  createMission(s, 'alex', { request: 'running jacket under $120' });
  const notices = evaluateNotifications(s, 'alex', { id: 'watching', offerId: 'alo-sale' });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].label, 'Watching');
});

test('mission budget defaults to checkout amount and edits change matches', () => {
  const s = createFixtures();
  const mission = createMission(s, 'alex', { request: 'running jacket under $120', category: 'apparel' });
  assert.equal(mission.maxAmountCents, 12000);
  assert.equal(mission.priceLimitBasis, 'checkout_charge');
  assert.ok(missionMatches(s, 'alex', mission).matches.some(m => m.productId === 'alo-jacket'));
  mission.maxAmountCents = 10000;
  assert.ok(!missionMatches(s, 'alex', mission).matches.some(m => m.productId === 'alo-jacket'));
});

test('mission interpretation enforces product type, color, size and lifecycle', () => {
  const s = createFixtures();
  const black = createMission(s, 'alex', { request: 'black running jacket under $120 in size M' });
  assert.equal(black.color, 'black');
  assert.equal(black.size, 'M');
  assert.equal(black.productType, 'jacket');
  assert.equal(missionMatches(s, 'alex', black).matches.length, 0);
  black.color = 'sand';
  assert.deepEqual(missionMatches(s, 'alex', black).matches.map(m => m.productId), ['alo-jacket']);
  const paused = createMission(s, 'alex', { ...black, status: 'paused' });
  assert.equal(paused.status, 'paused');
  assert.equal(missionMatches(s, 'alex', paused).matches.length, 0);
});

test('malformed mission constraints are rejected before persistence or feed evaluation', () => {
  const s = createFixtures();
  const invalid = [
    { request: {} }, { query: [] }, { category: {} }, { productType: {} },
    { color: [] }, { size: 8 }, { deliveryDeadline: {} }, { deliveryDeadline: 'tomorrow' },
    { request: 'x'.repeat(1001) }, { productType: 'x'.repeat(101) },
    { preferredMerchants: 'alo' }, { excludedMerchants: [null] },
    { preferredMerchants: Array(51).fill('alo') }, { excludedMerchants: ['x'.repeat(101)] },
    { alternativesAllowed: 'false' }, { notifications: {} }, { status: [] },
    { currency: 'EUR' }, { priceLimitBasis: {} },
  ];
  for (const fields of invalid) {
    assert.throws(() => createMission(s, 'alex', { request: 'jacket', ...fields }), /must|unknown|valid|USD/i, JSON.stringify(fields));
    assert.equal(s.missions.length, 0);
  }
  assert.doesNotThrow(() => rankOffers(s, 'alex'));
  const valid = createMission(s, 'alex', { request: 'jacket', category: null, productType: null, color: null, size: null, deliveryDeadline: null, preferredMerchants: ['alo'], excludedMerchants: [], alternativesAllowed: false, notifications: false });
  assert.equal(valid.alternativesAllowed, false);
  assert.equal(valid.notifications, false);
  assert.doesNotThrow(() => missionMatches(s, 'alex', valid));
});

test('an over-budget mission cannot turn a related sale into a Watching notification', () => {
  const s = createFixtures();
  s.offers.find(o => o.id === 'alo-sale').published = true;
  s.users[0].preferences.missionOnly = true;
  createMission(s, 'alex', { request: 'running jacket under $100' });
  assert.equal(evaluateNotifications(s, 'alex', { id: 'over-budget', offerId: 'alo-sale' }).length, 0);
});

function purchase(s) {
  activateOffer(s, 'alex', 'alo-discover-credit');
  const q = createQuote(s, 'alex', { productId: 'alo-jacket' });
  const p = { id: 'purchase-test', userId: 'alex', quoteId: q.id, cardId: 'alex-discover', status: 'authorized', createdAt: s.clock };
  s.purchases.push(p);
  return p;
}

test('ledger follows 0 → 26 → 26 → 46 → 47.04, deduplicates, and reverses append-only', () => {
  const s = createFixtures();
  const p = purchase(s);
  assert.equal(savingsSummary(s, 'alex').totalCents, 0);
  for (const [type, total] of [['settled', 2600], ['qualified', 2600], ['credit_posted', 4600], ['reward_posted', 4704]]) {
    applyPurchaseEvent(s, 'alex', p.id, type, `evt-${type}`);
    assert.equal(savingsSummary(s, 'alex').totalCents, total);
    applyPurchaseEvent(s, 'alex', p.id, type, `evt-${type}`);
    assert.equal(savingsSummary(s, 'alex').totalCents, total);
  }
  applyPurchaseEvent(s, 'alex', p.id, 'credit_posted', 'different-event-same-benefit');
  assert.equal(savingsSummary(s, 'alex').totalCents, 4704);
  assert.equal(s.ledger.length, 3);
  applyPurchaseEvent(s, 'alex', p.id, 'refunded', 'evt-refund');
  assert.equal(savingsSummary(s, 'alex').totalCents, 0);
  assert.equal(s.ledger.length, 6);
  assert.equal(s.ledger.filter(e => e.reversalOf).length, 3);
  applyPurchaseEvent(s, 'alex', p.id, 'reward_posted', 'late-reward');
  assert.equal(savingsSummary(s, 'alex').totalCents, 0);
});

test('posting without settlement is rejected and ownership is enforced', () => {
  const s = createFixtures();
  const p = purchase(s);
  assert.throws(() => applyPurchaseEvent(s, 'alex', p.id, 'credit_posted', 'early'), /settle/i);
  assert.throws(() => applyPurchaseEvent(s, 'taylor', p.id, 'settled', 'alien'), /not found/i);
  assert.equal(s.ledger.length, 0);
});

test('finance summary subtracts each liability once and registered cold-start is honest', () => {
  const s = createFixtures();
  const f = financeSummary(s, 'alex');
  assert.equal(f.netWorthCents, f.assetCents - f.liabilityCents);
  s.users.push({ id: 'new', name: 'New', consent: false, preferences: {} });
  assert.equal(getProfile(s, 'new').status, 'cold_start');
  assert.equal(financeSummary(s, 'new').netWorthCents, 0);
  assert.equal(createQuote(s, 'new', { productId: 'alo-jacket' }).executable, false);
});
