import { createHash, randomUUID } from 'node:crypto';
import { getCardProduct, getRewardRule } from './card-catalog.js';
import { requireValue } from './errors.js';

const now = state => state.clock || '2026-09-23T16:00:00.000Z';
const id = prefix => `${prefix}-${randomUUID()}`;
const ownedUser = (state, userId) => { const user = state.users.find(u => u.id === userId); if (!user) throw new Error('User not found.'); return user; };
const prefs = user => ({ interests: [], mutedMerchants: [], mutedCategories: [], excludedTransactions: [], dismissedOfferIds: [], ...user.preferences });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money = (value, label, nullable = false) => {
  if (nullable && value === null) return value;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative integer cents.`);
  return value;
};
export function roundBps(amountCents, rateBps) {
  money(amountCents, 'Amount'); money(rateBps, 'Rate');
  const result = (BigInt(amountCents) * BigInt(rateBps) + 5000n) / 10000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds supported range.');
  return Number(result);
}

export const LOCATION_CATEGORIES = Object.freeze({ dining: 'Dining', groceries: 'Groceries', gas: 'Gas', drugstores: 'Drugstores', other: 'Other / unsure' });

export function recommendLocationCards(state, userId, input = {}) {
  const user = ownedUser(state, userId);
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_LOCATION_CONTEXT', 'Choose a purchase category.');
  requireValue(typeof input.category === 'string' && Object.hasOwn(LOCATION_CATEGORIES, input.category), 'INVALID_CATEGORY', 'Choose Dining, Groceries, Gas, Drugstores, or Other / unsure.');
  requireValue(input.placeName === undefined || typeof input.placeName === 'string' && input.placeName.length <= 120, 'INVALID_PLACE_NAME', 'Place name must be text up to 120 characters.');
  const amountCents = input.amountCents ?? null;
  requireValue(amountCents === null || Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 100000000, 'INVALID_AMOUNT', 'Enter a purchase amount between $0.01 and $1,000,000.');
  const category = input.category;
  const ownedCards = state.cards.filter(card => card.userId === userId);
  const cards = ownedCards.filter(card => getCardProduct(card.productId)).map(card => {
    const product = getCardProduct(card.productId);
    const rule = getRewardRule(card, { category });
    return {
      cardId: card.id, cardName: product.name, last4: card.last4 || null, ...rule,
      rewardCents: amountCents === null ? null : roundBps(amountCents, rule.rewardBps),
      baseRewardCents: amountCents === null ? null : roundBps(amountCents, rule.baseRewardBps),
      ownership: card.provenance === 'synthetic' ? 'synthetic' : 'self_reported'
    };
  }).sort((a,b) => b.rewardBps - a.rewardBps || (a.cardId === user.preferredCardId ? -1 : b.cardId === user.preferredCardId ? 1 : a.cardId.localeCompare(b.cardId)));
  const best = cards[0];
  const tied = best && cards.filter(card => card.rewardBps === best.rewardBps).length > 1;
  const explanation = best
    ? `${best.cardName} ${tied ? 'ties for the highest' : 'has the highest'} supported reward rate in your Wallet: ${best.rewardBps / 100}%${best.basis === 'category' ? ` if this purchase codes as ${category}` : ' on eligible purchases'}.`
    : 'Add a card you already have in Wallet to compare supported rewards.';
  return {
    category, categoryLabel: LOCATION_CATEGORIES[category], placeName: (input.placeName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim(), amountCents,
    cards, bestCardId: best?.cardId || null, explanation, unsupportedCardCount: ownedCards.length - cards.length,
    disclaimer: 'Place types do not verify issuer merchant codes. Category bonuses depend on how the merchant processes your purchase; otherwise the base rate applies. Estimates exclude rotating categories, activation offers, promotional bonuses, fees and interest. Issuer eligibility and rounding may differ.'
  };
}

export function getProfile(state, userId) {
  const user = ownedUser(state, userId), preferences = prefs(user);
  const refunds = new Set(state.transactions.filter(t => t.userId === userId && t.kind === 'refund' && t.status === 'posted').map(t => t.originalTransactionId));
  const history = user.consent ? state.transactions.filter(t => t.userId === userId && t.kind === 'purchase' && t.status === 'posted' && t.amountCents > 0 && !t.gift && !refunds.has(t.id) && !preferences.excludedTransactions.includes(t.id) && !preferences.mutedMerchants.includes(t.merchantId) && !preferences.mutedCategories.includes(t.category)) : [];
  const aggregate = key => Object.values(history.reduce((groups, t) => {
    const value = t[key];
    const g = groups[value] ||= { [key]: value, name: key === 'merchantId' ? state.merchants.find(m => m.id === value)?.name || value : value, count: 0, totalCents: 0, lastPurchaseAt: t.postedAt, evidenceRefs: [], origin: 'inferred', uncertainty: 'Observed transactions; product details are unknown.' };
    g.count++; g.totalCents += t.amountCents; g.evidenceRefs.push(t.id); if (t.postedAt > g.lastPurchaseAt) g.lastPurchaseAt = t.postedAt;
    return groups;
  }, {})).map(g => ({ ...g, typicalTransactionCents: Math.round(g.totalCents / g.count) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const totalCents = history.reduce((sum, t) => sum + t.amountCents, 0);
  const merchants = aggregate('merchantId'), categories = aggregate('category').map(c => ({ ...c, shareBps: totalCents ? Math.round(c.totalCents / totalCents * 10000) : 0 }));
  const ready = history.length >= 3;
  return { userId, consent: !!user.consent, status: ready ? 'ready' : 'cold_start', summary: ready ? `You return to ${merchants.slice(0, 2).map(m => m.name).join(' and ')}. ${history.length} posted purchases shape these patterns; item-level preferences are never inferred.` : 'Add explicit interests to shape discovery. Spending patterns appear only with consent and sufficient posted purchases.', merchants, categories, evidenceRefs: history.map(t => t.id), transactionCount: history.length, totalCents, preferences, explicitPreferences: preferences.interests.map(interest => ({ value: interest, origin: 'user_stated', evidenceRefs: [] })), generatedAt: now(state), provenance: 'synthetic' };
}

function offerEligibility(state, user, offer, cardId) {
  const time = Date.parse(now(state));
  if (offer.active === false || Date.parse(offer.startsAt) > time || Date.parse(offer.expiresAt) <= time) return 'Offer is not active.';
  if (offer.currency !== 'USD') return 'Unsupported currency.';
  if (offer.type === 'card_credit') {
    if (!offer.assignedUserIds?.includes(user.id)) return 'No verified assignment to this user.';
    if (!state.cards.some(c => c.userId === user.id && c.id === offer.cardId)) return 'Assigned card is not connected.';
    if (cardId && offer.cardId !== cardId) return 'Benefit belongs to another card.';
    const uses = state.purchases.filter(p => p.userId === user.id && p.status !== 'failed' && (p.status !== 'refunded' || !offer.restoresOnRefund) && (p.plan?.offerId === offer.id || state.quotes.find(q => q.id === p.quoteId)?.plans.find(plan => plan.cardId === p.cardId)?.offerId === offer.id)).length;
    if (uses >= (offer.usageLimit ?? Infinity)) return 'Offer usage limit reached.';
  }
  return null;
}

export function rankOffers(state, userId) {
  const user = ownedUser(state, userId), preferences = prefs(user), profile = getProfile(state, userId);
  const watchingProducts = new Map();
  for (const mission of state.missions.filter(m => m.userId === userId && m.status === 'active' && m.notifications !== false)) for (const match of missionMatches(state, userId, mission, { persistQuotes: false }).matches) watchingProducts.set(match.productId, mission);
  return state.offers.filter(offer => offer.published !== false && !offerEligibility(state, user, offer) && !preferences.mutedMerchants.includes(offer.merchantId) && !preferences.mutedCategories.includes(offer.category) && !preferences.dismissedOfferIds.includes(offer.id) && offer.stacking !== 'unknown').map(offer => {
    const merchant = state.merchants.find(m => m.id === offer.merchantId);
    const familiar = profile.merchants.find(m => m.merchantId === offer.merchantId);
    const category = profile.categories.find(c => c.category === offer.category);
    const interests = preferences.interests.filter(i => [offer.category, ...(merchant?.tags || [])].some(tag => tag.toLowerCase().includes(i.toLowerCase()) || i.toLowerCase().includes(tag.toLowerCase())));
    const mission = watchingProducts.get(offer.productId);
    const reasons = [];
    if (familiar) reasons.push({ type: 'merchant_affinity', text: `You've shopped at ${merchant.name} ${familiar.count} times in your sample history.`, evidenceRefs: familiar.evidenceRefs });
    else if (category) reasons.push({ type: 'category_affinity', text: `${offer.category} appears in ${category.count} of your posted purchases.`, evidenceRefs: category.evidenceRefs });
    if (interests.length) reasons.push({ type: 'explicit_interest', text: `Matches your stated interest in ${interests.join(', ')}.`, evidenceRefs: [] });
    if (mission) reasons.push({ type: 'mission', text: 'Matches a category you are watching.', evidenceRefs: [mission.id] });
    if (!reasons.length) reasons.push({ type: 'catalog', text: 'An active catalog opportunity; no personal spending connection is claimed.', evidenceRefs: [] });
    const score = (familiar ? 40 + Math.min(familiar.count * 3, 30) : 0) + (category ? Math.min(category.count * 1.5, 20) : 0) + (interests.length ? 24 : 0) + (mission ? 35 : 0) + Math.min((offer.rateBps || 0) / 200, 20) + (offer.type === 'card_credit' ? 6 : 0);
    const activated = user.activatedOfferIds?.includes(offer.id) || false;
    return { ...offer, merchantName: merchant?.name || offer.merchantId, score, reasons, reason: reasons[0].text, label: mission ? 'Watching' : 'For You', activated, eligibility: offer.type === 'card_credit' ? activated || !offer.activationRequired ? 'available' : 'activation_required' : 'available' };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function activateOffer(state, userId, offerId) {
  const user = ownedUser(state, userId), offer = state.offers.find(o => o.id === offerId);
  if (!offer) throw new Error('Offer not found.');
  const failure = offerEligibility(state, user, offer);
  if (failure) throw new Error(failure);
  user.activatedOfferIds ||= [];
  if (!user.activatedOfferIds.includes(offerId)) user.activatedOfferIds.push(offerId);
  return { offerId, activated: true, activatedAt: now(state), provenance: 'synthetic', message: 'Activation confirmed by the controlled demo adapter.' };
}

export function evaluateNotifications(state, userId, trigger = {}) {
  const user = ownedUser(state, userId), preferences = prefs(user), rules = { discovery: true, watching: true, quietStart: 21, quietEnd: 8, dailyLimit: 3, ...preferences.notifications };
  if (preferences.notificationsEnabled === false) return [];
  const candidates = rankOffers(state, userId).filter(o => (!trigger.offerId || o.id === trigger.offerId) && o.score >= 45 && (o.rateBps >= 1000 || o.amountCents >= 1000) && (o.label === 'Watching' ? rules.watching !== false : user.consent && rules.discovery !== false && !preferences.missionOnly));
  const results = [];
  for (const offer of candidates) {
    const dedupeKey = `offer:${userId}:${offer.id}:${offer.version}:${trigger.id || 'evaluate'}`;
    if (state.notifications.some(n => n.dedupeKey === dedupeKey || n.userId === userId && n.merchantId === offer.merchantId && Date.parse(now(state)) - Date.parse(n.createdAt) < 86400000)) continue;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: user.timezone || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now(state))));
    const quiet = rules.quietStart > rules.quietEnd ? hour >= rules.quietStart || hour < rules.quietEnd : hour >= rules.quietStart && hour < rules.quietEnd;
    const daily = state.notifications.filter(n => n.userId === userId && n.delivery === 'toast' && n.createdAt.slice(0, 10) === now(state).slice(0, 10)).length;
    const notification = { id: id('notification'), userId, type: offer.label === 'Watching' ? 'mission' : 'discovery', label: offer.label, offerId: offer.id, productId: offer.productId, merchantId: offer.merchantId, title: `${offer.merchantName}: ${offer.benefitLabel}`, message: offer.reason, reasons: offer.reasons, dedupeKey, triggerId: trigger.id || null, channel: 'in_app', delivery: quiet || daily >= rules.dailyLimit ? 'inbox' : 'toast', quietHours: quiet, read: false, dismissed: false, createdAt: now(state), provenance: 'synthetic' };
    state.notifications.push(notification); results.push(notification);
  }
  return results;
}

