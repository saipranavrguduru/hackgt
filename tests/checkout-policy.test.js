import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPurchaseHash, validatePermission, rankPaymentCards } from '../src/checkout-policy.js';

const cart = (overrides = {}) => ({ merchantId:'perkpilot-test-store', providerAccountId:'acct_test', sku:'everyday-headphones', variantId:'black', quantity:1, destinationHash:'destination-hash', shippingOptionId:'standard', currency:'USD', category:'other', merchandiseCents:9000, taxCents:900, shippingCents:500, totalCents:10400, revision:1, ...overrides });
const cards = () => [
  {cardId:'a',productId:'active-cash',subjectKey:'portal:alice',providerAccountId:'acct_test',active:true,brand:'visa',last4:'4242',paymentMethodId:'pm_secret'},
  {cardId:'b',productId:'quicksilver',subjectKey:'portal:alice',providerAccountId:'acct_test',active:true,brand:'mastercard',last4:'4444'},
];
function fixture({intent: intentOverrides = {}, cart: cartOverrides = {}, activeCards = cards(), cardId = 'a', now = 1000} = {}) {
  const original = cart();
  return {intent:{...original,subjectKey:'portal:alice',purchaseHash:canonicalPurchaseHash(original),eligibleCardIds:['a','b'],maxAmountCents:11000,expiresAt:301000,createdAt:1000,state:'running',termsVersion:1,...intentOverrides},cart:cart(cartOverrides),activeCards,cardId,now};
}

test('104-dollar ranking uses published base rules and exposes no provider references', () => {
  const ranked = rankPaymentCards({cards:cards().map(c=>({...c,rateBps:9999})),cart:cart()});
  assert.deepEqual(ranked.map(c=>c.estimatedRewardCents),[208,156]);
  assert.deepEqual(ranked.map(c=>c.rateBps),[200,150]);
  assert.equal(Object.hasOwn(ranked[0],'paymentMethodId'),false);
});
test('equal rewards use ascending card ID regardless of input order', () => {
  assert.deepEqual(rankPaymentCards({cards:[{...cards()[0],cardId:'z'},cards()[0]],cart:cart()}).map(c=>c.cardId),['a','z']);
});
test('permission permits a complete lower price and rejects a total over the cap', () => {
  assert.equal(validatePermission(fixture({cart:{merchandiseCents:12300,taxCents:1200,totalCents:14000}})).code,'AMOUNT_LIMIT_EXCEEDED');
  assert.equal(validatePermission(fixture({cart:{merchandiseCents:9500,totalCents:10900}})).allowed,true);
});
for (const [field,value] of [['sku','replacement'],['variantId','white'],['destinationHash','elsewhere'],['currency','EUR'],['providerAccountId','acct_else'],['merchantId','else'],['shippingOptionId','express'],['quantity',2]]) {
  test(`permission rejects changed ${field} even within the cap`, () => assert.equal(validatePermission(fixture({cart:{[field]:value}})).code,'PURCHASE_SCOPE_CHANGED'));
}
test('canonical identity excludes all prices and revision', () => {
  assert.equal(canonicalPurchaseHash(cart()),canonicalPurchaseHash(cart({merchandiseCents:1,taxCents:2,shippingCents:3,totalCents:6,revision:9})));
});
test('permission expires at the exact UTC boundary and rejects revoked states', () => {
  assert.equal(validatePermission(fixture({now:301000})).code,'PERMISSION_EXPIRED');
  assert.equal(validatePermission(fixture({intent:{state:'cancelled'}})).allowed,false);
});
test('revocation at epoch zero still blocks permission',()=>assert.equal(validatePermission(fixture({intent:{revokedAt:0}})).allowed,false));
for (const [name,activeCards,cardId] of [
  ['revoked',cards().map(c=>({...c,active:false})),'a'],
  ['foreign subject',cards().map(c=>({...c,subjectKey:'portal:bob'})),'a'],
  ['foreign account',cards().map(c=>({...c,providerAccountId:'acct_else'})),'a'],
  ['newly added',[...cards(),{...cards()[0],cardId:'c'}],'c'],
  ['nonwinning',cards(),'b'],
]) test(`permission rejects ${name} card`,()=>assert.equal(validatePermission(fixture({activeCards,cardId})).code,'CARD_NOT_ALLOWED'));
test('original card set must be nonempty, unique and bounded', () => {
  for (const eligibleCardIds of [[],['a','a'],Array.from({length:11},(_,i)=>`card-${i}`)]) assert.equal(validatePermission(fixture({intent:{eligibleCardIds}})).code,'INVALID_PURCHASE');
});
for (const value of [-1,1.1,Number.MAX_SAFE_INTEGER+1,NaN]) test(`reject invalid money ${value}`,()=>assert.equal(validatePermission(fixture({cart:{totalCents:value}})).code,'INVALID_PURCHASE'));
test('reject invalid quantity, cap, identity, and incomplete total', () => {
  for (const quantity of [0,11,1.5]) assert.equal(validatePermission(fixture({intent:{quantity},cart:{quantity}})).code,'INVALID_PURCHASE');
  for (const maxAmountCents of [-1,1.1,50001,Number.MAX_SAFE_INTEGER+1]) assert.equal(validatePermission(fixture({intent:{maxAmountCents}})).code,'INVALID_PURCHASE');
  assert.equal(validatePermission(fixture({cart:{sku:''}})).code,'INVALID_PURCHASE');
  assert.equal(validatePermission(fixture({cart:{totalCents:1}})).code,'INVALID_PURCHASE');
});
test('no remaining eligible card has an explicit refusal',()=>assert.equal(validatePermission(fixture({activeCards:[]})).code,'NO_ELIGIBLE_CARD'));
