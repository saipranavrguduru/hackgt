import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutFixture} from './helpers/checkout-fixture.js';
import {createCheckoutRuntime} from '../src/checkout-runtime.js';

async function purchase(f,status='succeeded') {
 f.provider.status=status;
 const {context,intent}=await f.prepare();const quote=await f.service.rankCards(context);
 await f.service.executePurchase(context,{quoteId:quote.id,cardId:quote.rankedCards[0].cardId});
 return intent;
}

test('reward purchase history uses immutable confirmed order rewards without modifying the ledger or order',async t=>{
 const f=await checkoutFixture();t.after(f.close);
 assert.equal(typeof f.service.listRewardPurchases,'function');
 const intent=await purchase(f);
 const before=(await f.repository.query('SELECT * FROM pp_checkout_orders')).rows;
 const history=await f.service.listRewardPurchases(f.principal);
 assert.equal(history.length,1);assert.equal(history[0].id,before[0].id);assert.equal(history[0].orderId,before[0].id);assert.equal(history[0].intentId,intent.id);
 assert.equal(history[0].name,'Everyday Headphones');assert.equal(history[0].merchantName,'PerkPilot Test Store');assert.equal(history[0].amountCents,10400);assert.equal(history[0].estimatedRewardCents,208);assert.equal(history[0].confirmedAt,f.now());assert.equal(history[0].providerMode,'test');
 assert.deepEqual(history[0].card,{productId:'active-cash',last4:'4242',brand:'visa',rateBps:200});
 await f.repository.query('UPDATE pp_checkout_products SET data=$1',[{name:'Changed catalog name',sourceMerchantName:'Changed retailer'}]);
 f.cards[0].productId='quicksilver';f.cards.length=0;
 assert.deepEqual(await f.service.listRewardPurchases(f.principal),history,'later catalog and wallet edits cannot recalculate historical rewards');
 assert.deepEqual((await f.repository.query('SELECT * FROM pp_checkout_orders')).rows,before,'repeated reads do not update or duplicate purchases');
 assert.equal(f.provider.calls.length,1,'summary reads never submit another payment');
 assert.equal(JSON.stringify(history).includes('providerAccountId'),false);assert.equal(JSON.stringify(history).includes('pm_'),false);assert.equal(JSON.stringify(history).includes('session-alice'),false);assert.equal(JSON.stringify(history).includes('destinationHash'),false);
});

test('reward purchase history excludes pending, failed, cancelled, incomplete and foreign-owned orders',async t=>{
 for(const status of ['processing','requires_action','requires_payment_method','canceled']){
  const f=await checkoutFixture();try{assert.equal(typeof f.service.listRewardPurchases,'function');await purchase(f,status);assert.deepEqual(await f.service.listRewardPurchases(f.principal),[]);}finally{await f.close();}
 }
 const f=await checkoutFixture();t.after(f.close);await purchase(f);
 const other={...f.principal,userId:'22222222-2222-4222-8222-222222222222',subjectKey:'portal:22222222-2222-4222-8222-222222222222'};
 assert.deepEqual(await f.service.listRewardPurchases(other),[]);
 await f.repository.query('UPDATE pp_checkout_orders SET confirmed_at=NULL');
 assert.deepEqual(await f.service.listRewardPurchases(f.principal),[]);
 f.logout();await assert.rejects(f.service.listRewardPurchases(f.principal),{code:'LOGIN_REQUIRED'});
});

test('reward purchase names and retailer attribution come from the owned authorization snapshot',async t=>{
 const f=await checkoutFixture();t.after(f.close);assert.equal(typeof f.service.listRewardPurchases,'function');
 const intent=await purchase(f);
 const row=(await f.repository.query('SELECT * FROM pp_checkout_intents WHERE id=$1',[intent.id])).rows[0];
 const data=structuredClone(row.data);data.permission.cart.name='Approved travel headphones';data.permission.cart.sourceMerchantName='Observed retailer';
 await f.repository.query('UPDATE pp_checkout_intents SET data=$1 WHERE id=$2',[data,intent.id]);
 const history=await f.service.listRewardPurchases(f.principal);
 assert.equal(history[0].name,'Approved travel headphones');assert.equal(history[0].sourceMerchantName,'Observed retailer');
 assert.equal(history[0].merchantName,'PerkPilot Test Store');
});

test('runtime reward history requires the current registered portal session and disabled mode reads no database',async()=>{
 const disabled=await createCheckoutRuntime({config:{enabled:false}});
 assert.equal(typeof disabled.listRewardPurchases,'function');assert.deepEqual(await disabled.listRewardPurchases({headers:{}}),[]);
 const id='11111111-1111-4111-8111-111111111111',session={digest:'registered-session',userId:id,kind:'portal',expiresAt:2000};let reads=0;
 const auth={data:{users:[{id}],sessions:[session]},lookup:token=>token==='valid'?session:null};
 const runtime=await createCheckoutRuntime({auth,store:{data:{users:[{id,sample:false}],cards:[]}},now:()=>1000,provider:{accountId:'acct_fixture'},config:{enabled:true,origin:'http://localhost:3000',repository:{},merchant:{},agent:{configured:true},service:{listRewardPurchases:async principal=>{assert.equal(principal.subjectKey,'portal:'+id);assert.equal(principal.sessionDigest,session.digest);reads++;return[{id:'owned-order'}];}}}});
 try{
  assert.deepEqual(await runtime.listRewardPurchases({headers:{cookie:'perkpilot_session=valid'}}),[{id:'owned-order'}]);
  assert.deepEqual(await runtime.listRewardPurchases(session),[{id:'owned-order'}]);
  await assert.rejects(runtime.listRewardPurchases({headers:{}}),{code:'REGISTERED_USER_REQUIRED'});
  await assert.rejects(runtime.listRewardPurchases({...session,kind:'extension'}),{code:'REGISTERED_USER_REQUIRED'});
  session.expiresAt=999;await assert.rejects(runtime.listRewardPurchases(session),{code:'REGISTERED_USER_REQUIRED'});assert.equal(reads,2);
 }finally{await runtime.close();}
});