export function createQuote(state, userId, input = {}, { persist = true } = {}) {
  const user = ownedUser(state, userId);
  const product = input.productId ? state.products.find(p => p.id === input.productId) : null;
  if (input.productId && !product) throw new Error('Product not found.');
  const merchantId = product?.merchantId || input.merchantId;
  if (!state.merchants.some(m => m.id === merchantId)) throw new Error('Supported merchant required.');
  if ((input.currency || product?.currency || 'USD') !== 'USD') throw new Error('Only USD is supported.');
  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) throw new Error('Quantity must be 1–10.');
  if (input.version !== undefined && product && input.version !== product.version) throw new Error('The cart version changed; refresh the product.');
  const merchandiseCents = money(input.merchandiseCents ?? (product ? product.priceCents * quantity : undefined), 'Merchandise');
  const referenceCents = money(input.referenceCents ?? (product ? product.referencePriceCents * quantity : merchandiseCents), 'Reference');
  const taxCents = money(input.taxCents !== undefined ? input.taxCents : product?.taxCents ?? null, 'Tax', true);
  const shippingCents = money(input.shippingCents !== undefined ? input.shippingCents : product?.shippingCents ?? null, 'Shipping', true);
  const provisional = taxCents === null || shippingCents === null;
  const checkoutCents = provisional ? null : money(merchandiseCents + taxCents + shippingCents, 'Checkout');
  const merchantDiscountCents = product?.referenceEvidence ? Math.max(0, referenceCents - merchandiseCents) : 0;
  const cart = { productId: product?.id || null, productName: product?.name || 'Manual cart', merchantId, merchantName: state.merchants.find(m => m.id === merchantId).name, quantity, merchandiseCents, referenceCents, merchantDiscountCents, taxCents, shippingCents, checkoutCents, currency: 'USD', version: product?.version || null, referenceEvidence: product?.referenceEvidence || null, priceStage: product?.priceStage || 'observed' };
  const plans = state.cards.filter(card => card.userId === userId).map(card => {
    const productRule = getCardProduct(card.productId);
    const rewardRule = getRewardRule(card, { category: state.merchants.find(m => m.id === merchantId)?.category });
    const rateBps = rewardRule.rewardBps;
    const rewardCents = checkoutCents === null ? null : Math.min(checkoutCents, roundBps(checkoutCents, rateBps));
    const disallowedBenefits = [], eligible = [], conditional = [];
    for (const offer of state.offers.filter(o => o.merchantId === merchantId && o.type === 'card_credit')) {
      let reason = offerEligibility(state, user, offer, card.id);
      if (!reason && offer.channel && offer.channel !== (input.channel || 'online')) reason = 'Purchase channel does not qualify.';
      if (!reason && offer.stacking !== 'compatible') reason = offer.stacking === 'incompatible' ? 'Benefits cannot stack.' : 'Stacking compatibility is unknown.';
      if (!reason && offer.excludedProductIds?.includes(product?.id)) reason = 'Product is excluded by the terms.';
      const thresholdBasis = offer.spendBasis === 'checkout_charge' ? checkoutCents : merchandiseCents;
      if (!reason && (thresholdBasis === null || thresholdBasis < (offer.minimumSpendCents || 0))) reason = 'Below the qualifying spend threshold.';
      if (reason) { disallowedBenefits.push({ offerId: offer.id, reason }); continue; }
      const amountCents = Math.min(offer.amountCents ?? roundBps(merchandiseCents, offer.rateBps || 0), offer.capCents ?? Number.MAX_SAFE_INTEGER, merchandiseCents);
      const entry = { ...offer, benefitCents: amountCents };
      if (offer.activationRequired && !user.activatedOfferIds?.includes(offer.id)) conditional.push(entry); else eligible.push(entry);
    }
    eligible.sort((a, b) => b.benefitCents - a.benefitCents); conditional.sort((a, b) => b.benefitCents - a.benefitCents);
    const chosen = eligible[0], conditionalChosen = conditional[0]?.benefitCents > (chosen?.benefitCents || 0) ? conditional[0] : null;
    const statementCreditCents = chosen?.benefitCents || 0;
    const conditionalStatementCreditCents = conditionalChosen?.benefitCents ?? statementCreditCents;
    const prerequisites = conditionalChosen ? [{ type: 'activation', offerId: conditionalChosen.id, message: 'Activate the synthetic assigned offer, then create a fresh quote.' }] : [];
    if (provisional) prerequisites.push({ type: 'unknown_amount', message: 'Tax and shipping must be known before checkout approval.' });
    return { cardId: card.id, cardName: card.name || card.nickname || productRule?.name, last4: card.last4, rewardBps: rateBps, checkoutCents, payTodayCents: checkoutCents, statementCreditCents, expectedCreditCents: statementCreditCents, rewardCents, effectiveCostCents: checkoutCents === null ? null : Math.max(0, checkoutCents - statementCreditCents - rewardCents), conditionalStatementCreditCents, conditionalEffectiveCostCents: checkoutCents === null ? null : Math.max(0, checkoutCents - conditionalStatementCreditCents - rewardCents), prerequisites, disallowedBenefits, offerId: chosen?.id || null, conditionalOfferId: conditionalChosen?.id || null, ready: !provisional, checkoutEligible: !provisional && !!card.paymentReference && card.provenance === 'synthetic' && user.sample === true, sourceRefs: [productRule?.sourceUrl, chosen?.sourceRef].filter(Boolean), calculationNotes: [productRule?.limitations || 'Only known base rewards are modeled.', 'Cash reward is estimated on the full charge. Statement credit threshold uses the stated offer basis.', 'Interest, fees and financing effects are excluded.'], provenance: card.provenance || 'self_reported' };
  });
  const tie = (a, b) => (a.cardId === user.preferredCardId ? -1 : b.cardId === user.preferredCardId ? 1 : a.cardId.localeCompare(b.cardId));
  const ready = plans.filter(p => p.ready).sort((a, b) => a.effectiveCostCents - b.effectiveCostCents || tie(a, b));
  const after = plans.filter(p => p.ready).sort((a, b) => a.conditionalEffectiveCostCents - b.conditionalEffectiveCostCents || tie(a, b));
  const quote = { id: id('quote'), userId, cart, plans, bestAvailableNowCardId: ready[0]?.cardId || null, bestAfterActionsCardId: after[0]?.cardId || null, provisional, executable: plans.some(p => p.checkoutEligible), createdAt: now(state), expiresAt: new Date(Date.parse(now(state)) + 15 * 60000).toISOString(), cartFingerprint: hash(cart), sourceVersions: { productVersion: product?.version || null, productPriceCents: product?.priceCents ?? null, offers: state.offers.map(o => `${o.id}:${o.version}:${o.termsVersion}:${o.active}:${o.expiresAt}`).join('|'), activatedOfferIds: [...(user.activatedOfferIds || [])].sort().join('|') }, provenance: 'synthetic' };
  if (persist) state.quotes.push(quote);
  return quote;
}

