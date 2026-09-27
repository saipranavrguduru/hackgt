import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkoutFixture } from './helpers/checkout-fixture.js';
import { createCheckoutDemoControls,assertCheckoutDemoConfig } from '../src/checkout-demo.js';
import { dispatchCheckoutTool } from '../src/checkout-agent.js';
import { Readable } from 'node:stream';
import { createCheckoutRoutes } from '../src/checkout-routes.js';

const config={enabled:true,demoControls:true,origin:'http://localhost:3000',databaseUrl:'postgresql://demo:demo@127.0.0.1/perkpilot_checkout_demo',providerAccountId:'acct_checkout_test'};
const fixture=()=>checkoutFixture({repositoryOptions:{demoConfig:config}});
const controls=f=>createCheckoutDemoControls({repository:f.repository,merchant:f.merchant,config});

test('presenter controls require both gates, exact loopback origin and local PostgreSQL fixture',()=>{
  for(const changed of [{},{enabled:false},{demoControls:false},{origin:'https://public.example'},{origin:'http://localhost:3000/path'},{databaseUrl:'postgresql://demo:demo@remote.example/demo'},{databaseUrl:'https://localhost/demo'}]){
    assert.throws(()=>assertCheckoutDemoConfig(Object.keys(changed).length?{...config,...changed}:{}));
  }
  assert.doesNotThrow(()=>assertCheckoutDemoConfig(config));
});

test('a scenario targets an enrolled registered subject and is consumed once without global repricing',async t=>{
  const f=await fixture();t.after(f.close);const demo=controls(f);
  await assert.rejects(demo.arm({subjectKey:'alex',scenario:'price-increase'}),{code:'REGISTERED_USER_REQUIRED'});
  await assert.rejects(demo.arm({subjectKey:`portal:${randomUUID()}`,scenario:'price-increase'}),{code:'DEMO_SUBJECT_REQUIRED'});
  await assert.rejects(demo.arm({subjectKey:f.principal.subjectKey,scenario:'disable-policy'}),{code:'INVALID_DEMO_SCENARIO'});
  await demo.arm({subjectKey:f.principal.subjectKey,scenario:'price-increase'});
  const {preview,intent,context}=await f.prepare();
  assert.equal(preview.cart.totalCents,10400);
  assert.equal(intent.maxAmountCents,11000);
  assert.equal((await f.service.readCart(context)).totalCents,14000);
  assert.equal((await f.repository.query('SELECT merchandise_cents FROM pp_checkout_products')).rows[0].merchandise_cents,9000);
  await assert.rejects(dispatchCheckoutTool({name:'execute_purchase',args:{quoteId:randomUUID(),cardId:'wallet-a'}},context,{service:f.service}),{code:'AMOUNT_LIMIT_EXCEEDED'});
  assert.equal(f.provider.calls.length,0);
  assert.equal((await f.service.getStatus(f.principal,intent.id)).state,'blocked');
  assert.equal((await f.repository.query('SELECT id FROM pp_checkout_attempts')).rows.length,0);
  const next=await f.prepare();
  assert.equal((await f.service.readCart(next.context)).totalCents,10400);
  assert.equal((await f.repository.getIntent(f.principal,next.intent.id)).scenario,undefined);
});

test('scenario arming is subject scoped and preview replay cannot consume the next scenario',async t=>{
  const f=await fixture();t.after(f.close);const demo=controls(f);
  const bob={subjectKey:`portal:${randomUUID()}`,sessionDigest:'bob-digest'};
  await f.repository.ensureSubject(bob);
  const listing=await f.merchant.listProducts(bob);
  const snapshot=await f.merchant.previewCart(bob,{sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:listing.destinations[0].id});
  const p=await f.repository.createPreview(bob,{...snapshot,eligibleCardIds:['bob-card']});
  await demo.arm({subjectKey:f.principal.subjectKey,scenario:'prompt-injection'});
  const other=await f.repository.authorizePreview(bob,{previewId:p.id,maxAmountCents:11000});
  assert.equal(other.scenario,undefined);
  const first=await f.prepare();
  const cart=await f.service.readCart(first.context);
  assert.match(cart.description,/charge \$1,000/);assert.equal(cart.totalCents,10400);
  await demo.arm({subjectKey:f.principal.subjectKey,scenario:'price-increase'});
  const replay=await f.service.authorize(f.principal,{previewId:first.preview.id,maxAmountCents:11000,approved:true});
  assert.equal(replay.id,first.intent.id);
  assert.match((await f.service.readCart(first.context)).description,/charge \$1,000/);
  assert.equal((await f.repository.query('SELECT name FROM pp_checkout_demo_scenarios WHERE subject_key=$1',[f.principal.subjectKey])).rows[0].name,'price-increase');
  await demo.clear({subjectKey:f.principal.subjectKey});
  assert.equal((await f.repository.query('SELECT name FROM pp_checkout_demo_scenarios WHERE subject_key=$1',[f.principal.subjectKey])).rows.length,0);
});

