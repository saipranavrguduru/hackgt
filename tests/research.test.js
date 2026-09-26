import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtures } from '../src/fixtures.js';
import { searchProducts, createResearchSession, getResearchBrief, compareProducts, watchProduct, applyListingEvent } from '../src/research.js';

test('flight headphone request yields a bounded canonical shortlist and explicit requirements', () => {
  const s = createFixtures();
  const session = createResearchSession(s, 'alex', { query: 'Find the best noise-cancelling headphones for long flights under $350' });
  assert.equal(session.requirements.maxAmountCents, 35000);
  assert.equal(session.requirements.category, 'headphones');
  assert.equal(session.requirements.priceLimitBasis, 'merchandise');
  assert.ok(session.candidates.length >= 3 && session.candidates.length <= 5);
  assert.equal(new Set(session.candidates.map(p => p.id)).size, session.candidates.length);
  assert.ok(session.candidates.every(p => p.priceCents <= 35000));
  assert.ok(session.candidates.every(p => p.listings.length));
});

test('exact product search deduplicates multiple merchant listings', () => {
  const s = createFixtures();
  const products = searchProducts(s, 'alex', { query: 'Aero Quiet 4' });
  assert.equal(products.length, 1);
  assert.ok(products[0].listings.length >= 2);
});

test('every material brief finding is sourced and conflicting battery claims stay visible', () => {
  const s = createFixtures();
  const brief = getResearchBrief(s, 'alex', 'aero-quiet-4', { useCase: 'long flights' });
  assert.ok(brief.findings.length >= 3);
  assert.ok(brief.findings.every(f => f.evidenceRefs.length && f.evidenceRefs.every(id => brief.sources.some(s => s.id === id))));
  assert.ok(brief.facts.some(f => f.conflicts?.length));
  assert.ok(new Set(brief.sources.map(s => s.sourceType)).size >= 3);
  assert.equal(brief.provenance, 'synthetic');
});

test('research works without consent and comparisons respond to hard requirements', () => {
  const s = createFixtures();
  s.users[0].consent = false;
  const result = createResearchSession(s, 'alex', { query: 'headphones under $350' });
  assert.ok(result.candidates.length >= 3);
  const ids = ['aero-quiet-4', 'studio-go'];
  const cheap = compareProducts(s, 'alex', { productIds: ids, requirements: { maxAmountCents: 20000 } });
  assert.equal(cheap.recommendedProductId, 'studio-go');
  const quiet = compareProducts(s, 'alex', { productIds: ids, requirements: { mustHave: ['strong ANC'] } });
  assert.equal(quiet.recommendedProductId, 'aero-quiet-4');
});

test('controlled deal product can be researched without inventing a review consensus', () => {
  const s = createFixtures();
  const brief = getResearchBrief(s, 'alex', 'alo-jacket');
  assert.equal(brief.product.id, 'alo-jacket');
  assert.ok(brief.unknowns.length);
  assert.ok(brief.sources.every(source => source.provenance === 'synthetic'));
});

test('watch price events deduplicate and remain scoped to watch owner', () => {
  const s = createFixtures();
  const watch = watchProduct(s, 'alex', { productId: 'aero-quiet-4', targetPriceCents: 25000 });
  const listing = s.researchListings.find(l => l.productId === watch.productId);
  const input = { listingId: listing.id, priceCents: 24000, eventId: 'price-event-1' };
  assert.equal(applyListingEvent(s, 'alex', input).notifications.length, 1);
  assert.equal(applyListingEvent(s, 'alex', input).notifications.length, 0);
  assert.equal(s.notifications.filter(n => n.userId === 'taylor').length, 0);
  assert.equal(s.purchases.length, 0);
});

test('an unknown listing price cannot become a zero-dollar watch alert', () => {
  const s = createFixtures();
  const listing = s.researchListings[0];
  const before = listing.priceCents;
  watchProduct(s, 'alex', { productId: listing.productId, targetPriceCents: 25000 });
  assert.throws(() => applyListingEvent(s, 'alex', { listingId: listing.id, priceCents: null, eventId: 'unknown-price' }), /known/i);
  assert.equal(listing.priceCents, before);
  assert.equal(s.notifications.length, 0);
});

test('checkout research ceilings include tax and shipping, with exact cent boundaries', () => {
  const s = createFixtures();
  const input = { productIds: ['studio-go', 'aero-quiet-4'], requirements: { maxAmountCents: 20000, priceLimitBasis: 'checkout_charge' } };
  for (const listing of s.researchListings.filter(l => l.productId === 'studio-go')) Object.assign(listing, { priceCents: 19900, shippingCents: 1000, taxCents: 0 });
  let comparison = compareProducts(s, 'alex', input);
  assert.equal(comparison.products.find(p => p.id === 'studio-go').meetsRequirements, false);
  assert.equal(comparison.recommendedProductId, null);
  const listing = s.researchListings.find(l => l.productId === 'studio-go');
  Object.assign(listing, { priceCents: 19000, shippingCents: 500, taxCents: 500 });
  comparison = compareProducts(s, 'alex', input);
  assert.equal(comparison.products.find(p => p.id === 'studio-go').budgetAmountCents, 20000);
  assert.equal(comparison.recommendedProductId, 'studio-go');
  listing.taxCents = 501;
  assert.equal(compareProducts(s, 'alex', input).recommendedProductId, null);
});

test('unknown checkout components and unmodeled effective cost cannot satisfy a hard research budget', () => {
  const s = createFixtures();
  const productIds = ['studio-go', 'aero-quiet-4'];
  for (const priceLimitBasis of ['checkout_charge', 'effective_cost']) {
    const comparison = compareProducts(s, 'alex', { productIds, requirements: { maxAmountCents: 35000, priceLimitBasis } });
    assert.equal(comparison.recommendedProductId, null);
    assert.ok(comparison.products.every(p => !p.meetsRequirements && p.budgetAmountCents === null && p.budgetCertainty === 'unknown'));
  }
  const merchandise = compareProducts(s, 'alex', { productIds, requirements: { maxAmountCents: 20000, priceLimitBasis: 'merchandise' } });
  assert.equal(merchandise.recommendedProductId, 'studio-go');
  assert.equal(merchandise.products.find(p => p.id === 'studio-go').budgetAmountCents, 17900);
});

test('research search and briefs share checkout-budget matching and select a known all-in listing', () => {
  const s = createFixtures();
  const rows = s.researchListings.filter(l => l.productId === 'studio-go');
  Object.assign(rows[0], { priceCents: 18000, shippingCents: 3000, taxCents: 0 });
  Object.assign(rows[1], { priceCents: 19000, shippingCents: 0, taxCents: 500 });
  const requirements = { maxAmountCents: 20000, priceLimitBasis: 'checkout_charge' };
  const result = searchProducts(s, 'alex', { query: 'Studio Go', requirements });
  assert.equal(result.length, 1);
  assert.equal(result[0].budgetAmountCents, 19500);
  assert.equal(result[0].selectedListingId, rows[1].id);
  const brief = getResearchBrief(s, 'alex', 'studio-go', requirements);
  assert.equal(brief.budgetAmountCents, 19500);
  assert.equal(brief.meetsRequirements, true);
  rows[1].taxCents = null;
  assert.equal(searchProducts(s, 'alex', { query: 'Studio Go', requirements }).length, 0);
});
