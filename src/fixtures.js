import { CARD_PRODUCTS } from './card-catalog.js';
import { createResearchFixtures } from './research-fixtures.js';

export const DEMO_NOW = '2026-09-23T16:00:00.000Z';
export function createFixtures(now = DEMO_NOW) {
  if (!Number.isFinite(Date.parse(now))) throw new Error('A valid demo clock is required.');
  const relative = days => new Date(Date.parse(now) + days * 86400000).toISOString();
  const users = [
    { id: 'alex', name: 'Alex Morgan', email: 'alex@example.test', interests: ['running', 'apparel', 'outdoors'] },
    { id: 'taylor', name: 'Taylor Lee', email: 'taylor@example.test', interests: ['electronics', 'headphones', 'cooking'] },
  ].map(({ interests, ...u }) => ({ ...u, sample: true, consent: true, timezone: 'America/New_York', activatedOfferIds: [], preferences: { interests, mutedMerchants: [], mutedCategories: [], excludedTransactions: [], dismissedOfferIds: [], notifications: { discovery: true, watching: true, quietStart: 21, quietEnd: 8, dailyLimit: 3 } }, createdAt: now }));
  const accounts = [
    { id: 'alex-checking', userId: 'alex', name: 'Everyday Checking', type: 'asset', balanceCents: 824560 },
    { id: 'alex-credit', userId: 'alex', name: 'Sample Credit Balance', type: 'liability', balanceCents: 128400 },
    { id: 'taylor-checking', userId: 'taylor', name: 'Everyday Checking', type: 'asset', balanceCents: 527800 },
  ].map(a => ({ ...a, currency: 'USD', source: 'Synthetic account fixture', lastSyncedAt: now, provenance: 'synthetic' }));
  const cards = [
    { id: 'alex-discover', userId: 'alex', productId: 'discover-it', last4: '4821', accountId: 'alex-credit' },
    { id: 'alex-active-cash', userId: 'alex', productId: 'active-cash', last4: '9274' },
    { id: 'alex-quicksilver', userId: 'alex', productId: 'quicksilver', last4: '1502' },
    { id: 'taylor-freedom', userId: 'taylor', productId: 'freedom-unlimited', last4: '7308' },
  ].map(c => { const p = CARD_PRODUCTS.find(p => p.id === c.productId); return { ...p, ...c, nickname: p.name, sourceLabel: 'Synthetic holding · published base reward rule', provenance: 'synthetic', paymentReference: `demo-payment-${c.id}` }; });
  const merchants = [
    { id: 'alo', name: 'Alo', category: 'apparel', tags: ['running', 'activewear', 'fitness'], color: '#b1643d' },
    { id: 'nike', name: 'Nike', category: 'apparel', tags: ['running', 'shoes', 'fitness'], color: '#393c46' },
    { id: 'rei', name: 'REI', category: 'outdoors', tags: ['hiking', 'travel', 'running'], color: '#587057' },
    { id: 'bestbuy', name: 'Best Buy', category: 'electronics', tags: ['headphones', 'computers', 'technology'], color: '#587ca0' },
    { id: 'wholefoods', name: 'Whole Foods', category: 'groceries', tags: ['cooking', 'food'], color: '#6e8d58' },
    { id: 'away', name: 'Away', category: 'travel', tags: ['luggage', 'travel'], color: '#a77e55' },
  ].map(m => ({ ...m, provenance: 'synthetic', sourceLabel: 'Merchant scenario label; no production offer claim', aliases: [m.name.toLowerCase()] }));
  const products = [
    { id: 'alo-jacket', merchantId: 'alo', name: 'Alo Running Jacket', category: 'apparel', priceCents: 10400, referencePriceCents: 13000, description: 'Lightweight running layer in warm sand. The 20% demo sale is already reflected in this price.', attributes: { color: 'sand', sizes: ['S', 'M', 'L'], activity: 'running' } },
    { id: 'alo-leggings', merchantId: 'alo', name: 'Everyday Performance Leggings', category: 'apparel', priceCents: 7840, referencePriceCents: 9800, description: 'A versatile activewear staple in midnight.', attributes: { color: 'black', sizes: ['S', 'M', 'L'] } },
    { id: 'nike-pegasus', merchantId: 'nike', name: 'Nike Pegasus Running Shoes', category: 'apparel', priceCents: 11050, referencePriceCents: 13000, description: 'A controlled running-shoe scenario with a 15% observed sale.', attributes: { color: 'white', sizes: ['8', '9', '10', '11'], activity: 'running' } },
    { id: 'nike-tee', merchantId: 'nike', name: 'Everyday Running Tee', category: 'apparel', priceCents: 3400, referencePriceCents: 4000, description: 'A lightweight everyday training tee.', attributes: { sizes: ['S', 'M', 'L'] } },
    { id: 'rei-daypack', merchantId: 'rei', name: 'Trail Daypack 22L', category: 'outdoors', priceCents: 8100, referencePriceCents: 9000, description: 'A compact pack for a day outside.' },
    { id: 'bestbuy-headphones', merchantId: 'bestbuy', name: 'Everyday Wireless Headphones', category: 'electronics', priceCents: 12000, referencePriceCents: 20000, description: 'Synthetic electronics promotion for the Taylor profile.' },
    { id: 'wholefoods-pantry', merchantId: 'wholefoods', name: 'Weekend Pantry Bundle', category: 'groceries', priceCents: 4500, referencePriceCents: 5000, description: 'A controlled grocery bundle fixture.' },
    { id: 'away-carryon', merchantId: 'away', name: 'Weekend Carry-On', category: 'travel', priceCents: 22500, referencePriceCents: 22500, description: 'A controlled luggage comparison fixture.' },
  ].map(p => ({ ...p, title: p.name, merchantName: merchants.find(m => m.id === p.merchantId).name, currency: 'USD', taxCents: 0, shippingCents: 0, availability: 'in_stock', version: 1, observedAt: now, provenance: 'synthetic', referenceEvidence: `fixture:receipt:${p.id}`, priceStage: 'discount_applied' }));
  const offers = [
    { id: 'alo-sale', merchantId: 'alo', productId: 'alo-jacket', title: 'Your next layer, 20% less.', benefitLabel: '20% off selected activewear', type: 'retailer_discount', rateBps: 2000, published: false },
    { id: 'nike-sale', merchantId: 'nike', productId: 'nike-pegasus', title: 'A little more momentum.', benefitLabel: '15% off running essentials', type: 'retailer_discount', rateBps: 1500 },
    { id: 'rei-sale', merchantId: 'rei', productId: 'rei-daypack', title: 'Make room for the outdoors.', benefitLabel: '10% off trail essentials', type: 'retailer_discount', rateBps: 1000 },
    { id: 'bestbuy-sale', merchantId: 'bestbuy', productId: 'bestbuy-headphones', title: 'Better sound. Smaller price.', benefitLabel: '40% off selected headphones', type: 'retailer_discount', rateBps: 4000 },
    { id: 'wholefoods-sale', merchantId: 'wholefoods', productId: 'wholefoods-pantry', title: 'Good food for your weekend.', benefitLabel: '10% off the pantry bundle', type: 'retailer_discount', rateBps: 1000 },
    { id: 'alo-discover-credit', merchantId: 'alo', productId: 'alo-jacket', title: 'An extra $20, with activation.', benefitLabel: '$20 back on $100+ qualifying merchandise', type: 'card_credit', amountCents: 2000, minimumSpendCents: 10000, spendBasis: 'discounted_merchandise', cardId: 'alex-discover', assignedUserIds: ['alex'], activationRequired: true },
    { id: 'expired-sale', merchantId: 'away', productId: 'away-carryon', title: 'Expired luggage event', benefitLabel: '30% off', type: 'retailer_discount', rateBps: 3000, expiresAt: relative(-1) },
    { id: 'unassigned-credit', merchantId: 'alo', title: 'Unassigned synthetic benefit', benefitLabel: '$30 back', type: 'card_credit', amountCents: 3000, minimumSpendCents: 10000, assignedUserIds: ['nobody'], cardId: 'unowned-card' },
    { id: 'unknown-stack-credit', merchantId: 'nike', productId: 'nike-pegasus', title: 'Stacking terms unverified', benefitLabel: '$10 potential benefit · terms unknown', type: 'card_credit', amountCents: 1000, minimumSpendCents: 10000, assignedUserIds: ['alex'], cardId: 'alex-active-cash', stacking: 'unknown' },
  ].map(o => ({ currency: 'USD', active: true, channel: 'online', stacking: 'compatible', usageLimit: 1, startsAt: relative(-7), expiresAt: relative(8), observedAt: now, termsVersion: 1, version: 1, confidence: 'fixture_verified', ...o, category: merchants.find(m => m.id === o.merchantId).category, description: o.type === 'card_credit' ? 'Fictional assigned card benefit. No issuer eligibility is claimed.' : 'Controlled retailer promotion fixture. The observed product price already includes this discount.', sourceRef: `fixture://offers/${o.id}`, provenance: 'synthetic', sourceLabel: 'Synthetic demo offer · not a published issuer or merchant offer' }));
  const transactions = [];
  for (const [userId, merchantId, count, base] of [['alex', 'alo', 12, 10500], ['alex', 'nike', 6, 8600], ['alex', 'rei', 4, 7500], ['taylor', 'bestbuy', 14, 15800], ['taylor', 'wholefoods', 8, 6900], ['taylor', 'away', 4, 18500]]) {
    for (let i = 0; i < count; i++) transactions.push({ id: `tx-${transactions.length + 1}`, userId, accountId: `${userId}-checking`, merchantId, merchantName: merchants.find(m => m.id === merchantId).name, category: merchants.find(m => m.id === merchantId).category, amountCents: base + (i % 5) * 350, currency: 'USD', kind: 'purchase', status: 'posted', postedAt: relative(-(3 + i * 7)), provenance: 'synthetic' });
  }
  for (const [kind, status, extra] of [['purchase', 'pending', { replacesTransactionId: 'tx-1' }], ['refund', 'posted', { originalTransactionId: 'tx-2' }], ['transfer', 'posted', {}], ['card_payment', 'posted', {}], ['purchase', 'posted', { gift: true }]]) transactions.push({ id: `tx-${transactions.length + 1}`, userId: 'alex', accountId: 'alex-checking', merchantId: 'alo', merchantName: 'Alo', category: 'apparel', amountCents: kind === 'refund' ? -10850 : 13000, currency: 'USD', kind, status, postedAt: relative(-2), provenance: 'synthetic', ...extra });
  return { schemaVersion: 1, clock: now, mode: 'demo', users, accounts, cards, cardProducts: structuredClone(CARD_PRODUCTS), transactions, merchants, products, offers, ...createResearchFixtures(now), notifications: [], missions: [], quotes: [], checkoutSessions: [], purchases: [], ledger: [], events: [], researchSessions: [], watches: [], comparisons: [] };
}
