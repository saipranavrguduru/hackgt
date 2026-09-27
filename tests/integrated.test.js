import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createDatabase } from '../src/connected-db.js';
import { createIntegratedApplication } from '../src/integrated-server.js';
import { randomBytes,randomUUID } from 'node:crypto';
import { encryptToken } from '../src/plaid.js';

test('one origin serves the original portal and connected provider APIs', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = createDatabase(null, new Pool());
  const port = 36000 + Math.floor(Math.random() * 10000);
  const app = createIntegratedApplication({
    port,
    storePort:port + 1,
    demoOptions:{persist:false},
    connectedOptions:{
      db,
      plaid:{configured:true,environment:'sandbox'},
      ai:{configured:true},
      serpapi:{configured:false},
      ebay:{configured:false},
      shopify:{configured:false}
    }
  });
  await app.migrate();
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  try {
    const portal = await fetch(`http://localhost:${port}/`);
    assert.equal(portal.status,200);
    assert.match(await portal.text(), /connected-ui\.js/);
    const demoHealth = await fetch(`http://localhost:${port}/api/v1/health`).then(response=>response.json());
    assert.equal(demoHealth.synthetic,true);
    const connectedHealth = await fetch(`http://localhost:${port}/api/health`).then(response=>response.json());
    assert.deepEqual(connectedHealth,{database:'ready',plaid:'sandbox',ai:true,catalog:'unconfigured'});
  } finally {
    await new Promise(resolve=>app.server.close(resolve));
    await db.close();
  }
});

