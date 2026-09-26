import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { newDb } from 'pg-mem';
import { createDatabase } from '../src/connected-db.js';
import { createPlaidClient, encryptToken, decryptToken, normalizePlaidTransaction } from '../src/plaid.js';
import { createConnectedAI } from '../src/connected-ai.js';
import { createSerpApiClient } from '../src/serpapi.js';
import { createShoppingLocationResolver } from '../src/geocoder.js';
import { createEbayClient } from '../src/ebay.js';
import { createConnectedApplication } from '../src/connected-server.js';

test('Plaid token encryption and transaction mapping preserve provider identity', () => {
  const key = randomBytes(32).toString('base64');
  const cipher = encryptToken('access-sandbox-secret', key);
  assert.notEqual(cipher, 'access-sandbox-secret');
  assert.equal(decryptToken(cipher, key), 'access-sandbox-secret');
  assert.throws(() => decryptToken(cipher, randomBytes(32).toString('base64')));
  const tx = normalizePlaidTransaction({ transaction_id:'t1', account_id:'a1', amount:12.34, iso_currency_code:'USD', pending:false, date:'2026-09-26', merchant_name:'Coffee Shop', personal_finance_category:{primary:'FOOD_AND_DRINK'} }, 'user-1');
  assert.equal(tx.id, 'plaid:t1');
  assert.equal(tx.amountCents, 1234);
  assert.equal(tx.kind, 'purchase');
  assert.equal(tx.provenance, 'plaid');
});

test('Plaid requests use sandbox and never return a fake success', async () => {
  const calls = [];
  const plaid = createPlaidClient({clientId:'id',secret:'secret',environment:'sandbox',fetchImpl:async (url, init) => {
    calls.push({url,body:JSON.parse(init.body)});
    return {ok:true,json:async()=>({link_token:'link-sandbox'})};
  }});
  const response = await plaid.createLinkToken('user-1');
  assert.equal(response.link_token, 'link-sandbox');
  assert.equal(calls[0].url, 'https://sandbox.plaid.com/link/token/create');
  assert.deepEqual(calls[0].body.products, ['transactions']);
  await assert.rejects(() => createPlaidClient({}).createLinkToken('user-1'), /not configured/);
});

test('connected database stores transaction and cursor atomically and removes posted replacement', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = createDatabase(null, new Pool());
  await db.migrate();
  const userId = randomUUID(), itemId = randomUUID();
  await db.query('INSERT INTO connected_users(id,email,name,password_salt,password_hash) VALUES($1,$2,$3,$4,$5)', [userId,'test@example.com','Test','salt','hash']);
  await db.query('INSERT INTO plaid_items(id,user_id,provider_item_id,token_ciphertext) VALUES($1,$2,$3,$4)', [itemId,userId,'item-1','encrypted']);
  const item = {id:itemId,user_id:userId};
  const pending = {id:'plaid:pending',userId,accountId:'plaid:account',merchantName:'Shop',category:'shopping',amountCents:1000,status:'pending',kind:'purchase',postedAt:'2026-09-26T12:00:00Z'};
  await db.saveSync(item, [], {updated:[pending],removedIds:[]}, 'cursor-1');
  const posted = {...pending,id:'plaid:posted',status:'posted',replacesTransactionId:'plaid:pending'};
  await db.saveSync(item, [], {updated:[posted],removedIds:[]}, 'cursor-2');
  const rows = await db.query('SELECT id FROM connected_transactions WHERE user_id=$1', [userId]);
  assert.deepEqual(rows.rows.map(x=>x.id), ['plaid:posted']);
  assert.equal((await db.query('SELECT cursor FROM plaid_items WHERE id=$1',[itemId])).rows[0].cursor,'cursor-2');
  await db.close();
});

