import { createHash } from 'node:crypto';
import { getRewardRule } from './card-catalog.js';
import { roundBps } from './domain.js';

const identityFields = ['merchantId','providerAccountId','sku','variantId','quantity','destinationHash','shippingOptionId','currency'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const identityValid = cart => cart && identityFields.every(field => field === 'quantity' ? Number.isInteger(cart[field]) && cart[field] >= 1 && cart[field] <= 10 : text(cart[field]));
const decision = code => ({allowed:code === null,code});

export function canonicalPurchaseHash(cart) {
  if (!identityValid(cart)) throw Object.assign(new Error('Invalid purchase identity.'),{code:'INVALID_PURCHASE'});
  return createHash('sha256').update(JSON.stringify(identityFields.map(field=>cart[field]))).digest('hex');
}

export function rankPaymentCards({cards,cart}) {
  if (!Array.isArray(cards) || !integer(cart?.totalCents)) throw Object.assign(new Error('Invalid purchase.'),{code:'INVALID_PURCHASE'});
  return cards.filter(card=>card.active !== false && text(card.cardId)).map(card=> {
    const rule = getRewardRule(card,{category:'other'});
    return {cardId:card.cardId,productId:card.productId,brand:card.brand ?? null,last4:card.last4 ?? null,
      estimatedRewardCents:roundBps(cart.totalCents,rule.baseRewardBps),rateBps:rule.baseRewardBps,sourceUrl:rule.sourceUrl};
  }).sort((a,b)=>b.estimatedRewardCents-a.estimatedRewardCents || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
}

export function validatePermission({intent,cart,cardId,activeCards,now}) {
  const permission = intent?.permission ?? intent;
  if (!permission || !identityValid(cart) || !integer(permission.maxAmountCents) || permission.maxAmountCents > 50000 ||
      !Array.isArray(permission.eligibleCardIds) || permission.eligibleCardIds.length < 1 || permission.eligibleCardIds.length > 10 ||
      !permission.eligibleCardIds.every(text) || new Set(permission.eligibleCardIds).size !== permission.eligibleCardIds.length ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(permission.expiresAt) || !Array.isArray(activeCards)) return decision('INVALID_PURCHASE');
  if (permission.quantity !== undefined && (!Number.isInteger(permission.quantity) || permission.quantity < 1 || permission.quantity > 10)) return decision('INVALID_PURCHASE');
  if (now >= permission.expiresAt) return decision('PERMISSION_EXPIRED');
  if (permission.revokedAt != null || intent.revokedAt != null || ['blocked','agent_failed','expired','cancelled','payment_failed','confirmed'].includes(intent.state)) return decision('PERMISSION_REVOKED');
  let originalHash = permission.purchaseHash ?? intent.purchaseHash;
  if (!originalHash) {
    try { originalHash = canonicalPurchaseHash(permission.cart ?? permission); }
    catch { return decision('INVALID_PURCHASE'); }
  }
  if (canonicalPurchaseHash(cart) !== originalHash) return decision('PURCHASE_SCOPE_CHANGED');
  if (cart.currency !== 'USD' || !['merchandiseCents','taxCents','shippingCents','totalCents'].every(field=>integer(cart[field])) ||
      !Number.isSafeInteger(cart.merchandiseCents+cart.taxCents+cart.shippingCents) || cart.totalCents !== cart.merchandiseCents+cart.taxCents+cart.shippingCents) return decision('INVALID_PURCHASE');
  if (cart.totalCents > permission.maxAmountCents) return decision('AMOUNT_LIMIT_EXCEEDED');
  const eligible = activeCards.filter(card=>card.active === true && card.revokedAt == null && card.subjectKey === permission.subjectKey &&
    card.providerAccountId === permission.providerAccountId && permission.eligibleCardIds.includes(card.cardId));
  if (!eligible.length) return decision(activeCards.length ? 'CARD_NOT_ALLOWED' : 'NO_ELIGIBLE_CARD');
  const winner = rankPaymentCards({cards:eligible,cart})[0];
  if (!winner || winner.cardId !== cardId) return decision('CARD_NOT_ALLOWED');
  return decision(null);
}
