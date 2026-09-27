import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createCheckoutRoutes} from '../src/checkout-routes.js';
const principal={subjectKey:'portal:alice',userId:'alice',sessionDigest:'digest'};
async function fixture(fn) {
 const calls=[];let origin,anonymous=false;const view={id:'intent-1',state:'queued',maxAmountCents:11000,events:[],order:null};
 const service={startEnrollment:async(p,b)=>{calls.push(['enroll',p,b]);return{id:'seti_test',clientSecret:'enrollment_secret'};},completeEnrollment:async(p,id)=>({cardId:'card-1'}),listMethods:async()=>[{cardId:'card-1',last4:'4242'}],removeMethod:async()=>({ok:true}),createPreview:async(p,b)=>{calls.push(['preview',p,b]);return{id:'preview-1',cart:{totalCents:10400}};},authorize:async(p,b)=>{calls.push(['authorize',p,b]);return view;},getStatus:async()=>view,getPaymentAction:async()=>({clientSecret:'owner_secret'}),cancel:async()=>({...view,state:'cancelled'}),reconcile:async()=>view,acceptWebhook:async(event)=>{calls.push(['webhook',event]);return{ok:true};}};
 const provider={verifyWebhook:(raw,signature)=>{assert.equal(signature,'valid');assert.equal(Buffer.isBuffer(raw),true);return{id:'evt_1',payment:null};}};
 const merchant={listProducts:async()=>({products:[],destinations:[]})};
 let routes;const server=createServer(async(req,res)=>{const handled=await routes.handleWebhook(req,res) || await routes.handle(req,res);if(!handled){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 routes=createCheckoutRoutes({service,provider,merchant,origin,resolvePrincipal:()=>{if(anonymous)throw Object.assign(new Error('Sign in.'),{code:'REGISTERED_USER_REQUIRED',status:403});return principal;},capabilities:()=>({enabled:true,providerMode:'test'}),onAuthorized:()=>calls.push(['wake'])});
 const request=async(path,method='GET',body,headers={})=>{const response=await fetch(origin+'/api/v1/agent-checkout'+path,{method,headers:{Origin:origin,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
 try{await fn({request,calls,setAnonymous:value=>{anonymous=value;},service});}finally{await new Promise(resolve=>server.close(resolve));}
}
test('checkout routes map enrolled cards, bounded preview and explicit permission to authenticated service',()=>fixture(async({request,calls})=>{
 assert.equal((await request('/capabilities')).data.enabled,true);
 assert.equal((await request('/enrollments','POST',{walletCardId:'card-1',saveConsent:true})).data.clientSecret,'enrollment_secret');
 assert.equal((await request('/enrollments/seti_test/complete','POST',{})).status,200);
 assert.equal((await request('/methods')).data[0].cardId,'card-1');
 assert.equal((await request('/products')).status,200);
 assert.equal((await request('/previews','POST',{sku:'headphones',variantId:'black',quantity:1,destinationId:'test-destination'})).status,201);
 assert.equal((await request('/intents','POST',{previewId:'preview-1',maxAmountCents:11000,approved:true})).status,202);
 assert.equal(calls.find(x=>x[0]==='authorize')[1],principal);assert.equal(calls.some(x=>x[0]==='wake'),true);
 assert.equal((await request('/intents/intent-1')).data.order,null);
 assert.equal((await request('/intents/intent-1/payment-action')).data.clientSecret,'owner_secret');
}));
test('extra payment fields, missing approval, wrong origin and anonymous access never reach service',()=>fixture(async({request,calls,setAnonymous})=>{
 assert.equal((await request('/intents','POST',{previewId:'p',maxAmountCents:11000,approved:true,outcome:'success'})).status,400);
 assert.equal((await request('/intents','POST',{previewId:'p',maxAmountCents:11000,approved:false})).status,400);
 assert.equal((await request('/previews','POST',{sku:'s',variantId:'v',quantity:1,destinationId:'d'},{Origin:'http://evil.test'})).status,403);
 setAnonymous(true);assert.equal((await request('/methods')).status,403);assert.equal(calls.length,0);
}));
test('checkout reads reject extension origins and bearer credentials even with a valid portal cookie',()=>fixture(async({request})=>{
 for(const headers of [{Origin:'chrome-extension://'+'a'.repeat(32)},{Authorization:'Bearer paired-extension-token'},{Origin:'https://evil.test'}]) {
  const result=await request('/intents/intent-1/payment-action','GET',undefined,{Cookie:'perkpilot_session=valid-portal-cookie',...headers});
  assert.equal(result.status,403);assert.equal(JSON.stringify(result.data).includes('owner_secret'),false);
 }
}));
test('checkout JSON parser rejects oversized, malformed and nonobject bodies',()=>fixture(async({request,calls})=>{
 assert.equal((await request('/previews','POST','x'.repeat(16385))).status,413);
 assert.equal((await request('/previews','POST','{')).status,400);
 assert.equal((await request('/previews','POST','[]')).status,400);assert.equal(calls.length,0);
}));
test('identical authorization replay avoids new-intent quota and reconcile is throttled',()=>fixture(async({request})=>{
 const approval={previewId:'same',maxAmountCents:11000,approved:true};for(let i=0;i<5;i++)assert.equal((await request('/intents','POST',approval)).status,202);
 assert.equal((await request('/intents/intent-1/reconcile','POST',{})).status,200);
 assert.equal((await request('/intents/intent-1/reconcile','POST',{})).status,429);
 for(let i=0;i<2;i++)assert.equal((await request('/intents','POST',{...approval,previewId:'new-'+i})).status,202);
 assert.equal((await request('/intents','POST',{...approval,previewId:'excess'})).status,429);
}));
test('only signed raw webhook bypasses origin and session; oversized raw body rejected',()=>fixture(async({request,setAnonymous,calls})=>{
 setAnonymous(true);assert.equal((await request('/webhooks/stripe','POST','{"event":true}',{Origin:'http://evil.test','Stripe-Signature':'valid'})).status,200);assert.equal(calls[0][0],'webhook');
 assert.equal((await request('/webhooks/stripe','POST','x'.repeat(262145),{'Stripe-Signature':'valid'})).status,413);
}));
test('runtime principal binding rejects samples, extension sessions and expired identities',async()=>{
 const {createCheckoutRuntime}=await import('../src/checkout-runtime.js');const id='00000000-0000-4000-8000-000000000001';const session={digest:'digest',userId:id,kind:'portal',expiresAt:2000};
 const auth={data:{users:[{id}],sessions:[session]}};const store={data:{users:[{id,sample:false}],cards:[{id:'card-1',userId:id}]}};
 const repository={query:async(sql,params)=>({rows:[{version:params?.[0] || 1}]}),listRecoverable:async()=>[],transaction:async fn=>fn({query:async()=>({rows:[]})})};
 const runtime=await createCheckoutRuntime({auth,store,provider:{accountId:'acct_test',publishableKey:'pk_test_fixture',verifyAccount:async()=>({id:'acct_test'})},now:()=>1000,config:{enabled:true,origin:'http://localhost:3000',repository,merchant:{},service:{revokeSession:async()=>({ok:true})},agent:{configured:true,model:'test',run:async()=>({state:'confirmed'})}}});
 const p=runtime.resolvePrincipal(session);assert.equal(p.subjectKey,'portal:'+id);assert.equal(runtime.authAdapter.isSessionActive(p),true);assert.equal(runtime.authAdapter.getWalletCards(p).length,1);
 assert.throws(()=>runtime.resolvePrincipal({...session,kind:'extension'}),{code:'REGISTERED_USER_REQUIRED'});
 store.data.users[0].sample=true;assert.throws(()=>runtime.resolvePrincipal(session),{code:'REGISTERED_USER_REQUIRED'});store.data.users[0].sample=false;
 session.expiresAt=999;assert.equal(runtime.authAdapter.isSessionActive(p),false);await runtime.close();
});
test('disabled checkout runtime needs no database or provider and rejects nonloopback enabled origins',async()=>{
 const {createCheckoutRuntime}=await import('../src/checkout-runtime.js');const disabled=await createCheckoutRuntime({config:{enabled:false}});assert.equal(disabled.capabilities().enabled,false);await disabled.start();await disabled.close();
 await assert.rejects(createCheckoutRuntime({config:{enabled:true,origin:'https://public.example'}}),{code:'INVALID_CHECKOUT_ORIGIN'});
});
test('reload lists only service-owned intents and strips internal bindings from ordinary views',()=>fixture(async({request,service})=>{
 service.listIntents=async()=>[{id:'intent-1',state:'confirmed',sessionDigest:'secret',customerId:'cus_secret',clientSecret:'secret',order:{paymentId:'pi_public'}}];
 const response=await request('/intents');assert.equal(response.status,200);assert.equal(response.data[0].id,'intent-1');assert.equal(JSON.stringify(response.data).includes('secret'),false);
}));
test('runtime starts queued tools and reconciles dispatched payments without an agent rerun',async()=>{
 const {createCheckoutRuntime}=await import('../src/checkout-runtime.js');const id='00000000-0000-4000-8000-000000000001';const session={digest:'digest',userId:id,kind:'portal',expiresAt:999999};
 let signalComplete;const complete=new Promise(resolve=>{signalComplete=resolve;});const seen=[];
 const repository={query:async(sql,params)=>({rows:[{version:params?.[0] || 1}]}),listRecoverable:async()=>[{id:'queued',state:'queued',sessionDigest:'digest',expiresAt:999999},{id:'pending',state:'payment_pending'}],claimRun:async(intentId)=>({id:intentId}),renewRun:async()=>true};
 const runtime=await createCheckoutRuntime({auth:{data:{users:[{id}],sessions:[session]}},store:{data:{users:[{id,sample:false}],cards:[]}},provider:{accountId:'acct_test',verifyAccount:async()=>({id:'acct_test'})},now:()=>1000,config:{enabled:true,origin:'http://localhost:3000',repository,merchant:{},service:{maintenance:async()=>seen.push('maintenance'),reconcile:async intentId=>{seen.push('reconcile:'+intentId);signalComplete();},markAgentFailed:async()=>{throw new Error('Unexpected agent failure');}},agent:{configured:true,model:'test',run:async context=>{seen.push('agent:'+context.intentId);}}}});
 await runtime.start();await complete;await runtime.close();assert.deepEqual(seen,['maintenance','agent:queued','reconcile:pending']);
});
test('preflight without keys reports setup requirements without database or provider calls',async()=>{
 const {preflightCheckout}=await import('../scripts/preflight-checkout.js');const result=await preflightCheckout({env:{}});assert.equal(result.ready,false);assert.equal(result.database,'unchecked');assert.equal(result.provider,'unchecked');assert.equal(result.missing.includes('STRIPE_SECRET_KEY'),true);
});
test('logout and sample wallet hooks leave ordinary portal flows usable and revoke registered sessions',async()=>{
 const {createCheckoutRuntime}=await import('../src/checkout-runtime.js');const id='00000000-0000-4000-8000-000000000001',sample={digest:'sample',userId:'alex',kind:'portal',expiresAt:2000},session={digest:'digest',userId:id,kind:'portal',expiresAt:2000};let revocations=0;
 const auth={data:{users:[{id}],sessions:[session,sample]},lookup:token=>token==='registered'?session:token==='sample'?sample:null};
 const runtime=await createCheckoutRuntime({auth,store:{data:{users:[{id,sample:false},{id:'alex',sample:true}],cards:[]}},provider:{accountId:'acct_test'},now:()=>1000,config:{enabled:true,origin:'http://localhost:3000',repository:{},merchant:{},service:{revokeSession:async()=>{revocations++;},listMethods:async()=>[]},agent:{configured:true}}});
 await runtime.beforeLogout({headers:{}});await runtime.beforeLogout({headers:{cookie:'perkpilot_session=sample'}});await runtime.beforeWalletRemove({headers:{cookie:'perkpilot_session=sample'}},'sample-card');assert.equal(revocations,0);
 await runtime.beforeLogout({headers:{cookie:'perkpilot_session=registered'}});assert.equal(revocations,1);await runtime.close();
});


test('catalog import accepts only a server-issued reference and projects safe source metadata',()=>fixture(async({request,service,calls})=>{
 service.importCatalogProduct=async(owner,body)=>{calls.push(['catalog',owner,body]);return{product:{sku:'explore-snapshot',name:'Observed headphones',sourceMerchantName:'Retailer',sourceUrl:'https://example.test/item',sourceLabel:'Sandbox copy of observed listing',observedAt:'2026-09-27T12:00:00Z',ownerSubjectKey:'private-owner',sessionDigest:'private-session'},destinations:[{id:'destination'}]};};
 const reference='11111111-1111-4111-8111-111111111111';
 const response=await request('/catalog-products','POST',{checkoutReference:reference});
 assert.equal(response.status,201);assert.equal(response.data.product.name,'Observed headphones');assert.equal(response.data.product.sourceMerchantName,'Retailer');assert.equal(response.data.product.sourceUrl,'https://example.test/item');assert.equal(JSON.stringify(response.data).includes('private-'),false);
 assert.equal(calls[0][1],principal);assert.deepEqual(calls[0][2],{checkoutReference:reference});
 for(const body of [{checkoutReference:reference,priceCents:1},{checkoutReference:reference,merchantId:'real-retailer'},{checkoutReference:'not-a-reference'},{}])assert.equal((await request('/catalog-products','POST',body)).status,400);
 assert.equal(calls.length,1);
}));

test('opening Explore products has a separate bounded browsing quota from purchase approvals',()=>fixture(async({request,service})=>{
 service.importCatalogProduct=async()=>({product:{sku:'selected',variantId:'sandbox'},destinations:[]});
 const selection={checkoutReference:'11111111-1111-4111-8111-111111111111'};
 for(let i=0;i<20;i++)assert.equal((await request('/catalog-products','POST',selection)).status,201);
 assert.equal((await request('/catalog-products','POST',selection)).status,429);
 assert.equal((await request('/previews','POST',{sku:'selected',variantId:'sandbox',quantity:1,destinationId:'destination'})).status,201);
}));