test('live catalog and AI paths use providers with labeled results', async () => {
  const requests = [];
  const ebay = createEbayClient({clientId:'id',clientSecret:'secret',fetchImpl:async (url, init) => {
    requests.push(String(url));
    if (String(url).includes('/oauth2/token')) return {ok:true,json:async()=>({access_token:'token',expires_in:3600})};
    return {ok:true,json:async()=>({itemSummaries:[{itemId:'123',title:'Headphones',itemWebUrl:'https://www.ebay.com/itm/123',price:{value:'39.99',currency:'USD'},seller:{username:'seller'}}]})};
  }});
  const products = await ebay.search('headphones');
  assert.equal(products.products[0].priceCents,3999);
  assert.equal(products.products[0].taxCents,null);
  assert.equal(requests.length,2);
  const model = createConnectedAI({apiKey:'test-key',fetchImpl:async (_url, init) => {
    const request=JSON.parse(init.body);
    assert.equal(request.store,false);
    assert.equal(request.input.includes('account credentials'),false);
    return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:'Your coffee spending is frequent.'}]}]})};
  }});
  assert.equal((await model.ask('What patterns?',{asOf:null,merchants:[]})).mode,'model');
  const gemini = createConnectedAI({provider:'gemini',geminiApiKey:'gemini-test-key',fetchImpl:async (url, init) => {
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(init.headers['x-goog-api-key'],'gemini-test-key');
    const request=JSON.parse(init.body);
    assert.equal(request.store,false);
    assert.equal(request.model,'gemini-3.8-flash');
    assert.equal(request.generation_config.thinking_level,'low');
    assert.equal(JSON.parse(request.input).question,'What patterns?');
    return {ok:true,json:async()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Coffee spending is frequent.'}]}]})};
  }});
  assert.equal((await gemini.ask('What patterns?',{asOf:null,merchants:[]})).source,'Google Gemini Interactions API');
  await assert.rejects(() => createConnectedAI({provider:'gemini',geminiApiKey:''}).ask('Hello',{}), /GEMINI_API_KEY/);
});

test('SerpApi normalizes live USD Google Shopping results and caches identical searches', async () => {
  const requests = [];
  const catalog = createSerpApiClient({apiKey:'serp-test-key',location:'Gainesville, Florida, United States',fetchImpl:async url => {
    const parsed = new URL(url); requests.push(parsed);
    assert.equal(parsed.origin,'https://serpapi.com');
    assert.equal(parsed.searchParams.get('engine'),'google_shopping');
    assert.equal(parsed.searchParams.get('api_key'),'serp-test-key');
    assert.equal(parsed.searchParams.get('location'), requests.length === 1 ? 'Gainesville, Florida, United States' : 'Orlando, Florida, United States');
    return {ok:true,status:200,json:async()=>({shopping_results:[
      {product_id:'google-123',title:'Noise Cancelling Headphones',source:'Best Buy',price:'$249.99',extracted_price:249.99,link:'https://www.bestbuy.com/site/example',rating:4.6,reviews:120,delivery:'Free delivery'},
      {product_id:'non-usd',title:'Euro listing',source:'Store',price:'€10',extracted_price:10,link:'https://example.com/euro'},
      {product_id:'unsafe',title:'Unsafe link',source:'Store',price:'$1',extracted_price:1,link:'javascript:alert(1)'}
    ]})};
  },now:()=>new Date('2026-09-26T18:00:00.000Z')});
  const first = await catalog.search('headphones');
  const second = await catalog.search('HEADPHONES');
  assert.equal(requests.length,1);
  assert.equal(second,first);
  assert.equal(first.source,'SerpApi Google Shopping');
  assert.equal(first.location,'Gainesville, Florida, United States');
  assert.equal(first.products.length,1);
  assert.equal(first.products[0].priceCents,24999);
  assert.equal(first.products[0].merchantName,'Best Buy');
  assert.equal(first.products[0].shippingCents,null);
  assert.equal(first.products[0].observedAt,'2026-09-26T18:00:00.000Z');
  const elsewhere = await catalog.search('headphones', {location:'Orlando, Florida, United States'});
  assert.equal(requests.length,2);
  assert.equal(elsewhere.location,'Orlando, Florida, United States');
  await assert.rejects(() => createSerpApiClient({apiKey:''}).search('headphones'), /not configured/);
});

