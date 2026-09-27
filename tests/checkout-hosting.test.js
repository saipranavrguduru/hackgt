import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newDb} from 'pg-mem';
import {createDatabase} from '../src/connected-db.js';
import {createCheckoutRuntime} from '../src/checkout-runtime.js';
import {startCheckoutApplication} from '../scripts/start-checkout.js';
import {preflightCheckout} from '../scripts/preflight-checkout.js';
import {collectCheckoutVerification} from '../scripts/verify-checkout.js';

const userId='11111111-1111-4111-8111-111111111111';
const origin='https://perkpilot.example';
const invalidOrigins=['http://public.example','https://user:password@perkpilot.example','https://perkpilot.example/','https://perkpilot.example/path','https://perkpilot.example?query=1','https://perkpilot.example#fragment','https://PERKPILOT.example','https://perkpilot.example:443','https://perkpilot.example\\path','not an origin'];

async function runtimeAt(value) {
  const session={digest:'fixture-digest',userId,kind:'portal',expiresAt:2000};
  return createCheckoutRuntime({auth:{data:{users:[{id:userId}],sessions:[session]},lookup:token=>token==='fixture-cookie'?session:null},store:{data:{users:[{id:userId,sample:false}],cards:[]}},provider:{accountId:'acct_fixture'},now:()=>1000,
    config:{enabled:true,origin:value,repository:{},merchant:{},agent:{configured:true},service:{createPreview:async()=>({id:'owned-preview',cart:{totalCents:1000}})}}});
}

test('HTTPS checkout accepts same-origin portal requests while keeping host, origin and bearer guards',async t=>{
  const runtime=await runtimeAt(origin);t.after(()=>runtime.close());
  const request=async headers=>{
    const req=Readable.from([Buffer.from(JSON.stringify({sku:'fixture',variantId:'black',quantity:1,destinationId:'fixture-destination'}))]);
    Object.assign(req,{method:'POST',url:'/api/v1/agent-checkout/previews',headers:{host:'perkpilot.example',origin,cookie:'perkpilot_session=fixture-cookie','content-type':'application/json',...headers}});
    let status,body;await runtime.routes.handle(req,{writeHead:value=>{status=value;},end:value=>{body=JSON.parse(value);}});return{status,body};
  };
  const allowed=await request({});assert.equal(allowed.status,201);assert.equal(allowed.body.id,'owned-preview');
  for(const headers of [{host:'other.example'},{origin:'https://other.example'},{origin:undefined},{authorization:'Bearer fixture-cookie'},{'sec-fetch-site':'cross-site'}])assert.equal((await request(headers)).status,403);
});

test('checkout deployment origins reject insecure and noncanonical URL forms before provider setup',async()=>{
  for(const value of invalidOrigins)await assert.rejects(runtimeAt(value),{code:'INVALID_CHECKOUT_ORIGIN'},value);
  for(const value of ['http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000',origin])await (await runtimeAt(value)).close();
});

test('preflight accepts hosted HTTPS configuration without weakening origin validation',async()=>{
  for(const key of ['CHECKOUT_ORIGIN','PUBLIC_ORIGIN','RENDER_EXTERNAL_URL']){
    const result=await preflightCheckout({env:{[key]:origin}});
    assert.equal(result.missing.some(value=>/origin/i.test(value)),false,key);
    assert.equal(result.database,'unchecked');
  }
  for(const value of invalidOrigins){
    const result=await preflightCheckout({env:{CHECKOUT_ORIGIN:value}});
    assert.equal(result.missing.some(value=>/origin/i.test(value)),true,value);
  }
});

test('hosted read-only verifier uses the configured persistent portal directory and rejects unsafe origins',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'perkpilot-hosting-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  await writeFile(join(dataDir,'auth.json'),JSON.stringify({users:[]}));await writeFile(join(dataDir,'state.json'),JSON.stringify({users:[]}));
  const env={PERKPILOT_CHECKOUT_ENABLED:'1',PUBLIC_ORIGIN:origin,PERKPILOT_DATA_DIR:dataDir,DATABASE_URL:'postgresql://fixture@localhost/fixture',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_PUBLISHABLE_KEY:'pk_test_fixture',STRIPE_EXPECTED_ACCOUNT_ID:'acct_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',GEMINI_API_KEY:'fixture',CHECKOUT_VERIFY_SUBJECT:'portal:'+userId};
  const report=await collectCheckoutVerification({env});
  assert.equal(report.checks.configuration.status,'configured');assert.equal(report.checks.configuration.checkoutOrigin,origin);
  assert.equal(report.checks.portalIdentity.code,'REGISTERED_TEST_SUBJECT_REQUIRED');assert.equal(report.checks.database.status,'not-run');
  for(const value of invalidOrigins){const invalid=await collectCheckoutVerification({env:{...env,CHECKOUT_ORIGIN:value}});assert.equal(invalid.checks.configuration.code,'INVALID_TEST_CONFIGURATION',value);}
});

test('checkout startup resolves deployed origins in priority order and binds the public listener',async()=>{
  const keys=['CHECKOUT_ORIGIN','PUBLIC_ORIGIN','RENDER_EXTERNAL_URL','PERKPILOT_CHECKOUT_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const cases=[
    {env:{CHECKOUT_ORIGIN:'https://checkout.example',PUBLIC_ORIGIN:'https://public.example',RENDER_EXTERNAL_URL:'https://render.example'},want:'https://checkout.example'},
    {env:{PUBLIC_ORIGIN:'https://public.example',RENDER_EXTERNAL_URL:'https://render.example'},want:'https://public.example'},
    {env:{RENDER_EXTERNAL_URL:'https://render.example'},want:'https://render.example'},
    {env:{CHECKOUT_ORIGIN:'https://checkout.example'},explicit:'https://explicit.example',want:'https://explicit.example'}
  ];
  try{
    for(const entry of cases){
      for(const key of keys)delete process.env[key];Object.assign(process.env,entry.env,{PERKPILOT_CHECKOUT_ENABLED:'0'});
      const {Pool}=newDb().adapters.createPg();const db=createDatabase(null,new Pool());
      const app=await startCheckoutApplication({port:0,storePort:0,demoOptions:{persist:false},connectedOptions:{db,plaidOptions:{clientId:'',secret:''},aiOptions:{apiKey:'',geminiApiKey:''},serpapiOptions:{apiKey:''},ebayOptions:{clientId:'',clientSecret:''},shopifyOptions:{storeDomain:'',token:''}},checkoutOptions:{config:{enabled:false,...(entry.explicit?{origin:entry.explicit}:{})}}});
      try{assert.equal(app.origin,entry.want);assert.equal(app.server.address().address,'0.0.0.0');assert.equal(app.merchant.address().address,'127.0.0.1');}finally{await app.close();}
    }
  }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
