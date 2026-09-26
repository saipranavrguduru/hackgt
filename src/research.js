import { randomUUID } from 'node:crypto';

const uid = prefix => `${prefix}-${randomUUID()}`;
const userFor = (state, userId) => { const user = state.users.find(u => u.id === userId); if (!user) throw new Error('User not found.'); return user; };
const clean = value => String(value || '').trim().slice(0, 1000);
const normal = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const timestamp = state => state.clock;
const amount = value => { if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Price must be non-negative integer cents.'); return value; };

export function interpretResearchInput(input = {}) {
  if (typeof input === 'string') input = { query: input };
  const query = clean(input.query || input.request);
  const explicit = input.requirements || {};
  const budget = query.match(/(?:under|below|up to|max(?:imum)?)\s*\$?([\d,]+(?:\.\d{1,2})?)/i);
  const category = explicit.category || input.category || (/headphone|noise.?cancel|earphone|long flights/i.test(query) ? 'headphones' : /jacket|legging|shoe|apparel|running/i.test(query) ? 'apparel' : null);
  const maxAmountCents = amount(explicit.maxAmountCents ?? input.maxAmountCents ?? (budget ? Math.round(Number(budget[1].replaceAll(',', '')) * 100) : null));
  const textList = value => { if (!Array.isArray(value) || value.length > 30 || value.some(x => typeof x !== 'string' || x.length > 200)) throw new Error('Requirements must be bounded text lists.'); return [...new Set(value)]; };
  const requirements = { category, maxAmountCents, priceLimitBasis: explicit.priceLimitBasis || input.priceLimitBasis || 'merchandise', mustHave: textList(explicit.mustHave || input.mustHave || (/noise.?cancel/i.test(query) ? ['noise cancellation'] : [])), niceToHave: textList(explicit.niceToHave || input.niceToHave || []), excludedBrands: textList(explicit.excludedBrands || input.excludedBrands || []), compatibility: textList(explicit.compatibility || input.compatibility || []), useCase: clean(explicit.useCase || input.useCase || (/flight|travel/i.test(query) ? 'long flights' : '')), alternativesAllowed: explicit.alternativesAllowed !== false, useSpendDNA: explicit.useSpendDNA !== false };
  if (!['checkout_charge', 'effective_cost', 'merchandise'].includes(requirements.priceLimitBasis)) throw new Error('Unknown research price basis.');
  return { query, requirements, mode: /\bvs\b|compare|versus/i.test(query) ? 'comparison' : budget ? 'constraint_search' : /best|which|should/i.test(query) ? 'research_question' : 'category_search' };
}

function candidate(state, product, requirements) {
  const listings = state.researchListings.filter(l => l.productId === product.id && l.availability !== 'out_of_stock').sort((a, b) => a.priceCents - b.priceCents);
  const knownCents = value => Number.isSafeInteger(value) && value >= 0;
  const checkoutTotal = listing => [listing.priceCents, listing.shippingCents, listing.taxCents].every(knownCents) && knownCents(listing.priceCents + listing.shippingCents + listing.taxCents) ? listing.priceCents + listing.shippingCents + listing.taxCents : null;
  const purchaseOptions = listings.length ? listings : product.availability === 'in_stock' ? [product] : [];
  const basis = requirements.priceLimitBasis;
  const knownCheckout = purchaseOptions.filter(listing => checkoutTotal(listing) !== null).sort((a, b) => checkoutTotal(a) - checkoutTotal(b));
  const selectedListing = basis === 'checkout_charge' ? knownCheckout[0] || purchaseOptions[0] : purchaseOptions[0];
  const priceCents = selectedListing?.priceCents ?? product.priceCents ?? null;
  const checkoutCents = knownCheckout[0] ? checkoutTotal(knownCheckout[0]) : null;
  // Fictional research listings do not have shared-engine quotes, so their effective cost is unknown.
  const budgetAmountCents = basis === 'merchandise' ? knownCents(priceCents) ? priceCents : null : basis === 'checkout_charge' ? checkoutCents : null;
  const budgetLabel = { merchandise: 'Observed merchandise price', checkout_charge: 'Known checkout charge including tax and shipping', effective_cost: 'Effective cost requires a verified Deal Stack quote' }[basis];
  const matchReasons = [], unmetRequirements = [];
  let matchScore = 0;
  if (requirements.maxAmountCents !== null && requirements.maxAmountCents !== undefined) {
    if (budgetAmountCents === null) unmetRequirements.push(basis === 'effective_cost' ? 'Effective cost is unverified without a shared-engine quote; the budget cannot be confirmed.' : 'Tax or shipping is unknown; the checkout budget cannot be confirmed.');
    else if (budgetAmountCents > requirements.maxAmountCents) unmetRequirements.push(`${budgetLabel} exceeds the budget.`);
    else { matchScore += 20; matchReasons.push(basis === 'merchandise' ? 'Observed merchandise price is within your ceiling. Tax and shipping are excluded from this budget.' : 'Known checkout charge, including tax and shipping, is within your ceiling.'); }
  }
  for (const requirement of requirements.mustHave || []) {
    const text = normal(requirement);
    if (text.includes('anc') || text.includes('noise')) {
      const strongRequired = text.includes('strong') || text.includes('best');
      if (!product.anc || strongRequired && product.anc !== 'strong') unmetRequirements.push(`Does not meet: ${requirement}.`);
      else { matchScore += product.anc === 'strong' ? 30 : 10; matchReasons.push(`${product.anc} noise cancellation in the fictional review fixture.`); }
    } else {
      const known = [...(product.compatibility || []), product.description || '', ...(product.strengths || [])].some(value => normal(value).includes(text));
      if (!known) unmetRequirements.push(`Cannot verify: ${requirement}.`); else { matchScore += 15; matchReasons.push(`Source fixture supports ${requirement}.`); }
    }
  }
  for (const required of requirements.compatibility || []) if (!product.compatibility?.some(value => normal(value).includes(normal(required)))) unmetRequirements.push(`Compatibility unverified: ${required}.`);
  if (/flight|travel/.test(normal(requirements.useCase))) {
    matchScore += product.anc === 'strong' ? 20 : 0;
    if (product.weightGrams <= 260) { matchScore += 10; matchReasons.push('A lighter option for your stated flight use case.'); }
    if (product.batteryHours >= 30) { matchScore += 8; matchReasons.push('Stated battery life fits longer travel; real-world duration varies.'); }
  }
  if (!matchReasons.length) matchReasons.push('A canonical catalog match; examine the sourced tradeoffs before deciding.');
  return { ...product, listings, priceCents, checkoutCents, selectedListingId: selectedListing?.id || null, priceLimitBasis: basis, budgetAmountCents, budgetLabel, matchReasons, unmetRequirements, meetsRequirements: !unmetRequirements.length, budgetCertainty: budgetAmountCents === null ? 'unknown' : 'known', matchScore };
}

export function searchProducts(state, userId, input = {}) {
  userFor(state, userId);
  const { query, requirements } = interpretResearchInput(input);
  const q = normal(query);
  const products = [...state.researchProducts, ...state.products];
  const exact = products.filter(p => q && (normal(p.name) === q || normal(p.id) === q));
  let results = exact.length ? exact : products.filter(p => {
    if (requirements.category) return p.category === requirements.category;
    return q && q.split(' ').filter(w => w.length > 2).some(word => normal(`${p.name} ${p.brand || ''} ${p.description}`).includes(word));
  });
  results = results.filter(p => !requirements.excludedBrands.some(brand => normal(brand) === normal(p.brand)));
  const candidates = results.map(p => candidate(state, p, requirements)).filter(p => requirements.maxAmountCents === null || p.budgetAmountCents === null || p.budgetAmountCents <= requirements.maxAmountCents);
  candidates.sort((a, b) => Number(b.meetsRequirements) - Number(a.meetsRequirements) || b.matchScore - a.matchScore || (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity) || a.id.localeCompare(b.id));
  return candidates.slice(0, Math.max(1, Math.min(5, Number(input.limit) || 5))).map(({ matchScore, ...product }) => product);
}

export function createResearchSession(state, userId, input = {}) {
  const user = userFor(state, userId);
  const interpretation = interpretResearchInput(input);
  if (!interpretation.query && !interpretation.requirements.category) throw new Error('Describe a product or category to research.');
  const candidates = searchProducts(state, userId, { ...input, ...interpretation });
  const session = { id: uid('research'), userId, ...interpretation, candidates, candidateIds: candidates.map(p => p.id), status: 'complete', usedSpendDNA: false, personalizationNote: user.consent ? 'Explicit session requirements take priority. Transaction history does not establish product quality.' : 'Spend DNA is disabled. This research uses only your explicit request and controlled evidence.', createdAt: timestamp(state), updatedAt: timestamp(state), provenance: 'synthetic', sourceLabel: 'Fictional products and curated evidence · no live web search', unknowns: candidates.length ? ['Observed listing prices may exclude tax. Purchase availability is synthetic.'] : ['No controlled catalog products meet these requirements. Try headphones or an exact demo product name.'] };
  state.researchSessions.push(session); return session;
}

export function getResearchBrief(state, userId, productId, requirements = {}) {
  userFor(state, userId);
  const product = state.researchProducts.find(p => p.id === productId) || state.products.find(p => p.id === productId);
  if (!product) throw new Error('Product not found.');
  const normalized = interpretResearchInput({ requirements }).requirements;
  const record = candidate(state, product, normalized);
  let sources = state.researchSources.filter(source => source.productId === productId);
  let facts = state.researchFacts.filter(fact => fact.productId === productId);
  let findings = state.researchFindings.filter(finding => finding.productId === productId);
  let listings = record.listings;
  const unknowns = ['All products, listings and research evidence in this brief are fictional fixtures.', 'Price is observed merchandise only when tax or shipping is unknown.'];
  if (!sources.length) {
    sources = [{ id: `${productId}-catalog`, productId, sourceType: 'retailer', publisher: 'PerkPilot controlled merchant catalog', sourceRef: `fixture://catalog/${productId}`, retrievedAt: timestamp(state), provenance: 'synthetic' }];
    facts = [{ id: `${productId}-price`, productId, attribute: 'observedPrice', label: 'Observed merchandise price', value: product.priceCents, unit: 'USD cents', evidenceRefs: [sources[0].id], confidence: 'fixture_verified', freshness: product.observedAt, conflicts: [] }];
    findings = [{ id: `${productId}-catalog-finding`, productId, type: 'purchase_option', summary: 'A controlled product listing is available. A promotion alone does not establish product quality.', evidenceRefs: [sources[0].id] }];
    listings = [{ id: `${productId}-store`, productId, merchantId: product.merchantId, merchantName: product.merchantName, priceCents: product.priceCents, shippingCents: product.shippingCents, taxCents: product.taxCents, currency: product.currency, availability: product.availability, observedAt: product.observedAt, sourceRef: sources[0].sourceRef, provenance: 'synthetic' }];
    unknowns.push('Independent testing, fit, durability and owner review evidence have not been supplied.');
  }
  if (facts.some(f => f.conflicts?.length)) unknowns.push('Battery-life sources disagree; measured and manufacturer-stated conditions are shown separately.');
  return { product: { ...product, priceCents: record.priceCents }, requirements: normalized, priceLimitBasis: record.priceLimitBasis, budgetAmountCents: record.budgetAmountCents, budgetCertainty: record.budgetCertainty, budgetLabel: record.budgetLabel, meetsRequirements: record.meetsRequirements, selectedListingId: record.selectedListingId, findings, strengths: findings.filter(f => f.type === 'strength'), tradeoffs: findings.filter(f => f.type === 'tradeoff'), compatibility: findings.filter(f => f.type === 'compatibility'), facts, sources, listings, purchaseOptions: listings, unknowns, matchReasons: record.matchReasons, unmetRequirements: record.unmetRequirements, observedAt: timestamp(state), provenance: 'synthetic', sourceLabel: 'Curated fictional research; no real-world product claim' };
}

export function compareProducts(state, userId, input = {}) {
  userFor(state, userId);
  if (!Array.isArray(input.productIds) || input.productIds.length < 2 || input.productIds.length > 3 || new Set(input.productIds).size !== input.productIds.length) throw new Error('Compare two or three distinct products.');
  const session = input.sessionId ? state.researchSessions.find(s => s.id === input.sessionId && s.userId === userId) : null;
  if (input.sessionId && !session) throw new Error('Research session not found.');
  const requirements = interpretResearchInput({ requirements: input.requirements || session?.requirements || {} }).requirements;
  const products = input.productIds.map(productId => {
    const product = state.researchProducts.find(p => p.id === productId) || state.products.find(p => p.id === productId);
    if (!product) throw new Error('Product not found.');
    return candidate(state, product, requirements);
  });
  const ordered = [...products].sort((a, b) => Number(b.meetsRequirements) - Number(a.meetsRequirements) || b.matchScore - a.matchScore || a.priceCents - b.priceCents);
  const recommended = ordered.find(p => p.meetsRequirements);
  const dimensions = [['priceCents', 'Observed merchandise price'], ['batteryHours', 'Stated battery life'], ['weightGrams', 'Weight'], ['anc', 'Noise cancellation']].map(([key, label]) => ({ key, label, values: products.map(p => ({ productId: p.id, value: p[key] ?? null, evidenceRefs: key === 'priceCents' ? p.listings.map(l => l.sourceRef) : state.researchFacts.filter(f => f.productId === p.id && f.attribute === key).flatMap(f => f.evidenceRefs) })) }));
  const comparison = { id: uid('comparison'), userId, sessionId: session?.id || null, requirements, products: products.map(({ matchScore, ...p }) => p), dimensions, recommendedProductId: recommended?.id || null, summary: recommended ? `${recommended.name} is the strongest match to the stated requirements in this fictional comparison. ${recommended.matchReasons.join(' ')}` : 'Neither product satisfies all stated hard requirements. Keep watching or revise the constraints.', findings: products.flatMap(p => state.researchFindings.filter(f => f.productId === p.id)), sources: state.researchSources.filter(s => input.productIds.includes(s.productId)), unknowns: ['Tax and shipping may affect a strict checkout ceiling.', 'No universal quality score is claimed; the comparison depends on your requirements.'], createdAt: timestamp(state), provenance: 'synthetic' };
  state.comparisons.push(comparison); return comparison;
}

export function watchProduct(state, userId, input = {}) {
  userFor(state, userId);
  const brief = getResearchBrief(state, userId, input.productId);
  const targetPriceCents = amount(input.targetPriceCents ?? brief.product.priceCents);
  const existing = state.watches.find(w => w.userId === userId && w.productId === input.productId);
  if (existing) { existing.targetPriceCents = targetPriceCents; existing.status = 'active'; return existing; }
  const lowest = [...brief.listings].sort((a, b) => a.priceCents - b.priceCents)[0];
  const watch = { id: uid('watch'), userId, productId: input.productId, productName: brief.product.name, targetPriceCents, priceCents: lowest?.priceCents ?? null, listingId: lowest?.id || null, status: 'active', notifications: true, conditions: ['price_drop', 'target_reached'], createdAt: timestamp(state), updatedAt: timestamp(state), provenance: 'synthetic' };
  state.watches.push(watch); return watch;
}

export function applyListingEvent(state, userId, input = {}) {
  const user = userFor(state, userId);
  const listing = state.researchListings.find(l => l.id === input.listingId);
  if (!listing) throw new Error('Listing not found.');
  if (input.priceCents === null) throw new Error('A known listing price is required.');
  amount(input.priceCents);
  if (!input.eventId || typeof input.eventId !== 'string' || input.eventId.length > 200) throw new Error('A stable event ID is required.');
  if (state.events.some(e => e.userId === userId && e.externalEventId === input.eventId)) return { listing, notifications: [], duplicate: true };
  const previousPriceCents = listing.priceCents;
  listing.priceCents = input.priceCents; listing.version++; listing.observedAt = timestamp(state);
  const notifications = [];
  const preferences = user.preferences || {};
  const allowed = preferences.notifications?.watching !== false && preferences.notificationsEnabled !== false && !preferences.mutedMerchants?.includes(listing.merchantId);
  for (const watch of state.watches.filter(w => w.userId === userId && w.productId === listing.productId && w.status === 'active')) {
    const product = state.researchProducts.find(p => p.id === watch.productId);
    watch.priceCents = listing.priceCents; watch.updatedAt = timestamp(state);
    if (!allowed || preferences.mutedCategories?.includes(product?.category) || !watch.notifications || listing.priceCents >= previousPriceCents || watch.targetPriceCents !== null && listing.priceCents > watch.targetPriceCents) continue;
    const dedupeKey = `watch:${userId}:${watch.id}:${input.eventId}`;
    if (state.notifications.some(n => n.dedupeKey === dedupeKey)) continue;
    const rules = { quietStart: 21, quietEnd: 8, dailyLimit: 3, ...preferences.notifications };
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: user.timezone || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(timestamp(state))));
    const quiet = hour >= rules.quietStart || hour < rules.quietEnd;
    const daily = state.notifications.filter(n => n.userId === userId && n.delivery === 'toast' && n.createdAt.slice(0, 10) === timestamp(state).slice(0, 10)).length;
    const notification = { id: uid('notification'), userId, type: 'watch', label: 'Watching', productId: watch.productId, watchId: watch.id, merchantId: listing.merchantId, title: `${watch.productName} reached your watch price`, message: 'The controlled listing price fell to your target. Tax may still be unknown; this is not purchase permission.', priceCents: listing.priceCents, previousPriceCents, dedupeKey, delivery: quiet || daily >= rules.dailyLimit ? 'inbox' : 'toast', channel: 'in_app', read: false, dismissed: false, createdAt: timestamp(state), provenance: 'synthetic' };
    state.notifications.push(notification); notifications.push(notification);
  }
  state.events.push({ id: uid('event'), userId, type: 'listing_price', externalEventId: input.eventId, listingId: listing.id, previousPriceCents, priceCents: listing.priceCents, createdAt: timestamp(state), provenance: 'synthetic' });
  return { listing, notifications, duplicate: false };
}
