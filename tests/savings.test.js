import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFixtures} from '../src/fixtures.js';
import {CARD_PRODUCTS} from '../src/card-catalog.js';
import {trackedSavings,recordCardPurchase,removeCardPurchase} from '../src/savings.js';
import {checkoutFixture} from './helpers/checkout-fixture.js';

const NOW=Date.parse('2026-09-27T16:00:00.000Z');
const report=(overrides={})=>({requestId:randomUUID(),cardId:'alex-active-cash',category:'other',placeName:'Local shop',amountCents:5000,...overrides});
const sandbox=(overrides={})=>({id:'sandbox-order',orderId:'sandbox-order',intentId:'sandbox-intent',name:'Test headphones',merchantName:'PerkPilot Test Store',amountCents:10400,estimatedRewardCents:208,confirmedAt:NOW,currency:'USD',card:{productId:'active-cash'},providerMode:'test',...overrides});
function registeredState(){const state=createFixtures();state.users.push({id:'registered',sample:false,timezone:'America/New_York',preferences:{}});state.cards.push({id:'registered-card',userId:'registered',productId:'active-cash'});return state;}

test('confirmed checkout service history contributes its real projected cashback contract',async t=>{
 const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare(),quote=await f.service.rankCards(context);
 await f.service.executePurchase(context,{quoteId:quote.id,cardId:quote.rankedCards[0].cardId});
 const state=createFixtures();state.users.push({id:f.principal.userId,sample:false,timezone:'America/New_York',preferences:{}});
 const checkoutPurchases=await f.service.listRewardPurchases(f.principal);
 const result=trackedSavings(state,f.principal.userId,{checkoutPurchases,now:f.now()});
 assert.equal(result.checkoutCashbackCents,208);assert.equal(result.estimatedCashbackCents,208);assert.equal(result.trackedTotalCents,208);assert.equal(result.confirmedCents,0);assert.equal(result.rewardPurchases.length,1);
 assert.equal(checkoutPurchases[0].currency,'USD');
});

test('registered yearly savings use the current clock and exact owner timezone boundary',()=>{
 const state=registeredState();
 const before=Date.parse('2027-01-01T04:59:59.999Z'),after=before+1;
 const checkoutPurchases=[sandbox({id:'last-year',confirmedAt:before,estimatedRewardCents:100}),sandbox({id:'new-year',confirmedAt:after,estimatedRewardCents:200})];
 const previous=trackedSavings(state,'registered',{checkoutPurchases,now:before});
 assert.equal(previous.year,2026);assert.equal(previous.checkoutCashbackCents,100);assert.deepEqual(previous.rewardPurchases.map(row=>row.id),['last-year']);
 const current=trackedSavings(state,'registered',{checkoutPurchases,now:after});
 assert.equal(current.year,2027);assert.equal(current.checkoutCashbackCents,200);assert.deepEqual(current.rewardPurchases.map(row=>row.id),['new-year']);
 const recorded=recordCardPurchase(state,'registered',report({cardId:'registered-card'}),{now:after});
 assert.equal(recorded.purchase.occurredAt,'2027-01-01T05:00:00.000Z');assert.equal(trackedSavings(state,'registered',{now:after}).reportedCashbackCents,100);
 assert.equal(state.clock,'2026-09-23T16:00:00.000Z','real-user reporting must not advance the sample clock');
});

test('sample reports and yearly summaries retain the sample clock when wall-clock year advances',()=>{
 const state=createFixtures('2026-12-31T23:30:00.000Z'),now=Date.parse('2028-06-01T12:00:00.000Z');
 const recorded=recordCardPurchase(state,'alex',report(),{now});
 assert.equal(recorded.purchase.occurredAt,state.clock);
 const result=trackedSavings(state,'alex',{now});assert.equal(result.year,2026);assert.equal(result.reportedCashbackCents,100);
 assert.equal(trackedSavings(state,'taylor',{now}).reportedCashbackCents,0);
});

test('sandbox history deduplicates order IDs and rejects foreign currency without altering confirmed ledger totals',()=>{
 const state=createFixtures();state.ledger.push(
  {id:'discount',userId:'alex',purchaseId:'past',currency:'USD',kind:'merchant_discount',amountCents:1000,recognizedAt:state.clock},
  {id:'reward',userId:'alex',purchaseId:'past',currency:'USD',kind:'cash_reward',amountCents:150,recognizedAt:state.clock},
  {id:'reversal',userId:'alex',purchaseId:'past',currency:'USD',kind:'cash_reward',amountCents:-50,recognizedAt:state.clock},
  {id:'foreign-owner',userId:'taylor',currency:'USD',kind:'cash_reward',amountCents:9000,recognizedAt:state.clock}
 );
 const savedLedger=structuredClone(state.ledger),order=sandbox();
 const result=trackedSavings(state,'alex',{checkoutPurchases:[order,structuredClone(order),sandbox({id:'foreign-currency',currency:'CAD'}),sandbox({id:'no-currency',currency:undefined})],now:NOW});
 assert.equal(result.totalCents,1100);assert.equal(result.confirmedCents,1100);assert.equal(result.checkoutCashbackCents,208);assert.equal(result.trackedTotalCents,1308);assert.equal(result.rewardPurchases.length,1);
 assert.deepEqual(state.ledger,savedLedger);assert.equal(result.cashRewardCents,100);
});

