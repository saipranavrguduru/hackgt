import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../src/server.js';

async function client(t){
 const app=createApplication({persist:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
 const origin=`http://127.0.0.1:${app.server.address().port}`;let cookie='';
 const request=async(path,method='GET',body)=>{const response=await fetch(origin+'/api/v1'+path,{method,headers:{Origin:origin,Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return{status:response.status,body:await response.json()};};
 return{app,request};
}
const input=()=>({requestId:randomUUID(),cardId:'alex-active-cash',category:'other',placeName:'Coffee shop',amountCents:5000});

test('a recommendation counts only after explicitly recording its purchase, once across retries',async t=>{
 const {app,request}=await client(t);await request('/auth/demo','POST',{userId:'alex'});
 await request('/location/recommendations','POST',{category:'other',amountCents:5000});
 assert.equal((await request('/rewards/summary')).body.trackedTotalCents,0);
 const body=input(),recorded=await request('/rewards/card-purchases','POST',body);assert.equal(recorded.status,201);assert.equal(recorded.body.purchase.rewardCents,100);
 assert.equal((await request('/rewards/card-purchases','POST',body)).body.purchase.id,recorded.body.purchase.id);
 const savings=(await request('/bootstrap')).body.savings;assert.equal(savings.totalCents,0);assert.equal(savings.confirmedCents,0);assert.equal(savings.reportedCashbackCents,100);assert.equal(savings.trackedTotalCents,100);assert.equal(savings.rewardPurchases.length,1);
 assert.equal(app.store.data.ledger.length,0,'Self-reported estimates never become issuer-posted ledger entries');
 assert.equal((await request('/rewards/card-purchases','POST',{...body,amountCents:6000})).status,409);
});

test('manual tracking validates ownership, amounts and reward inputs on the server',async t=>{
 const {request}=await client(t);assert.equal((await request('/rewards/card-purchases','POST',input())).status,401);await request('/auth/demo','POST',{userId:'alex'});
 for(const bad of [{amountCents:null},{amountCents:0},{amountCents:1.5},{amountCents:100000001},{category:'made-up'},{rewardCents:999999},{cardId:'taylor-savor'}])assert.ok((await request('/rewards/card-purchases','POST',{...input(),...bad})).status>=400);
 assert.equal((await request('/rewards/summary')).body.trackedTotalCents,0);
});

test('tracked recommendations can be removed without a late retry restoring them or another user seeing them',async t=>{
 const {request}=await client(t);await request('/auth/demo','POST',{userId:'alex'});const body=input();const purchase=(await request('/rewards/card-purchases','POST',body)).body.purchase;assert.ok(purchase?.id);
 await request('/auth/demo','POST',{userId:'taylor'});assert.equal((await request('/rewards/summary')).body.rewardPurchases.length,0);assert.equal((await request('/rewards/card-purchases/'+purchase.id,'DELETE',{})).status,404);
 await request('/auth/demo','POST',{userId:'alex'});assert.equal((await request('/rewards/card-purchases/'+purchase.id,'DELETE',{})).status,200);
 await request('/rewards/card-purchases','POST',body);assert.equal((await request('/rewards/summary')).body.trackedTotalCents,0);
});

test('registered savings includes confirmed sandbox order estimates and survives checkout history outage',async t=>{
 const {app,request}=await client(t);await request('/auth/register','POST',{name:'Saver',email:'saver@example.test',password:'a-long-test-password'});
 let unavailable=false;const purchase={id:'order-1',intentId:'intent-1',name:'Headphones',merchantName:'PerkPilot Test Store',amountCents:10400,estimatedRewardCents:208,confirmedAt:Date.now(),currency:'USD',card:{productId:'active-cash',last4:'4242'},providerMode:'test'};
 app.setCheckoutRuntime({listRewardPurchases:async()=>{if(unavailable)throw new Error('private database details');return[purchase,purchase];}});
 const savings=(await request('/bootstrap')).body.savings;assert.equal(savings.checkoutCashbackCents,208);assert.equal(savings.trackedTotalCents,208);assert.equal(savings.totalCents,0);assert.equal(savings.rewardPurchases.length,1);assert.equal(savings.rewardPurchases[0].name,'Headphones');
 unavailable=true;const result=await request('/bootstrap');assert.equal(result.status,200);assert.equal(result.body.savings.checkoutRewardsUnavailable,true);assert.doesNotMatch(JSON.stringify(result.body),/private database/);
});

test('sample checkout cashback moves from estimated to posted without double counting and reverses on refund',async t=>{
 const {request}=await client(t);await request('/auth/demo','POST',{userId:'alex'});
 const quote=(await request('/commerce/quotes','POST',{productId:'alo-jacket'})).body;
 const session=(await request('/checkout/sessions','POST',{quoteId:quote.id,cardId:'alex-active-cash'})).body;
 const purchase=(await request('/checkout/sessions/'+session.id+'/confirm','POST',{approved:true})).body.purchase;
 let s=(await request('/rewards/summary')).body;assert.equal(s.sampleCashbackCents,208);assert.equal(s.trackedTotalCents,208);
 await request(`/demo/purchases/${purchase.id}/events`,'POST',{type:'settled'});s=(await request('/rewards/summary')).body;assert.equal(s.trackedTotalCents,2808);
 await request(`/demo/purchases/${purchase.id}/events`,'POST',{type:'reward_posted'});s=(await request('/rewards/summary')).body;assert.equal(s.sampleCashbackCents,0);assert.equal(s.trackedTotalCents,2808);
 await request(`/demo/purchases/${purchase.id}/events`,'POST',{type:'refunded'});assert.equal((await request('/rewards/summary')).body.trackedTotalCents,0);
});