test('prompt injection cannot amend the permission and timeout recovery retains one original payment',async t=>{
  const f=await fixture();t.after(f.close);await controls(f).arm({subjectKey:f.principal.subjectKey,scenario:'prompt-injection'});
  const {context}=await f.prepare();
  await assert.rejects(dispatchCheckoutTool({name:'execute_purchase',args:{quoteId:'malicious',cardId:'wallet-a',amount:100000}},context,{service:f.service}),{code:'INVALID_AGENT_TOOL'});
  const quote=await f.service.rankCards(context);assert.equal(quote.cart.totalCents,10400);
  f.provider.timeout=true;
  assert.equal((await f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'})).state,'payment_pending');
  f.advance(6000);const recovered=await f.service.reconcile(context.intentId);
  assert.equal(recovered.state,'confirmed');assert.equal(recovered.order.paymentId,'pi_1');
  assert.equal(f.provider.payments.size,1);assert.equal(new Set(f.provider.calls.map(call=>call.idempotencyKey)).size,1);
  const replay=await f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'});
  assert.equal(replay.order.orderId,recovered.order.orderId);
  assert.equal((await f.repository.query('SELECT id FROM pp_checkout_orders')).rows.length,1);
});

test('disabled runtime leaves a persisted arm untouched and never applies it',async t=>{
  const f=await fixture();t.after(f.close);await controls(f).arm({subjectKey:f.principal.subjectKey,scenario:'price-increase'});
  const {createCheckoutRepository}=await import('../src/checkout-repository.js');
  const plain=createCheckoutRepository({pool:f.pool,now:f.now});
  const listing=await f.merchant.listProducts(f.principal),snapshot=await f.merchant.previewCart(f.principal,{sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:listing.destinations[0].id});
  const p=await plain.createPreview(f.principal,{...snapshot,eligibleCardIds:['wallet-a']});
  const intent=await plain.authorizePreview(f.principal,{previewId:p.id,maxAmountCents:11000});
  assert.equal(intent.scenario,undefined);assert.equal((await f.merchant.readCart(intent)).totalCents,10400);
  assert.equal((await plain.query('SELECT name FROM pp_checkout_demo_scenarios')).rows.length,1);
});

test('public checkout routes have no presenter controls and reject scenario overrides',async t=>{
  const f=await fixture();t.after(f.close);
  const routes=createCheckoutRoutes({service:f.service,merchant:f.merchant,provider:f.provider,resolvePrincipal:()=>f.principal,capabilities:()=>({}),origin:config.origin});
  const request=async(path,body)=>{
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{url:'/api/v1/agent-checkout'+path,method:'POST',headers:{host:'localhost:3000',origin:config.origin,'content-type':'application/json'}});
    let status,result;const res={writeHead:value=>{status=value;},end:value=>{result=JSON.parse(value);}};
    await routes.handle(req,res);return{status,result};
  };
  assert.equal((await request('/demo/arm',{subjectKey:f.principal.subjectKey,scenario:'price-increase'})).status,404);
  assert.equal((await request('/intents',{previewId:'preview',maxAmountCents:11000,approved:true,scenario:'price-increase'})).status,400);
  assert.equal((await f.repository.query('SELECT name FROM pp_checkout_demo_scenarios')).rows.length,0);
});

test('verification without Stripe keys writes a redacted blocked report and does not claim acceptance',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'perkpilot-checkout-verification-'));
  const reportPath=join(directory,'verification.json');
  const env={...process.env,STRIPE_SECRET_KEY:'',STRIPE_PUBLISHABLE_KEY:'',STRIPE_WEBHOOK_SECRET:'',GEMINI_API_KEY:'DO_NOT_PRINT_GEMINI_SECRET',DATABASE_URL:'postgresql://user:DO_NOT_PRINT_DB_SECRET@localhost/demo'};
  const result=spawnSync(process.execPath,['scripts/verify-checkout.js','--report',reportPath],{env,encoding:'utf8'});
  assert.equal(result.status,1);
  const report=JSON.parse(await readFile(reportPath,'utf8'));
  assert.equal(report.acceptanceComplete,false);assert.equal(report.checks.configuration.status,'blocked');
  assert.equal(report.checks.providerAccount.status,'not-run');
  assert.doesNotMatch(JSON.stringify(report)+result.stdout+result.stderr,/DO_NOT_PRINT/);
});

test('configured verification reads existing payment evidence without submitting and rejects mismatched payment IDs',async t=>{
  const f=await fixture();t.after(f.close);const {context}=await f.prepare();const quote=await f.service.rankCards(context);
  await f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'});
  f.provider.verifyAccount=async()=>({accountId:f.provider.accountId,mode:'test'});
  const {collectCheckoutVerification}=await import('../scripts/verify-checkout.js');
  const env={PERKPILOT_CHECKOUT_ENABLED:'1',CHECKOUT_ORIGIN:config.origin,DATABASE_URL:config.databaseUrl,STRIPE_SECRET_KEY:'sk_test_DO_NOT_PRINT',STRIPE_PUBLISHABLE_KEY:'pk_test_DO_NOT_PRINT',STRIPE_EXPECTED_ACCOUNT_ID:f.provider.accountId,STRIPE_WEBHOOK_SECRET:'whsec_DO_NOT_PRINT',GEMINI_API_KEY:'DO_NOT_PRINT',CHECKOUT_VERIFY_SUBJECT:f.principal.subjectKey};
  const options={env,repository:f.repository,provider:f.provider,identity:{auth:{users:[{id:f.principal.userId}]},state:{users:[{id:f.principal.userId,sample:false}]}},fetchImpl:async()=>({ok:true,json:async()=>({steps:[{type:'function_call',name:'checkout_capability_probe',arguments:{}}]})})};
  const report=await collectCheckoutVerification(options);
  assert.equal(report.checks.successfulOrder.status,'verified');assert.equal(report.checks.successfulOrder.paymentId,'pi_1');assert.equal(report.acceptanceComplete,false);
  assert.equal(f.provider.calls.length,1,'verification must never call the payment submit path');
  assert.doesNotMatch(JSON.stringify(report),/DO_NOT_PRINT|pm_|cus_|clientSecret/);
  const lookup=f.provider.getPayment;f.provider.getPayment=async id=>({...await lookup(id),id:'pi_wrong'});
  assert.equal((await collectCheckoutVerification(options)).checks.successfulOrder.status,'not-verified');
});
