import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/server.js';

async function client(t, options = {}) {
  const app = createApplication({persist:false,...options});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie='';
  const request = async (path, method='GET', body, headers={}) => {
    const response = await fetch(`${base}/api/v1${path}`, {method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  return {app,request,base};
}

test('location recommendations are authenticated, owned, validated and do not persist a visit', async t => {
  const {app,request}=await client(t);
  assert.equal((await request('/location/recommendations','POST',{category:'dining'})).status,401);
  await request('/auth/demo','POST',{userId:'alex'});
  const before=JSON.stringify(app.store.data);
  const result=await request('/location/recommendations','POST',{category:'dining',userId:'taylor',rewardBps:9999,placeName:'Test cafe',amountCents:5000});
  assert.equal(result.status,200);
  assert.equal(result.body.bestCardId,'alex-active-cash');
  assert.equal(result.body.cards[0].rewardCents,100);
  assert.equal(result.body.cards.length,3);
  assert.equal(JSON.stringify(app.store.data),before);
  assert.equal((await request('/location/recommendations','POST',{category:'invalid'})).status,400);
  assert.equal((await request('/location/recommendations','POST',{category:'gas'},{origin:'https://evil.example'})).status,403);
  await request('/auth/demo','POST',{userId:'taylor'});
  const taylor=await request('/location/recommendations','POST',{category:'dining'});
  assert.equal(taylor.body.cards.length,1);
  assert.equal(taylor.body.cards[0].rewardBps,300);
  assert.equal(taylor.body.cards[0].rewardCents,null);
});

test('nearby lookup requires consent, bounds calls, maps places, and never saves coordinates', async t => {
  let calls=0;
  const {app,request}=await client(t,{locationFetch:async()=>{
    calls++;
    return new Response(JSON.stringify({elements:[{type:'node',id:123,lat:33.775601,lon:-84.396301,tags:{name:'Test cafe',amenity:'cafe'}}]}),{headers:{'Content-Type':'application/json'}});
  }});
  const input={latitude:33.7756,longitude:-84.3963,accuracyMeters:20,consent:true};
  assert.equal((await request('/location/nearby','POST',input)).status,401);
  await request('/auth/demo','POST',{userId:'alex'});
  const before=JSON.stringify(app.store.data);
  assert.equal((await request('/location/nearby','POST',{...input,consent:false})).status,400);
  assert.equal((await request('/location/nearby','POST',{...input,latitude:'33.7756'})).status,400);
  assert.equal(calls,0,'Invalid or unconsented inputs must not leave the server');
  const result=await request('/location/nearby','POST',input);
  assert.equal(result.status,200);
  assert.equal(result.body.places[0].category,'dining');
  assert.equal(result.body.requiresConfirmation,true);
  assert.equal(JSON.stringify(app.store.data),before);
  assert.ok(!JSON.stringify(result.body).includes('33.7756'));
  for(let i=0;i<5;i++)assert.equal((await request('/location/nearby','POST',input)).status,200);
  assert.equal((await request('/location/nearby','POST',input)).status,429);
  assert.equal(calls,6);
  // Manual recommendations remain available during the GPS provider rate limit.
  assert.equal((await request('/location/recommendations','POST',{category:'gas'})).status,200);
});

test('provider outage fails clearly while manual recommendations and empty wallet still work', async t => {
  const {request}=await client(t,{locationFetch:async()=>{throw new Error('network unavailable');}});
  await request('/auth/register','POST',{name:'Location test',email:'location@example.com',password:'long-enough-test-password'});
  const nearby=await request('/location/nearby','POST',{latitude:33.7756,longitude:-84.3963,accuracyMeters:25,consent:true});
  assert.equal(nearby.status,502);
  const manual=await request('/location/recommendations','POST',{category:'groceries'});
  assert.equal(manual.status,200);
  assert.deepEqual(manual.body.cards,[]);
  assert.equal(manual.body.bestCardId,null);
});

test('provider throttling pauses shared map requests while manual recommendations stay available', async t => {
  let calls=0;
  const {request}=await client(t,{locationFetch:async()=>{calls++;return new Response('Provider busy',{status:406});}});
  await request('/auth/demo','POST',{userId:'alex'});
  const input={latitude:33.7756,longitude:-84.3963,accuracyMeters:25,consent:true};
  assert.equal((await request('/location/nearby','POST',input)).status,503);
  await request('/auth/demo','POST',{userId:'taylor'});
  assert.equal((await request('/location/nearby','POST',input)).status,503);
  assert.equal(calls,1,'A second user must respect the same provider cooldown');
  assert.equal((await request('/location/recommendations','POST',{category:'dining'})).status,200);
});

test('anonymous blocked; explicit sample login; empty registered profile and origin boundary', async t => {
  const {request}=await client(t);
  assert.equal((await request('/bootstrap')).status,401);
  assert.equal((await request('/auth/demo','POST',{userId:'alex'})).status,200);
  assert.equal((await request('/bootstrap')).body.user.id,'alex');
  assert.equal((await request('/preferences','PATCH',{consent:false},{origin:'https://evil.example'})).status,403);
  await request('/auth/logout','POST',{});
  const signup=await request('/auth/register','POST',{name:'Test',email:'test@example.com',password:'abcdefghijkl'});
  assert.equal(signup.status,201);
  const data=(await request('/bootstrap')).body;
  assert.equal(data.user.consent,false);
  assert.equal(data.cards.length,0);
  assert.equal(data.transactions.length,0);
  assert.equal(data.accounts.length,0);
});

test('golden checkout, isolation, idempotency, and separately posted ledger',async t=>{
  const {request}=await client(t);
  await request('/auth/demo','POST',{userId:'alex'});
  await request('/commerce/offers/alo-discover-credit/activate','POST',{});
  const q=await request('/commerce/quotes','POST',{productId:'alo-jacket'});
  assert.equal(q.status,200);
  const plan=q.body.plans.find(p=>p.cardId==='alex-discover');
  assert.equal(plan.checkoutCents,10400);assert.equal(plan.effectiveCostCents,8296);
  const checkout=await request('/checkout/sessions','POST',{quoteId:q.body.id,cardId:plan.cardId});
  assert.equal(checkout.status,201);
  const path=`/checkout/sessions/${checkout.body.id}/confirm`;
  assert.equal((await request(path,'POST',{})).status,400);
  const purchase=(await request(path,'POST',{approved:true})).body.purchase;
  const again=(await request(path,'POST',{approved:true})).body.purchase;
  assert.equal(again.id,purchase.id);
  assert.equal((await request('/rewards/summary')).body.confirmedCents,0);
  for(const [type,amount] of [['settled',2600],['qualified',2600],['credit_posted',4600],['reward_posted',4704]]){
    const event=await request(`/demo/purchases/${purchase.id}/events`,'POST',{type});
    assert.equal(event.status,200,JSON.stringify(event.body));
    assert.equal((await request('/rewards/summary')).body.confirmedCents,amount);
    await request(`/demo/purchases/${purchase.id}/events`,'POST',{type});
    assert.equal((await request('/rewards/summary')).body.confirmedCents,amount);
  }
  await request('/auth/demo','POST',{userId:'taylor'});
  assert.equal((await request(`/commerce/quotes/${q.body.id}`)).status,404);
  assert.equal((await request(`/rewards/purchases/${purchase.id}`)).status,404);
});

test('repriced quotes, self-reported payment, and unknown totals cannot approve',async t=>{
  const {app,request}=await client(t);
  await request('/auth/demo','POST',{userId:'alex'});
  const q=(await request('/commerce/quotes','POST',{productId:'alo-jacket'})).body;
  const c=(await request('/checkout/sessions','POST',{quoteId:q.id,cardId:q.bestAvailableNowCardId})).body;
  app.store.data.products.find(p=>p.id==='alo-jacket').priceCents=10500;
  assert.equal((await request(`/checkout/sessions/${c.id}/confirm`,'POST',{approved:true})).status,409);
  const provisional=(await request('/commerce/quotes','POST',{productId:'alo-jacket',taxCents:null})).body;
  assert.equal(provisional.provisional,true);
  assert.equal((await request('/checkout/sessions','POST',{quoteId:provisional.id,cardId:provisional.bestAvailableNowCardId})).status,409);
});

test('pairing is explicit, one-use, scoped and cannot confirm payments',async t=>{
  const {request}=await client(t);
  const pair=(await request('/extension/pairings','POST',{extensionId:'a'.repeat(32)})).body;
  assert.equal((await request(`/extension/pairings/${pair.id}/exchange`,'POST',{secret:pair.secret})).status,409);
  await request('/auth/demo','POST',{userId:'alex'});
  assert.equal((await request(`/extension/pairings/${pair.id}/approve`,'POST',{})).status,200);
  const exchanged=await request(`/extension/pairings/${pair.id}/exchange`,'POST',{secret:pair.secret});
  assert.equal(exchanged.status,200);
  assert.equal((await request(`/extension/pairings/${pair.id}/exchange`,'POST',{secret:pair.secret})).status,409);
  const bearer={authorization:`Bearer ${exchanged.body.token}`};
  assert.equal((await request('/finance/transactions','GET',null,bearer)).status,403);
  assert.equal((await request('/auth/session','GET',null,bearer)).status,403);
  assert.equal((await request('/location/nearby','POST',{latitude:0,longitude:0,accuracyMeters:20,consent:true},bearer)).status,403);
  assert.equal((await request('/location/recommendations','POST',{category:'gas'},bearer)).status,403);
  assert.equal((await request('/commerce/quotes','POST',{productId:'alo-jacket'},bearer)).status,200);
  assert.equal((await request('/checkout/sessions/nope/confirm','POST',{approved:true},bearer)).status,403);
});

test('different card checkout sessions cannot purchase a quote twice',async t=>{
  const {request}=await client(t);
  await request('/auth/demo','POST',{userId:'alex'});
  const quote=(await request('/commerce/quotes','POST',{productId:'alo-jacket'})).body;
  const a=(await request('/checkout/sessions','POST',{quoteId:quote.id,cardId:'alex-active-cash'})).body;
  const b=(await request('/checkout/sessions','POST',{quoteId:quote.id,cardId:'alex-quicksilver'})).body;
  assert.equal((await request(`/checkout/sessions/${a.id}/confirm`,'POST',{approved:true})).status,200);
  assert.equal((await request(`/checkout/sessions/${b.id}/confirm`,'POST',{approved:true})).status,409);
  assert.equal((await request('/rewards/purchases')).body.length,1);
});

test('live mode never serves fixture API data',async t=>{
  const {request}=await client(t,{mode:'live'});
  const result=await request('/auth/demo','POST',{userId:'alex'});
  assert.equal(result.status,503);assert.equal(result.body.error.code,'LIVE_PROVIDER_UNAVAILABLE');
});

test('merchant cart changes after portal handoff invalidate approval',async t=>{
  const {request}=await client(t);
  const cart=(await request('/store/carts','POST',{productId:'alo-jacket',quantity:1})).body;
  assert.ok(cart.id);
  await request('/auth/demo','POST',{userId:'alex'});
  const quote=(await request('/commerce/quotes','POST',{productId:'alo-jacket',quantity:1,cart:{...cart.cart,cartId:cart.id,cartRevision:cart.revision}})).body;
  assert.ok(quote.id);
  const checkout=(await request('/checkout/sessions','POST',{quoteId:quote.id,cardId:quote.bestAvailableNowCardId})).body;
  assert.equal((await request(`/store/carts/${cart.id}`,'PATCH',{quantity:2,secret:'wrong'})).status,403);
  assert.equal((await request(`/store/carts/${cart.id}`,'PATCH',{quantity:2,secret:cart.secret})).status,200);
  const result=await request(`/checkout/sessions/${checkout.id}/confirm`,'POST',{approved:true});
  assert.equal(result.status,409);assert.equal(result.body.error.code,'CART_CHANGED');
});
