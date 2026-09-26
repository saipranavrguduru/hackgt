import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtures } from '../src/fixtures.js';
import * as catalog from '../src/card-catalog.js';
import * as domain from '../src/domain.js';

test('shared reward rules use supported merchant categories and ignore arbitrary card rates', () => {
  assert.equal(typeof catalog.getRewardRule, 'function');
  const card = { productId:'freedom-unlimited', rewardBps:9999 };
  for (const [category,expected] of [['dining',300],['drugstores',300],['groceries',150],['gas',150],['other',150],[null,150],['toString',150]]) {
    const rule = catalog.getRewardRule(card, {category});
    assert.equal(rule.rewardBps, expected);
    assert.equal(rule.baseRewardBps,150);
  }
  assert.equal(catalog.getRewardRule({productId:'discover-it'},{category:'gas'}).rewardBps,100);
  assert.equal(catalog.getRewardRule({productId:'unknown',rewardBps:9999}).rewardBps,0);
});

test('location ranking uses only owned cards and omits dollar estimates without an amount', () => {
  assert.equal(typeof domain.recommendLocationCards, 'function');
  const state = createFixtures();
  const before=JSON.stringify(state);
  const result=domain.recommendLocationCards(state,'alex',{category:'dining',placeName:' A cafe '});
  assert.equal(result.bestCardId,'alex-active-cash');
  assert.equal(result.placeName,'A cafe');
  assert.equal(result.cards.length,3);
  assert.equal(result.amountCents,null);
  assert.ok(result.cards.every(card=>card.rewardCents===null && card.baseRewardCents===null));
  assert.ok(result.cards.every(card=>card.ownership==='synthetic'));
  assert.equal(JSON.stringify(state),before,'Location recommendations must not persist a visit or quote');
  const taylor=domain.recommendLocationCards(state,'taylor',{category:'dining',amountCents:5000});
  assert.equal(taylor.cards.length,1);
  assert.equal(taylor.cards[0].rewardCents,150);
  assert.equal(taylor.cards[0].baseRewardCents,75);
  assert.equal(taylor.cards[0].basis,'category');
});

test('changing category changes the best owned card without inventing ownership or rotating benefits', () => {
  assert.equal(typeof domain.recommendLocationCards, 'function');
  const s=createFixtures();
  s.cards.push({id:'alex-freedom',userId:'alex',productId:'freedom-unlimited',selfReported:true});
  const dining=domain.recommendLocationCards(s,'alex',{category:'dining',amountCents:10400});
  assert.equal(dining.bestCardId,'alex-freedom');
  assert.equal(dining.cards[0].rewardCents,312);
  assert.equal(dining.cards[0].ownership,'self_reported');
  for(const category of ['groceries','gas','other']) {
    assert.equal(domain.recommendLocationCards(s,'alex',{category}).bestCardId,'alex-active-cash');
  }
  s.cards=[];
  assert.equal(domain.recommendLocationCards(s,'alex',{category:'gas'}).bestCardId,null);
  assert.deepEqual(domain.recommendLocationCards(s,'alex',{category:'gas'}).cards,[]);
});

test('location inputs validate cents, category and bounded place names', () => {
  assert.equal(typeof domain.recommendLocationCards, 'function');
  const s=createFixtures();
  for(const input of [{},{category:'Dining'},{category:'toString'},{category:'dining',amountCents:-1},{category:'dining',amountCents:0},{category:'dining',amountCents:1.5},{category:'gas',amountCents:'5000'},{category:'gas',amountCents:100000001},{category:'gas',placeName:{}},{category:'gas',placeName:'x'.repeat(121)}]) {
    assert.throws(()=>domain.recommendLocationCards(s,'alex',input),{status:400});
  }
  const one=domain.recommendLocationCards(s,'alex',{category:'gas',amountCents:1});
  assert.equal(one.cards[0].rewardCents,0);
  assert.equal(one.bestCardId,'alex-active-cash');
});

test('location ties honor preferred cards, otherwise deterministic card IDs', () => {
  assert.equal(typeof domain.recommendLocationCards, 'function');
  const s=createFixtures();
  s.cards.push({id:'aaa-active-cash',userId:'alex',productId:'active-cash'});
  assert.equal(domain.recommendLocationCards(s,'alex',{category:'dining'}).bestCardId,'aaa-active-cash');
  s.users.find(u=>u.id==='alex').preferredCardId='alex-active-cash';
  assert.equal(domain.recommendLocationCards(s,'alex',{category:'dining'}).bestCardId,'alex-active-cash');
});

test('quote and location rewards share merchant rules while item and client categories cannot override them', () => {
  const s=createFixtures();
  s.merchants.push({id:'cafe',name:'Test cafe',category:'dining'});
  const quote=domain.createQuote(s,'taylor',{merchantId:'cafe',merchandiseCents:5000,taxCents:0,shippingCents:0});
  assert.equal(quote.plans[0].rewardBps,300);
  assert.equal(quote.plans[0].rewardCents,150);
  const product=s.products.find(p=>p.id==='alo-jacket');
  product.category='dining';
  assert.equal(domain.createQuote(s,'taylor',{productId:'alo-jacket',category:'dining'}).plans[0].rewardBps,150);
});
