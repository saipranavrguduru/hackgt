import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_PRODUCTS, getCardProduct, getRewardRule } from '../src/card-catalog.js';
import { createFixtures } from '../src/fixtures.js';
import { recommendLocationCards } from '../src/domain.js';

test('expanded catalog exposes sourced rewards and fees for the wallet picker', () => {
  assert.ok(CARD_PRODUCTS.length >= 20);
  assert.equal(new Set(CARD_PRODUCTS.map(p=>p.id)).size,CARD_PRODUCTS.length);
  assert.ok(new Set(CARD_PRODUCTS.map(p=>p.issuer)).size >= 9);
  for(const product of CARD_PRODUCTS){
    assert.ok(product.name && product.shortName && product.issuer && product.network,product.id);
    assert.ok(Number.isSafeInteger(product.annualFeeCents) && product.annualFeeCents>=0,product.id);
    assert.ok(product.rewardSummary && product.rewardHighlights.length && product.limitations,product.id);
    assert.equal(new URL(product.sourceUrl).protocol,'https:');
    assert.ok(Number.isFinite(Date.parse(product.checkedAt)),product.id);
  }
});

test('new uncapped dining and grocery rates affect owned-card recommendations', () => {
  const state=createFixtures();
  state.cards.push({id:'alex-savor',userId:'alex',productId:'savor',rewardBps:9999});
  state.cards.push({id:'alex-blue-cash-preferred',userId:'alex',productId:'blue-cash-preferred'});
  for(const [category,cardId] of [['dining','alex-savor'],['groceries','alex-savor']]){
    const result=recommendLocationCards(state,'alex',{category,amountCents:5000});
    assert.equal(result.bestCardId,cardId);
    assert.equal(result.cards[0].rewardCents,150);
  }
  assert.equal(recommendLocationCards(state,'alex',{category:'other'}).bestCardId,'alex-active-cash');
  assert.equal(recommendLocationCards(state,'alex',{category:'gas',placeName:'Toronto gas station'}).bestCardId,'alex-active-cash','A generic gas category does not establish U.S. eligibility');
  assert.equal(recommendLocationCards(state,'taylor',{category:'gas'}).cards.length,1,'New catalog entries never invent wallet ownership');
});

test('eligibility-dependent bonuses are not assumed from a generic category', () => {
  for(const [productId,category] of [
    ['blue-cash-everyday','groceries'],['blue-cash-preferred','groceries'],['blue-cash-preferred','gas'],
    ['citi-custom-cash','dining'],['costco-anywhere','gas'],
    ['bofa-customized-cash','gas'],['bofa-customized-cash','groceries'],
    ['freedom-flex','gas'],['us-bank-cash-plus','dining'],['attune','other'],['apple-card','other']
  ]){
    assert.equal(getRewardRule({productId,rewardBps:9999},{category,activated:true,remainingCapCents:100000}).rewardBps,100,`${productId} ${category}`);
  }
  assert.equal(getRewardRule({productId:'paypal-cashback'},{category:'other',viaPayPal:true}).rewardBps,150);
  assert.equal(getRewardRule({productId:'us-bank-smartly'},{category:'other',bankBalanceCents:10000000}).rewardBps,200);
  assert.equal(getRewardRule({productId:'freedom-flex'},{category:'drugstores'}).rewardBps,300);
  assert.equal(getRewardRule({productId:'costco-anywhere'},{category:'dining'}).rewardBps,300);
});

test('Double Cash displays its full published benefit without crediting an unobserved bill payment', () => {
  const product=getCardProduct('citi-double-cash');
  assert.ok(product);
  assert.match(product.rewardSummary,/2%/);
  assert.match(product.comparisonNote,/payment/i);
  assert.equal(getRewardRule({productId:product.id},{category:'other'}).rewardBps,100);
});