async function integratedFixture(run,connectedOptions={}) {
  const { Pool } = newDb().adapters.createPg();
  const db = createDatabase(null, new Pool());
  const port = 36000 + Math.floor(Math.random() * 10000);
  const app = createIntegratedApplication({port,storePort:port+1,demoOptions:{persist:false},connectedOptions:{db,
    plaidOptions:{clientId:'',secret:''},aiOptions:{apiKey:'',geminiApiKey:''},serpapiOptions:{apiKey:''},
    ebayOptions:{clientId:'',clientSecret:''},shopifyOptions:{storeDomain:'',token:''},...connectedOptions}});
  await app.migrate();
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  const request = async (path, method='GET', body, cookie='') => {
    const response = await fetch(`http://localhost:${port}${path}`,{method,headers:{Origin:`http://localhost:${port}`,Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  try { await run({app,db,request}); }
  finally { await new Promise(resolve=>app.server.close(resolve));await db.close(); }
}

test('registered portal session securely opens its own connected workspace without a second login', async()=>{
  await integratedFixture(async({request})=>{
    const registered=await request('/api/v1/auth/register','POST',{name:'Portal Person',email:'portal@example.test',password:'portal-password-2026'});
    const session=await request('/api/auth/session','GET',undefined,registered.cookie);
    assert.equal(session.status,200);
    assert.ok(session.body.user,'the valid portal session must authorize connected services');
    assert.equal(session.body.user.email,'portal@example.test');
    assert.equal(session.body.authMode,'portal');
    const dashboard=await request('/api/dashboard','GET',undefined,registered.cookie);
    assert.equal(dashboard.status,200);
    assert.deepEqual(dashboard.body.accounts,[]);
    const consent=await request('/api/consent','POST',{consent:true},registered.cookie);
    assert.equal(consent.status,200);
    assert.equal((await request('/api/dashboard','GET',undefined,registered.cookie)).body.user.consent,true);
    const products=await request('/api/products?q=headphones','GET',undefined,registered.cookie);
    assert.equal(products.status,503);
    assert.equal(products.body.error.code,'PROVIDER_NOT_CONFIGURED');
    const assistant=await request('/api/assistant','POST',{message:'Compare headphones'},registered.cookie);
    assert.equal(assistant.status,503);
    assert.equal(assistant.body.error.code,'AI_NOT_CONFIGURED');
    await request('/api/v1/auth/logout','POST',{},registered.cookie);
    assert.equal((await request('/api/dashboard','GET',undefined,registered.cookie)).status,401);
  });
});

test('portal identity never inherits another live cookie or a matching-email connected profile', async()=>{
  await integratedFixture(async({request,db})=>{
    const live=await request('/api/auth/register','POST',{name:'Existing Connected',email:'same@example.test',password:'connected-password-2026'});
    const itemId='aaaabbbb-cccc-4ddd-8eee-ffffffffffff';
    await db.query('INSERT INTO plaid_items(id,user_id,provider_item_id,token_ciphertext) VALUES($1,$2,$3,$4)',[itemId,live.body.user.id,'private-bank-item','encrypted']);
    await db.query('INSERT INTO connected_accounts(id,user_id,item_id,data) VALUES($1,$2,$3,$4)',['private-account',live.body.user.id,itemId,{name:'Private bank balance',balanceCents:123456}]);
    const portal=await request('/api/v1/auth/register','POST',{name:'Portal Person',email:'same@example.test',password:'different-portal-password'});
    const both=`${portal.cookie}; ${live.cookie}`;
    const dashboard=await request('/api/dashboard','GET',undefined,both);
    assert.equal(dashboard.status,200);
    assert.notEqual(dashboard.body.user.id,live.body.user.id,'email equality must not link accounts');
    assert.deepEqual(dashboard.body.accounts,[],'old live cookie must not disclose its accounts');
    const sample=await request('/api/v1/auth/demo','POST',{userId:'alex'});
    assert.equal((await request('/api/dashboard','GET',undefined,`${sample.cookie}; ${live.cookie}`)).status,401);
    assert.equal((await request('/api/dashboard','GET',undefined,live.cookie)).status,401,'integrated bank data requires current portal identity');
  });
});

test('an existing connected profile binds only after explicit credential proof and cannot bind to two portal users',async()=>{
  await integratedFixture(async({request})=>{
    const live=await request('/api/auth/register','POST',{name:'Existing',email:'legacy@example.test',password:'legacy-password-2026'});
    const portal=await request('/api/v1/auth/register','POST',{name:'Portal',email:'portal@example.test',password:'portal-password-2026'});
    const bad=await request('/api/auth/login','POST',{email:'legacy@example.test',password:'incorrect'},portal.cookie);
    assert.equal(bad.status,401);
    const before=await request('/api/auth/session','GET',undefined,portal.cookie);
    assert.ok(before.body.user,'portal identity creates an isolated workspace before any legacy link');
    assert.notEqual(before.body.user.id,live.body.user.id);
    const linked=await request('/api/auth/login','POST',{email:'legacy@example.test',password:'legacy-password-2026'},portal.cookie);
    assert.equal(linked.status,200);
    assert.equal((await request('/api/auth/session','GET',undefined,portal.cookie)).body.user.id,live.body.user.id);
    const second=await request('/api/v1/auth/register','POST',{name:'Other',email:'other@example.test',password:'other-password-2026'});
    const denied=await request('/api/auth/login','POST',{email:'legacy@example.test',password:'legacy-password-2026'},second.cookie);
    assert.equal(denied.status,409);
  });
});

async function bankRecords(db,userId,label,key) {
  const itemId=randomUUID();
  await db.query('UPDATE connected_users SET consent=true WHERE id=$1',[userId]);
  await db.query('INSERT INTO plaid_items(id,user_id,provider_item_id,token_ciphertext) VALUES($1,$2,$3,$4)',[itemId,userId,`item-${label}`,encryptToken(`token-${label}`,key)]);
  await db.query('INSERT INTO connected_accounts(id,user_id,item_id,data) VALUES($1,$2,$3,$4)',[`account-${label}`,userId,itemId,{name:`Bank ${label}`,balanceCents:123456}]);
  await db.query('INSERT INTO connected_transactions(id,user_id,item_id,data) VALUES($1,$2,$3,$4)',[`transaction-${label}`,userId,itemId,{merchantName:`Merchant ${label}`,status:'posted',kind:'purchase',currency:'USD',amountCents:1000,postedAt:'2026-09-26T00:00:00Z'}]);
}

test('legacy linking preserves populated profiles until explicit clearing and deletion cannot resurrect earlier data',async t=>{
  const priorKey=process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  const key=randomBytes(32).toString('base64');process.env.PLAID_TOKEN_ENCRYPTION_KEY=key;
  t.after(()=>{if(priorKey===undefined)delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;else process.env.PLAID_TOKEN_ENCRYPTION_KEY=priorKey;});
  const removed=[];
  await integratedFixture(async({request,db})=>{
    const legacy=await request('/api/auth/register','POST',{name:'Legacy',email:'legacy-delete@example.test',password:'legacy-password-2026'});
    const portal=await request('/api/v1/auth/register','POST',{name:'Portal',email:'portal-delete@example.test',password:'portal-password-2026'});
    const original=(await request('/api/auth/session','GET',undefined,portal.cookie)).body.user;
    await bankRecords(db,original.id,'original',key);await bankRecords(db,legacy.body.user.id,'legacy',key);
    const credentials={email:'legacy-delete@example.test',password:'legacy-password-2026'};
    const refused=await request('/api/auth/login','POST',credentials,portal.cookie);
    assert.equal(refused.status,409,'linking must not hide the original consent or bank data');
    assert.equal(refused.body.error.code,'CONNECTED_DATA_PRESENT');
    const unchanged=(await request('/api/dashboard','GET',undefined,portal.cookie)).body;
    assert.equal(unchanged.user.id,original.id);assert.equal(unchanged.user.consent,true);assert.equal(unchanged.accounts[0].name,'Bank original');
    assert.equal((await db.query('SELECT id FROM plaid_items WHERE user_id=$1',[legacy.body.user.id])).rows.length,1,'the legacy profile must retain its bank');
    assert.equal((await request('/api/account','DELETE',{},portal.cookie)).status,200);
    const fresh=(await request('/api/dashboard','GET',undefined,portal.cookie)).body;
    assert.equal(fresh.user.consent,false);assert.deepEqual(fresh.accounts,[]);
    assert.equal((await request('/api/auth/login','POST',credentials,portal.cookie)).status,200);
    assert.equal((await db.query('SELECT id FROM connected_users WHERE id=$1',[original.id])).rows.length,0,'empty automatic profile is retired when linking succeeds');
    const linked=(await request('/api/dashboard','GET',undefined,portal.cookie)).body;
    assert.equal(linked.accounts[0].name,'Bank legacy');
    assert.equal((await request('/api/account','DELETE',{},portal.cookie)).status,200);
    const after=(await request('/api/dashboard','GET',undefined,portal.cookie)).body;
    assert.equal(after.user.consent,false);assert.deepEqual(after.accounts,[]);assert.deepEqual(after.transactions,[]);
    assert.deepEqual(removed.sort(),['token-legacy','token-original']);
  },{plaid:{configured:true,environment:'sandbox',remove:async token=>{removed.push(token);}}});
});

test('deleting a previously linked legacy profile also clears its portal-owned orphan without touching another user',async t=>{
  const priorKey=process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  const key=randomBytes(32).toString('base64');process.env.PLAID_TOKEN_ENCRYPTION_KEY=key;
  t.after(()=>{if(priorKey===undefined)delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;else process.env.PLAID_TOKEN_ENCRYPTION_KEY=priorKey;});
  const removed=[];
  await integratedFixture(async({request,db})=>{
    const legacy=await request('/api/auth/register','POST',{name:'Legacy',email:'old-link@example.test',password:'legacy-password-2026'});
    const other=await request('/api/auth/register','POST',{name:'Other',email:'other-bank@example.test',password:'other-password-2026'});
    const portal=await request('/api/v1/auth/register','POST',{name:'Portal',email:'old-portal@example.test',password:'portal-password-2026'});
    const original=(await request('/api/auth/session','GET',undefined,portal.cookie)).body.user;
    await bankRecords(db,original.id,'orphan',key);await bankRecords(db,legacy.body.user.id,'linked',key);await bankRecords(db,other.body.user.id,'other',key);
    // Simulate the pre-fix binding already persisted by an earlier app version.
    await db.query('UPDATE connected_portal_bindings SET user_id=$1 WHERE portal_user_id=$2',[legacy.body.user.id,original.id]);
    assert.equal((await request('/api/account','DELETE',{},portal.cookie)).status,200);
    const fresh=(await request('/api/dashboard','GET',undefined,portal.cookie)).body;
    assert.equal(fresh.user.consent,false,'deleted orphan consent must never reappear');
    assert.deepEqual(fresh.accounts,[]);assert.deepEqual(fresh.transactions,[]);
    assert.equal((await db.query('SELECT id FROM connected_users WHERE id=$1',[legacy.body.user.id])).rows.length,0);
    assert.equal((await db.query('SELECT id FROM plaid_items WHERE user_id=$1',[original.id])).rows.length,0);
    assert.equal((await db.query('SELECT id FROM plaid_items WHERE user_id=$1',[other.body.user.id])).rows.length,1);
    assert.deepEqual(removed.sort(),['token-linked','token-orphan']);
  },{plaid:{configured:true,environment:'sandbox',remove:async token=>{removed.push(token);}}});
});


test('Explore issues checkout references bound to the portal owner and current session',async()=>{
 let clock=1000;
 const listing={id:'catalog-1',name:'Observed headphones',merchantName:'External retailer',priceCents:9999,currency:'USD',availability:'unknown',url:'https://example.test/headphones',observedAt:'2026-09-27T12:00:00Z',source:'Fixture provider'};
 await integratedFixture(async({app,request})=>{
  const registered=await request('/api/v1/auth/register','POST',{name:'Shopper',email:'catalog@example.test',password:'catalog-password-2026'});
  const result=await request('/api/products?q=headphones','GET',undefined,registered.cookie);
  assert.equal(result.status,200);const reference=result.body.products[0].checkoutReference;
  assert.match(reference,/^[0-9a-f-]{36}$/);assert.match(result.body.products[1].checkoutUnavailableReason,/500/);
  assert.equal(result.body.products[1].checkoutReference,undefined);assert.equal(JSON.stringify(result.body).includes('sessionDigest'),false);
  const session=app.demo.auth.lookup(registered.cookie.split('=')[1]);
  const principal={userId:registered.body.user.id,subjectKey:'portal:'+registered.body.user.id,sessionDigest:session.digest};
  const snapshot=app.connected.resolveCatalogReference(principal,reference);
  assert.equal(snapshot.priceCents,9999);listing.priceCents=1;
  assert.equal(app.connected.resolveCatalogReference(principal,reference).priceCents,9999,'provider cache mutation cannot change the observed snapshot');
  assert.throws(()=>app.connected.resolveCatalogReference({...principal,sessionDigest:'other-session'},reference),{code:'CATALOG_REFERENCE_EXPIRED'});
  assert.throws(()=>app.connected.resolveCatalogReference({...principal,subjectKey:'portal:22222222-2222-4222-8222-222222222222'},reference),{code:'CATALOG_REFERENCE_EXPIRED'});
  clock+=15*60*1000;
  assert.throws(()=>app.connected.resolveCatalogReference(principal,reference),{code:'CATALOG_REFERENCE_EXPIRED'});
 },{checkoutCatalogOptions:{now:()=>clock},serpapi:{configured:true,search:async()=>({products:[listing,{...listing,id:'expensive',priceCents:50000}],observedAt:listing.observedAt})}});
});

test('live Explore selection reaches checkout runtime without browser prices or payment enrollment',async()=>{
 const {checkoutFixture}=await import('./helpers/checkout-fixture.js');
 const {createCheckoutRuntime}=await import('../src/checkout-runtime.js');
 const f=await checkoutFixture();
 try{await integratedFixture(async({app,request})=>{
  const runtime=await createCheckoutRuntime({auth:app.demo.auth,store:app.demo.store,provider:f.provider,config:{enabled:true,origin:app.origin,repository:f.repository,merchant:f.merchant,agent:{configured:true},resolveCatalogReference:app.connected.resolveCatalogReference}});
  app.demo.setCheckoutRuntime(runtime);
  try{
   const buyer=await request('/api/v1/auth/register','POST',{name:'Buyer',email:'explore-buyer@example.test',password:'buyer-password-2026'});
   const search=await request('/api/products?q=travel','GET',undefined,buyer.cookie);
   const checkoutReference=search.body.products[0].checkoutReference;
   const imported=await request('/api/v1/agent-checkout/catalog-products','POST',{checkoutReference},buyer.cookie);
   assert.equal(imported.status,201);assert.equal(imported.body.product.name,'Observed travel bag');assert.equal(imported.body.product.merchandiseCents,5000);assert.equal(imported.body.product.taxCents,500);assert.equal(imported.body.product.shippingCents,500);assert.equal(imported.body.destinations.length,1);assert.equal(f.provider.calls.length,0);
   const other=await request('/api/v1/auth/register','POST',{name:'Other Buyer',email:'explore-other@example.test',password:'buyer-password-2026'});
   assert.equal((await request('/api/v1/agent-checkout/catalog-products','POST',{checkoutReference},other.cookie)).status,409);
   const catalog=await request('/api/v1/agent-checkout/products','GET',undefined,other.cookie);
   assert.equal(catalog.body.products.some(p=>p.sku===imported.body.product.sku),false);
  }finally{await runtime.close();}
 },{serpapi:{configured:true,search:async()=>({products:[{id:'bag',name:'Observed travel bag',merchantName:'Observed retailer',priceCents:5000,currency:'USD',url:'https://example.test/bag',availability:'unknown'}]})}});}finally{await f.close();}
});
