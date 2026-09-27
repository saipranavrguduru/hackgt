import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../src/server.js';

async function portal(t) {
  const app=createApplication({persist:false,port:0});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const origin=`http://localhost:${app.server.address().port}`;
  let cookie='';
  async function request(path,method='GET',body,extra={}) {
    const response=await fetch(origin+'/api/v1'+path,{method,headers:{Origin:origin,Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {response,body:await response.json()};
  }
  return {app,origin,request};
}

test('disabled checkout advertises setup only to registered users and leaves portal working',async t=>{
  const {request}=await portal(t);
  assert.equal((await request('/agent-checkout/capabilities')).response.status,403);
  await request('/auth/demo','POST',{userId:'alex'});
  assert.equal((await request('/agent-checkout/capabilities')).response.status,403);
  await request('/auth/register','POST',{name:'Buyer',email:'buyer@example.test',password:'a-long-test-password'});
  const response=await request('/agent-checkout/capabilities');
  assert.equal(response.body.ready,false);assert.equal(response.body.enabled,false);
  assert.equal((await request('/bootstrap')).response.status,200);
});

test('portal revokes purchase permissions before logout, profile switching and wallet removal',async t=>{
  const {app,request}=await portal(t);const calls=[];
  await request('/auth/register','POST',{name:'Buyer',email:'buyer@example.test',password:'a-long-test-password'});
  const user=app.store.data.users.find(u=>u.email==='buyer@example.test');
  app.setCheckoutRuntime({beforeLogout:async req=>{const token=req.headers.cookie.split('=')[1];assert.ok(app.auth.lookup(token));calls.push('logout');},beforeWalletRemove:async(req,id)=>{assert.ok(app.store.data.cards.some(c=>c.id===id));calls.push('remove');}});
  const card=(await request('/finance/cards','POST',{productId:'active-cash'})).body;
  await request('/finance/cards/'+card.id,'DELETE',{});assert.ok(!app.store.data.cards.some(c=>c.id===card.id));
  await request('/auth/demo','POST',{userId:'alex'});assert.ok(!app.auth.data.sessions.some(s=>s.userId===user.id));
  await request('/auth/logout','POST',{});assert.deepEqual(calls,['remove','logout','logout']);
});

test('only the exact webhook branch receives unparsed bytes without browser Origin',async t=>{
  const {app,origin}=await portal(t);let payload;
  app.setCheckoutRuntime({routes:{handleWebhook:async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);payload=Buffer.concat(chunks).toString();res.end('{}');},handle:async()=>{throw new Error('Unexpected browser handler');}}});
  const raw='{"signed":  true, "spaced":1}';
  const response=await fetch(origin+'/api/v1/agent-checkout/webhooks/stripe',{method:'POST',body:raw});
  assert.equal(response.status,200);assert.equal(payload,raw);
  const rejected=await fetch(origin+'/api/v1/agent-checkout/intents',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'});
  assert.equal(rejected.status,403);
});

test('paired extension plus valid portal cookie cannot read a bank challenge through portal CORS',async t=>{
  const {app,origin,request}=await portal(t);let reads=0;
  const registered=await request('/auth/register','POST',{name:'Buyer',email:'buyer@example.test',password:'a-long-test-password'});
  const extensionId='a'.repeat(32),token=app.auth.issue(registered.body.user.id,{kind:'extension',extensionId});
  const {createCheckoutRuntime}=await import('../src/checkout-runtime.js');
  const runtime=await createCheckoutRuntime({auth:app.auth,store:app.store,provider:{accountId:'acct_fixture'},config:{enabled:true,origin,repository:{},merchant:{},agent:{configured:true},service:{getPaymentAction:async()=>{reads++;return{clientSecret:'never-expose'};}}}});
  app.setCheckoutRuntime(runtime);t.after(()=>runtime.close());
  const result=await request('/agent-checkout/intents/example/payment-action','GET',undefined,{Origin:'chrome-extension://'+extensionId,Authorization:'Bearer '+token});
  assert.equal(result.response.status,403);assert.equal(reads,0);assert.equal(JSON.stringify(result.body).includes('never-expose'),false);
});