test('sample estimates exclude processing, failed, refunded and other-owner purchases and disappear when rewards post',()=>{
 const state=createFixtures();const base={userId:'alex',status:'authorized',productName:'Sample product',merchantName:'Sample store',checkoutCents:5000,createdAt:state.clock,plan:{rewardCents:100,checkoutCents:5000,cardName:'Active Cash'}};
 state.purchases.push({id:'eligible',...base},...['processing','failed','refunded','declined'].map(status=>({id:status,...base,status})),{id:'foreign-owner',...base,userId:'taylor'});
 let result=trackedSavings(state,'alex',{now:NOW});assert.equal(result.sampleCashbackCents,100);assert.deepEqual(result.rewardPurchases.map(row=>row.id),['eligible']);
 state.ledger.push({id:'posted-reward',userId:'alex',purchaseId:'eligible',currency:'USD',kind:'cash_reward',amountCents:100,recognizedAt:state.clock});
 result=trackedSavings(state,'alex',{now:NOW});assert.equal(result.sampleCashbackCents,0);assert.equal(result.totalCents,100);assert.equal(result.trackedTotalCents,100);
 state.ledger=[];state.purchases[0].benefitStatus={reward:'posted'};
 assert.equal(trackedSavings(state,'alex',{now:NOW}).sampleCashbackCents,0,'posted state also suppresses a duplicate estimate');
});

test('manual rewards remain stored after wallet removal or later rule changes and returned values cannot modify history',()=>{
 const state=createFixtures(),input=report();const recorded=recordCardPurchase(state,'alex',input,{now:NOW});
 assert.equal(recorded.purchase.rewardCents,100);assert.equal(recorded.purchase.userId,undefined);assert.equal(recorded.purchase.requestId,undefined);assert.equal(recorded.purchase.fingerprint,undefined);
 const originalId=recorded.purchase.id;recorded.purchase.rewardCents=999999;input.amountCents=1;
 const product=CARD_PRODUCTS.find(row=>row.id==='active-cash'),originalBps=product.rewardBps;
 try{
  product.rewardBps=9999;state.cards=state.cards.filter(card=>card.userId!=='alex');
  const retry=recordCardPurchase(state,'alex',{...input,amountCents:5000},{now:NOW+86400000});
  assert.equal(retry.duplicate,true);assert.equal(retry.purchase.id,originalId);assert.equal(retry.purchase.rewardCents,100);assert.equal(retry.purchase.rewardBps,200);
  const summary=trackedSavings(state,'alex',{now:NOW});assert.equal(summary.reportedCashbackCents,100);summary.rewardPurchases[0].rewardCents=123456;
  assert.equal(trackedSavings(state,'alex',{now:NOW}).reportedCashbackCents,100);
  assert.throws(()=>recordCardPurchase(state,'alex',{...input,requestId:randomUUID()},{now:NOW}),{code:'CARD_NOT_OWNED'});
 }finally{product.rewardBps=originalBps;}
});

test('manual ownership and idempotency reject aliases and conflicting retries, including after removal',()=>{
 const state=createFixtures();
 for(const patch of [{userId:'taylor'},{rewardCents:9000},{rewardBps:9999},{currency:'CAD'},{cardId:'taylor-freedom'}])assert.throws(()=>recordCardPurchase(state,'alex',report(patch),{now:NOW}));
 const input=report(),recorded=recordCardPurchase(state,'alex',input,{now:NOW});
 assert.throws(()=>removeCardPurchase(state,'taylor',recorded.purchase.id),{code:'NOT_FOUND'});
 assert.throws(()=>recordCardPurchase(state,'alex',{...input,amountCents:6000},{now:NOW}),{code:'PURCHASE_REQUEST_REUSED'});
 assert.deepEqual(removeCardPurchase(state,'alex',recorded.purchase.id),{ok:true});assert.deepEqual(removeCardPurchase(state,'alex',recorded.purchase.id),{ok:true});
 const retry=recordCardPurchase(state,'alex',input,{now:NOW});assert.equal(retry.duplicate,true);assert.equal(retry.purchase.status,'removed');assert.equal(state.cardRewardPurchases.length,1);assert.equal(trackedSavings(state,'alex',{now:NOW}).trackedTotalCents,0);
 assert.throws(()=>recordCardPurchase(state,'alex',{...input,category:'dining'},{now:NOW}),{code:'PURCHASE_REQUEST_REUSED'});
 const other=recordCardPurchase(state,'taylor',{...input,cardId:'taylor-freedom'},{now:NOW});assert.notEqual(other.purchase.id,recorded.purchase.id,'request IDs are scoped to their owner');
 assert.equal(trackedSavings(state,'alex',{now:NOW}).reportedCashbackCents,0);assert.equal(trackedSavings(state,'taylor',{now:NOW}).reportedCashbackCents,75);
});