export function validateQuote(state, userId, quoteId, cartFingerprint) {
  const quote = state.quotes.find(q => q.id === quoteId && q.userId === userId);
  if (!quote) return { valid: false, reasons: ['Quote not found.'] };
  const user = ownedUser(state, userId), reasons = [];
  if (Date.parse(quote.expiresAt) <= Date.parse(now(state))) reasons.push('Quote expired.');
  if (quote.provisional) reasons.push('Tax or shipping is unknown.');
  const product = state.products.find(p => p.id === quote.cart.productId);
  if (quote.cart.productId && (!product || product.version !== quote.sourceVersions.productVersion || product.priceCents !== quote.sourceVersions.productPriceCents)) reasons.push('Product price or version changed.');
  if (state.offers.map(o => `${o.id}:${o.version}:${o.termsVersion}:${o.active}:${o.expiresAt}`).join('|') !== quote.sourceVersions.offers) reasons.push('Offer terms changed.');
  if ([...(user.activatedOfferIds || [])].sort().join('|') !== quote.sourceVersions.activatedOfferIds) reasons.push('Activation changed; create a fresh quote.');
  if (cartFingerprint && cartFingerprint !== quote.cartFingerprint) reasons.push('Cart changed.');
  if (!quote.plans.some(p => state.cards.some(c => c.id === p.cardId && c.userId === userId))) reasons.push('No matching card remains.');
  if (!reasons.length) {
    try {
      const fresh = createQuote(state, userId, { ...quote.cart }, { persist: false });
      const signature = plans => plans.map(p => [p.cardId, p.checkoutCents, p.statementCreditCents, p.rewardCents, p.effectiveCostCents, p.conditionalStatementCreditCents, p.conditionalEffectiveCostCents, p.offerId, p.conditionalOfferId, p.ready, p.checkoutEligible]);
      if (JSON.stringify(signature(fresh.plans)) !== JSON.stringify(signature(quote.plans))) reasons.push('Card eligibility, offer usage or calculated benefits changed. Create a fresh quote.');
    } catch (error) { reasons.push(error.message); }
  }
  return { valid: !reasons.length, reasons, quote };
}

