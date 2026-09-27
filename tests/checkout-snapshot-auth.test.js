import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {checkoutFixture} from './helpers/checkout-fixture.js';
import {createCheckoutRuntime} from '../src/checkout-runtime.js';

async function hostedFixture(t,{agent}={}) {
  const f=await checkoutFixture();
  const session={digest:f.principal.sessionDigest,userId:f.principal.userId,kind:'portal',expiresAt:f.now()+600000};
  const local={auth:{users:[{id:f.principal.userId}],sessions:[session]},state:{users:[{id:f.principal.userId,sample:false}],cards:f.cards.map(card=>({...card,userId:f.principal.userId}))}};
  let current=structuredClone(local),unavailable=false;
  f.provider.verifyAccount=async()=>({id:f.provider.accountId,mode:'test'});
  const runtime=await createCheckoutRuntime({auth:{data:local.auth},store:{data:local.state},provider:f.provider,now:f.now,config:{enabled:true,origin:'https://perkpilot.example',repository:f.repository,merchant:f.merchant,agent:agent || {configured:true},readPortalSnapshot:async()=>{if(unavailable)throw new Error('snapshot unavailable');return structuredClone(current);}}});
  t.after(async()=>{await runtime.close();await f.close();});
  return{...f,runtime,local,snapshot:()=>current,failReads:()=>{unavailable=true;}};
}

test('hosted service rejects a revoked session despite stale local identity and does not mutate shared portal memory',async t=>{
  const f=await hostedFixture(t);const {context}=await f.prepare();
  assert.equal(await f.runtime.authAdapter.isSessionActive(f.principal),true);
  f.snapshot().auth.sessions=[];
  assert.equal(await f.runtime.authAdapter.isSessionActive(f.principal),false);
  assert.equal(await f.runtime.authAdapter.isActive(f.principal),false);
  await assert.rejects(f.runtime.service.rankCards(context),{code:'LOGIN_REQUIRED'});
  await assert.rejects(f.runtime.authAdapter.getWalletCards(f.principal),{code:'REGISTERED_USER_REQUIRED'});
  assert.equal(f.local.auth.sessions.length,1);assert.equal(f.local.state.cards.length,2);
  assert.equal(f.provider.calls.length,0);
});

test('hosted wallet checks reject a card removed on another instance before payment dispatch',async t=>{
  const f=await hostedFixture(t);const {context}=await f.prepare();
  const quote=await f.runtime.service.rankCards(context);
  assert.equal(quote.rankedCards[0].cardId,'wallet-a');
  f.snapshot().state.cards=f.snapshot().state.cards.filter(card=>card.id!=='wallet-a');
  assert.deepEqual((await f.runtime.authAdapter.getWalletCards(f.principal)).map(card=>card.id),['wallet-b']);
  assert.deepEqual((await f.runtime.authAdapter.listWalletCards(f.principal)).map(card=>card.id),['wallet-b']);
  assert.equal(await f.runtime.authAdapter.getWalletCard(f.principal,'wallet-a'),undefined);
  assert.equal((await f.runtime.authAdapter.getWalletCard(f.principal,'wallet-b')).productId,'quicksilver');
  await assert.rejects(f.runtime.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'}),{code:'CARD_NOT_ALLOWED'});
  assert.equal(f.local.state.cards.length,2);assert.equal(f.provider.calls.length,0);
  assert.equal((await f.repository.query('SELECT id FROM pp_checkout_attempts')).rows.length,0);
});

test('hosted auth and wallet reads fail closed when the durable snapshot is unavailable',async t=>{
  const f=await hostedFixture(t);f.failReads();
  assert.equal(await f.runtime.authAdapter.isSessionActive(f.principal),false);
  await assert.rejects(f.runtime.authAdapter.getWalletCards(f.principal));
  await assert.rejects(f.runtime.authAdapter.getWalletCard(f.principal,'wallet-a'));
  await assert.rejects(f.runtime.service.listMethods(f.principal),{code:'LOGIN_REQUIRED'});
  assert.equal(f.local.auth.sessions.length,1);assert.equal(f.provider.calls.length,0);
});

test('queued hosted worker checks fresh session state before invoking the agent',async t=>{
  for(const failure of ['revoked','unavailable']){
    let runs=0;
    const f=await hostedFixture(t,{agent:{configured:true,run:async()=>{runs++;throw new Error('Agent must not run without current portal permission.');}}});
    const {intent}=await f.prepare();
    if(failure==='revoked')f.snapshot().auth.sessions=[];else f.failReads();
    await f.runtime.start();
    let row;const deadline=Date.now()+2000;
    do{row=(await f.repository.query('SELECT state FROM pp_checkout_intents WHERE id=$1',[intent.id])).rows[0];if(!['queued','running'].includes(row.state))break;await delay(5);}while(Date.now()<deadline);
    assert.equal(row.state,'cancelled',failure);assert.equal(runs,0,failure);
    assert.equal(f.local.auth.sessions.length,1);assert.equal(f.provider.calls.length,0);
    await f.runtime.close();
  }
});
