import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutFixture} from './helpers/checkout-fixture.js';

test('enrolled best-card checkout confirms one provider-backed order, not rewards',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const quote=await f.service.rankCards(context);
  assert.equal(quote.rankedCards[0].cardId,'wallet-a');assert.equal(quote.rankedCards[0].estimatedRewardCents,208);
  const result=await f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'});
  assert.equal(result.state,'confirmed');assert.equal(result.order.totalCents,10400);assert.equal(result.order.paymentId,'pi_1');assert.equal(result.order.estimatedRewardCents,208);
  const again=await f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'});
  assert.equal(again.order.orderId,result.order.orderId);assert.equal(f.provider.payments.size,1);assert.equal(f.provider.calls.length,1);
  assert.equal(JSON.stringify(result).includes('pm_'),false);assert.equal(JSON.stringify(result).includes('cus_alice'),false);
});

test('a changed price above the approved cap is blocked before provider submission',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const quote=await f.service.rankCards(context);
  await f.repository.query('UPDATE pp_checkout_products SET merchandise_cents=12600,revision=revision+1');
  await assert.rejects(f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'}),{code:'AMOUNT_LIMIT_EXCEEDED'});
  assert.equal(f.provider.calls.length,0);assert.equal((await f.service.getStatus(f.principal,context.intentId)).state,'blocked');assert.match((await f.service.getStatus(f.principal,context.intentId)).error.message,/\$140\.00.*\$110\.00/);
});

test('duplicate authorization and concurrent execution preserve one order and charge',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context,preview,intent}=await f.prepare();
  const same=await f.service.authorize(f.principal,{previewId:preview.id,maxAmountCents:11000,approved:true});assert.equal(same.id,intent.id);assert.equal(same.previewId,preview.id);
  const q=await f.service.rankCards(context);const results=await Promise.all([1,2,3].map(()=>f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'})));
  assert.equal(new Set(results.map(r=>r.order.orderId)).size,1);assert.equal(f.provider.payments.size,1);
});

test('ambiguous provider response reconciles the identical persisted payment operation',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);f.provider.timeout=true;
  const result=await f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'});assert.equal(result.state,'payment_pending');
  f.advance(6000);await f.service.reconcile(context.intentId);const recovered=await f.service.getStatus(f.principal,context.intentId);
  assert.equal(recovered.state,'confirmed');assert.equal(f.provider.payments.size,1);assert.equal(new Set(f.provider.calls.map(c=>c.idempotencyKey)).size,1);
});

test('expired or revoked permission and a foreign principal cannot dispatch a payment',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);
  await assert.rejects(f.service.getStatus({...f.principal,subjectKey:'portal:bob'},context.intentId),{code:'NOT_FOUND'});
  f.advance(301000);await assert.rejects(f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'}),{code:'PERMISSION_EXPIRED'});assert.equal(f.provider.calls.length,0);
});

test('authentication expiry does not authorize another charge and terminal results are monotonic',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);f.provider.status='requires_action';
  assert.equal((await f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'})).state,'requires_action');
  const p=Array.from(f.provider.payments.values())[0];p.status='succeeded';f.advance(301000);await f.service.reconcile(context.intentId);
  assert.equal((await f.service.getStatus(f.principal,context.intentId)).state,'confirmed');p.status='processing';f.advance(6000);await f.service.reconcile(context.intentId);
  assert.equal((await f.service.getStatus(f.principal,context.intentId)).state,'confirmed');assert.equal(f.provider.payments.size,1);
});

test('revoking a method or session cancels undispatched permission',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);
  await f.service.revokeSession(f.principal);f.logout();await assert.rejects(f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'}));assert.equal(f.provider.calls.length,0);
});

test('wrong card, stale quote, changed item and revoked card cannot dispatch',async t=>{
  for(const scenario of ['wrong-card','stale-quote','changed-item','removed-card']) {
    const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);
    if(scenario==='stale-quote')f.advance(61000);
    if(scenario==='changed-item')await f.repository.query("UPDATE pp_checkout_products SET merchant_id='substituted'");
    if(scenario==='removed-card')await f.service.removeMethod(f.principal,'wallet-a');
    await assert.rejects(f.service.executePurchase(context,{quoteId:q.id,cardId:scenario==='wrong-card'?'wallet-b':'wallet-a'}));
    assert.equal(f.provider.calls.length,0,scenario);
  }
});

test('webhook retries reconcile current provider state and cannot regress success or release inventory twice',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);f.provider.status='processing';
  await f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'});
  const payment=Array.from(f.provider.payments.values())[0];payment.status='succeeded';
  const event={id:'evt_success',accountId:f.provider.accountId,livemode:false,type:'payment_intent.succeeded',payment};
  await Promise.all([f.service.acceptWebhook(event),f.service.acceptWebhook(event)]);
  payment.status='processing';await f.service.acceptWebhook({...event,id:'evt_stale'});
  assert.equal((await f.service.getStatus(f.principal,context.intentId)).state,'confirmed');
  assert.equal((await f.repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,99);
  assert.equal((await f.repository.query('SELECT id FROM pp_checkout_orders')).rows.length,1);
});

test('mismatched provider results never produce a confirmed receipt',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);
  const submit=f.provider.submitPayment;f.provider.submitPayment=async input=>({...await submit(input),amountCents:1});
  const view=await f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'});
  assert.equal(view.state,'payment_pending');assert.equal(view.order.confirmedAt,null);
  assert.ok(view.events.some(e=>e.code==='PAYMENT_MISMATCH'));
});

test('unknown payment after replay window stays pending without creating a replacement',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);f.provider.timeout=true;
  await f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'});f.advance(24*60*60*1000);
  const view=await f.service.reconcile(context.intentId);assert.equal(view.state,'payment_pending');assert.equal(f.provider.calls.length,1);
  assert.ok(view.events.some(e=>e.code==='OPERATOR_RECONCILIATION_REQUIRED'));
});

test('late agent failure and tool calls cannot overwrite confirmed payment state',async t=>{
  const f=await checkoutFixture();t.after(f.close);const {context}=await f.prepare();const q=await f.service.rankCards(context);
  await f.service.executePurchase(context,{quoteId:q.id,cardId:'wallet-a'});
  await f.service.markAgentFailed(context,new Error('late'));await assert.rejects(f.service.rankCards(context));
  assert.equal((await f.service.getStatus(f.principal,context.intentId)).state,'confirmed');
  assert.equal((await f.service.listIntents(f.principal))[0].id,context.intentId);
});


test('purchase status identifies the approved product for recovery on another Explore item',async t=>{
 const f=await checkoutFixture();t.after(f.close);const {intent,preview}=await f.prepare();
 const status=await f.service.getStatus(f.principal,intent.id);
 assert.deepEqual(status.cart,{sku:preview.cart.sku,variantId:preview.cart.variantId,name:preview.cart.name,quantity:preview.cart.quantity});
 assert.equal(Object.hasOwn(status.cart,'destinationHash'),false);assert.equal(Object.hasOwn(status.cart,'providerAccountId'),false);
});