test('browser coordinates are reverse geocoded once and only a city-level location is returned', async () => {
  const requests = [];
  const resolver = createShoppingLocationResolver({now:()=>2000,fetchImpl:async (url, init) => {
    requests.push({url:new URL(url),init});
    return {ok:true,headers:{get:()=>null},json:async()=>({address:{city:'Gainesville',state:'Florida',country:'United States'}})};
  }});
  const input = {latitude:29.6516,longitude:-82.3248,accuracyMeters:20,consent:true};
  const first = await resolver.locate(input);
  const second = await resolver.locate({...input,latitude:29.65161});
  assert.equal(requests.length,1);
  assert.equal(second,first);
  assert.deepEqual(first,{location:'Gainesville, Florida, United States',source:'OpenStreetMap Nominatim',attributionUrl:'https://www.openstreetmap.org/copyright'});
  assert.equal(requests[0].url.searchParams.get('zoom'),'10');
  assert.equal(requests[0].init.headers['User-Agent'],'PerkPilot/1.0 (user-initiated shopping location)');
  await assert.rejects(() => resolver.locate({...input,consent:false}), /one-time location lookup/);
});

test('connected HTTP journey requires consent and keeps real records separate from fixtures', async () => {
  const memory = newDb(); const { Pool } = memory.adapters.createPg();
  const db = createDatabase(null, new Pool());
  const oldKey = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const plaid = {configured:true,environment:'sandbox',createLinkToken:async()=>({link_token:'link-test'}),
    exchange:async()=>({access_token:'access-test',item_id:'item-test'}),
    sync:async()=>({added:[{transaction_id:'tx-1',account_id:'account-1',amount:24.5,iso_currency_code:'USD',pending:false,date:'2026-09-26',merchant_name:'Coffee Shop',personal_finance_category:{primary:'FOOD_AND_DRINK'}}],modified:[],removed:[],next_cursor:'cursor-test',has_more:false}),
    accounts:async()=>({accounts:[{account_id:'account-1',name:'Checking',type:'depository',balances:{current:125,iso_currency_code:'USD'}}]}),remove:async()=>({})};
  const port = 34000 + Math.floor(Math.random() * 20000);
  const app = createConnectedApplication({db,plaid,ai:{configured:true,model:'test',ask:async()=>({answer:'Coffee is frequent.',mode:'model'})},serpapi:{configured:false},ebay:{configured:false},locationResolver:{locate:async()=>({location:'Gainesville, Florida, United States',source:'OpenStreetMap Nominatim'})},origin:`http://localhost:${port}`});
  await app.migrate();
  await new Promise(resolve=>app.server.listen(port,'0.0.0.0',resolve));
  let cookie='';
  async function request(path, method='GET', body) {
    const response=await fetch(`http://localhost:${port}/api${path}`,{method,headers:{Origin:`http://localhost:${port}`,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:await response.json()};
  }
  try {
    const registration = await request('/auth/register','POST',{name:'Connected Tester',email:'connected@example.com',password:'long-enough-password',shoppingLocation:'Atlanta, Georgia, United States'});
    assert.equal(registration.status,201);
    assert.equal(registration.data.user.shoppingLocation,'Atlanta, Georgia, United States');
    assert.equal((await request('/profile/location','PATCH',{location:'Orlando, Florida, United States'})).data.location,'Orlando, Florida, United States');
    assert.equal((await request('/dashboard')).data.user.shoppingLocation,'Orlando, Florida, United States');
    assert.equal((await request('/profile/location/locate','POST',{latitude:29.65,longitude:-82.32,accuracyMeters:25,consent:true})).data.location,'Gainesville, Florida, United States');
    assert.equal((await request('/dashboard')).data.user.shoppingLocation,'Gainesville, Florida, United States');
    assert.equal((await request('/plaid/link-token','POST',{})).status,403);
    assert.equal((await request('/consent','POST',{consent:true})).status,200);
    assert.equal((await request('/plaid/link-token','POST',{})).data.linkToken,'link-test');
    assert.equal((await request('/plaid/exchange','POST',{publicToken:'public-test'})).status,201);
    const dashboard=await request('/dashboard');
    assert.equal(dashboard.data.profile.transactionCount,1);
    assert.equal(dashboard.data.transactions[0].provenance,'plaid');
    assert.equal(dashboard.data.profile.merchants[0].name,'Coffee Shop');
    assert.equal((await request('/assistant','POST',{message:'What patterns?'})).data.mode,'model');
    assert.equal((await request('/products?q=headphones')).status,503);
  } finally {
    await new Promise(resolve=>app.server.close(resolve)); await db.close();
    if(oldKey===undefined)delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;else process.env.PLAID_TOKEN_ENCRYPTION_KEY=oldKey;
  }
});