export function validateMissionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Mission input must be an object.');
  for (const [key, limit] of Object.entries({ request: 1000, query: 1000, category: 100, productType: 100, color: 100, size: 100, deliveryDeadline: 50, status: 30, priceLimitBasis: 30, currency: 3 })) {
    const value = input[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > limit)) throw new Error(`${key} must be a string of at most ${limit} characters or null.`);
  }
  for (const key of ['preferredMerchants', 'excludedMerchants']) if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 50 || input[key].some(value => typeof value !== 'string' || !value.trim() || value.length > 100))) throw new Error(`${key} must be an array of at most 50 bounded merchant strings.`);
  for (const key of ['alternativesAllowed', 'notifications']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`${key} must be a boolean.`);
  if (input.deliveryDeadline && (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(input.deliveryDeadline) || !Number.isFinite(Date.parse(input.deliveryDeadline)))) throw new Error('Delivery deadline must be a valid ISO date.');
  if (input.currency !== undefined && input.currency !== null && input.currency !== 'USD') throw new Error('Only USD missions are supported.');
  if (input.maxAmountCents !== undefined) money(input.maxAmountCents, 'Maximum amount', true);
  return input;
}

export function createMission(state, userId, input = {}) {
  ownedUser(state, userId);
  validateMissionInput(input);
  const request = (input.request || input.query || '').trim();
  const budget = request.match(/(?:under|below|up to|max(?:imum)?)\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
  const category = input.category || (/headphone|laptop|computer/i.test(request) ? 'electronics' : /jacket|shoe|legging|running|shirt/i.test(request) ? 'apparel' : /hiking|backpack|camp/i.test(request) ? 'outdoors' : null);
  const maxAmountCents = input.maxAmountCents ?? (budget ? Math.round(Number(budget[1].replaceAll(',', '')) * 100) : null);
  money(maxAmountCents, 'Maximum amount', true);
  const priceLimitBasis = input.priceLimitBasis || 'checkout_charge';
  if (!['checkout_charge', 'effective_cost'].includes(priceLimitBasis)) throw new Error('Unknown price limit basis.');
  const color = input.color !== undefined ? input.color : request.match(/\b(black|white|sand|blue|green|red|pink|purple|orange|yellow|brown|gray|grey|navy)\b/i)?.[1]?.toLowerCase() || null;
  const size = input.size !== undefined ? input.size : request.match(/\bsize\s+([a-z0-9.]+)\b/i)?.[1]?.toUpperCase() || null;
  const productType = input.productType !== undefined ? input.productType : request.match(/\b(jacket|legging|shoe|headphone|tee|shirt|daypack|backpack|luggage|carry-on)s?\b/i)?.[1]?.toLowerCase() || null;
  const status = input.status || 'active';
  if (!['active', 'paused', 'completed', 'cancelled'].includes(status)) throw new Error('Unknown mission status.');
  const mission = { id: id('mission'), userId, request, category, productType, maxAmountCents, priceLimitBasis, currency: 'USD', preferredMerchants: input.preferredMerchants || [], excludedMerchants: input.excludedMerchants || [], color, size, deliveryDeadline: input.deliveryDeadline || null, alternativesAllowed: input.alternativesAllowed !== false, status, notifications: input.notifications !== false, createdAt: now(state), interpretation: 'Deterministic structured extraction · editable', provenance: 'synthetic' };
  state.missions.push(mission); return mission;
}

export function missionMatches(state, userId, missionOrId, { persistQuotes = true } = {}) {
  ownedUser(state, userId);
  const mission = typeof missionOrId === 'string' ? state.missions.find(m => m.id === missionOrId && m.userId === userId) : missionOrId;
  if (!mission || mission.userId !== userId) throw new Error('Mission not found.');
  if (mission.status !== 'active') return { matches: [], reasons: ['Mission is not active.'] };
  const matches = [], rejected = [];
  for (const product of state.products) {
    if (mission.category && product.category !== mission.category || mission.excludedMerchants?.includes(product.merchantId) || mission.preferredMerchants?.length && !mission.preferredMerchants.includes(product.merchantId)) continue;
    let reason = null;
    const productTerm = new Map([['backpack', 'daypack'], ['shirt', 'tee'], ['luggage', 'carry-on']]).get(mission.productType) || mission.productType;
    if (productTerm && !product.name.toLowerCase().includes(productTerm.toLowerCase())) reason = 'Does not match the requested product type.';
    if (mission.color && product.attributes?.color !== mission.color) reason = 'Requested color is unavailable or unknown.';
    if (mission.size && !product.attributes?.sizes?.includes(mission.size)) reason = 'Requested size is unavailable or unknown.';
    if (mission.deliveryDeadline && (!product.deliveryDate || product.deliveryDate > mission.deliveryDeadline)) reason = 'Delivery deadline cannot be verified.';
    const quote = createQuote(state, userId, { productId: product.id }, { persist: false });
    const plan = quote.plans.find(p => p.cardId === quote.bestAvailableNowCardId);
    const amount = mission.priceLimitBasis === 'effective_cost' ? plan?.effectiveCostCents : quote.cart.checkoutCents;
    if (amount === null || amount === undefined) reason = 'Complete tax, shipping or card information is missing.';
    if (mission.maxAmountCents !== null && amount > mission.maxAmountCents) reason = 'Exceeds the selected price ceiling.';
    if (reason) rejected.push({ productId: product.id, reason });
    else { if (persistQuotes) state.quotes.push(quote); matches.push({ productId: product.id, product, quoteId: quote.id, quote, amountCents: amount, priceLimitBasis: mission.priceLimitBasis, uncertainty: mission.size ? [] : ['Size-specific stock has not been requested.'] }); }
  }
  matches.sort((a, b) => a.amountCents - b.amountCents);
  return { matches, rejected, reasons: matches.length ? [] : [...new Set(rejected.map(r => r.reason))].concat(rejected.length ? [] : ['No catalog products match the requested category or merchants.']) };
}

export function applyPurchaseEvent(state, userId, purchaseId, type, eventId) {
  ownedUser(state, userId);
  const purchase = state.purchases.find(p => p.id === purchaseId && p.userId === userId);
  if (!purchase) throw new Error('Purchase not found.');
  if (!eventId || typeof eventId !== 'string' || eventId.length > 200) throw new Error('A stable event ID is required.');
  type = ({ settlement: 'settled', qualification: 'qualified', credit: 'credit_posted', reward: 'reward_posted', refund: 'refunded', returned: 'refunded' })[type] || type;
  if (!['settled', 'qualified', 'credit_posted', 'reward_posted', 'refunded'].includes(type)) throw new Error('Unsupported purchase event.');
  if (state.events.some(e => e.userId === userId && e.externalEventId === eventId)) return { purchase, duplicate: true, summary: savingsSummary(state, userId) };
  const quote = state.quotes.find(q => q.id === purchase.quoteId && q.userId === userId);
  const plan = purchase.plan || quote?.plans.find(p => p.cardId === purchase.cardId);
  if (!plan || !quote) throw new Error('Purchase quote evidence is unavailable.');
  purchase.benefitStatus ||= { merchant: 'expected', credit: plan.statementCreditCents ? 'expected' : 'not_applicable', reward: 'expected' };
  if (purchase.status !== 'refunded' && ['qualified', 'credit_posted', 'reward_posted'].includes(type) && !purchase.settledAt) throw new Error('Purchase must settle before benefit events.');
  if (purchase.status !== 'refunded' && type === 'credit_posted' && !['qualified', 'posted'].includes(purchase.benefitStatus.credit)) throw new Error('Card offer must qualify before posting.');
  const add = (kind, amountCents, evidenceRef) => {
    const benefitId = `${purchaseId}:${kind}`;
    if (!amountCents || state.ledger.some(entry => entry.benefitId === benefitId && !entry.reversalOf)) return;
    state.ledger.push({ id: id('ledger'), userId, purchaseId, benefitId, kind, amountCents, currency: 'USD', recognizedAt: now(state), externalDeduplicationKey: `${userId}:${eventId}:${kind}`, eventId, evidenceRef, provenance: 'synthetic' });
  };
  if (purchase.status !== 'refunded') {
    if (type === 'settled') { purchase.status = 'settled'; purchase.settledAt ||= now(state); purchase.benefitStatus.merchant = 'posted'; if (plan.statementCreditCents && purchase.benefitStatus.credit === 'expected') purchase.benefitStatus.credit = 'transaction_matched'; if (purchase.benefitStatus.reward === 'expected') purchase.benefitStatus.reward = 'transaction_matched'; add('merchant_discount', quote.cart.merchantDiscountCents, quote.cart.referenceEvidence); }
    if (type === 'qualified' && plan.statementCreditCents && purchase.benefitStatus.credit !== 'posted') purchase.benefitStatus.credit = 'qualified';
    if (type === 'credit_posted') { add('card_offer', plan.statementCreditCents, plan.offerId); purchase.benefitStatus.credit = 'posted'; }
    if (type === 'reward_posted') { add('cash_reward', plan.rewardCents, purchase.cardId); purchase.benefitStatus.reward = 'posted'; }
    if (type === 'refunded') {
      purchase.status = 'refunded'; purchase.refundedAt = now(state); purchase.benefitStatus = { merchant: 'reversed', credit: 'reversed', reward: 'reversed' };
      for (const entry of state.ledger.filter(e => e.purchaseId === purchaseId && e.amountCents > 0)) {
        if (!state.ledger.some(e => e.reversalOf === entry.id)) state.ledger.push({ ...entry, id: id('ledger'), amountCents: -entry.amountCents, recognizedAt: now(state), eventId, externalDeduplicationKey: `${userId}:${eventId}:${entry.kind}`, reversalOf: entry.id });
      }
      purchase.pendingClawbacks = 'Provider clawback evidence remains separate from confirmed savings reversal.';
    }
  }
  state.events.push({ id: id('event'), userId, purchaseId, type, externalEventId: eventId, createdAt: now(state), provenance: 'synthetic' });
  purchase.timeline ||= []; purchase.timeline.push({ type, eventId, createdAt: now(state) });
  return { purchase, duplicate: false, summary: savingsSummary(state, userId) };
}

export function savingsSummary(state, userId) {
  const user = ownedUser(state, userId), formatter = new Intl.DateTimeFormat('en-US', { timeZone: user.timezone || 'America/New_York', year: 'numeric' });
  const year = formatter.format(new Date(now(state)));
  const entries = state.ledger.filter(e => e.userId === userId && e.currency === 'USD' && formatter.format(new Date(e.recognizedAt)) === year);
  const sum = kind => entries.filter(e => !kind || e.kind === kind).reduce((total, e) => total + e.amountCents, 0);
  let pendingCents = 0;
  for (const p of state.purchases.filter(p => p.userId === userId && p.settledAt && p.status !== 'refunded')) {
    const plan = p.plan || state.quotes.find(q => q.id === p.quoteId)?.plans.find(plan => plan.cardId === p.cardId);
    if (plan) { if (p.benefitStatus?.credit !== 'posted') pendingCents += plan.statementCreditCents || 0; if (p.benefitStatus?.reward !== 'posted') pendingCents += plan.rewardCents || 0; }
  }
  return { totalCents: sum(), merchantDiscountCents: sum('merchant_discount'), cardOfferCents: sum('card_offer'), cashRewardCents: sum('cash_reward'), pendingCents, entries, year: Number(year), currency: 'USD', definition: 'Observed checkout discounts + posted statement credits + posted cash rewards, net of adjustments. Pending benefits excluded.', provenance: 'synthetic' };
}

export function financeSummary(state, userId) {
  ownedUser(state, userId);
  const accounts = state.accounts.filter(a => a.userId === userId);
  const assetCents = accounts.filter(a => a.type === 'asset').reduce((sum, a) => sum + a.balanceCents, 0);
  const liabilityCents = accounts.filter(a => a.type === 'liability').reduce((sum, a) => sum + Math.abs(a.balanceCents), 0);
  return { assetCents, liabilityCents, netWorthCents: assetCents - liabilityCents, accounts, currency: 'USD', label: 'Net worth across connected accounts', lastSyncedAt: now(state), provenance: 'synthetic' };
}
