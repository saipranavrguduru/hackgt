import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';

const response=()=>({headers:{},statusCode:200,writableEnded:false,
  setHeader(name,value){this.headers[name.toLowerCase()]=value;},
  writeHead(status,headers={}){this.statusCode=status;for(const [name,value] of Object.entries(headers))this.setHeader(name,value);},
  end(body,callback){this.body=body;this.writableEnded=true;callback?.();}
});

const request=(stream,method='POST')=>Object.assign(stream,{url:'/api/v1/auth/login',method,headers:{'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
const readBytes=async req=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks);};

test('an unfinished unauthenticated body does not acquire the snapshot lock or block a GET',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  let queue=Promise.resolve(),lockStarts=0;
  const handler=withPortalPersistence({run:work=>{const run=queue.then(()=>{lockStarts++;return work();});queue=run.catch(()=>{});return run;}},async(req,out)=>{if(req.method==='POST')await readBytes(req);out.end('{"ok":true}');});
  const slow=request(new PassThrough()),slowResponse=response();slow.write('{');
  const pending=handler(slow,slowResponse);
  try {
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(lockStarts,0,'body collection must finish before locking shared account data');
    const getResponse=response();await handler(request(Readable.from([]),'GET'),getResponse);
    assert.equal(getResponse.writableEnded,true);assert.equal(lockStarts,1);
  }finally{slow.end('}');await pending;}
  assert.equal(slowResponse.statusCode,200);assert.equal(lockStarts,2);
});

test('prebuffering forwards exact body bytes and request identity after the original body ends',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  for(const method of ['POST','PATCH','DELETE']){
  const bytes=Buffer.from('{ "name": "café", "amount": 12.0 }\n');
  const original=request(Readable.from([bytes.subarray(0,14),bytes.subarray(14)]),method);
  original.headers.cookie='perkpilot_session=fixture';let seen;
  const handler=withPortalPersistence({run:async work=>{assert.equal(original.readableEnded,true);return work();}},async(req,out)=>{
    seen=await readBytes(req);assert.equal(req.headers,original.headers);assert.equal(req.socket,original.socket);assert.equal(req.url,original.url);assert.equal(req.method,original.method);out.end('{}');
  });
  const res=response();await handler(original,res);
  assert.equal(res.statusCode,200);assert.deepEqual(seen,bytes);
  }
});

test('body timeout closes the request with a sanitized 408 without acquiring storage',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  let locks=0;const req=request(new PassThrough()),res=response();req.write('{');
  const handler=withPortalPersistence({run:async work=>{locks++;return work();}},async(req,out)=>{await readBytes(req);out.setHeader('Set-Cookie','secret');out.end('private');},{bodyTimeoutMs:20});
  const pending=handler(req,res);
  try {
    assert.equal(await Promise.race([pending.then(()=>true),delay(150).then(()=>false)]),true,'incomplete body must time out');
    assert.equal(res.statusCode,408);assert.equal(JSON.parse(res.body).error.code,'REQUEST_TIMEOUT');
    assert.equal(res.headers.connection,'close');assert.equal(res.headers['set-cookie'],undefined);assert.doesNotMatch(res.body,/private|secret/);
    assert.equal(locks,0);assert.equal(req.destroyed,true);
    for(const event of ['data','end','aborted','error','close'])assert.equal(req.listenerCount(event),0,event);
  }finally{req.end('}');await pending;}
});

test('an oversized body is rejected before storage with a closed request and no tentative response',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  let locks=0;const req=request(Readable.from([Buffer.alloc(65537,'x')])),res=response();
  const handler=withPortalPersistence({run:async work=>{locks++;return work();}},async(req,out)=>{await readBytes(req);out.setHeader('Set-Cookie','secret');out.end('private');});
  await handler(req,res);
  assert.equal(res.statusCode,413);assert.equal(JSON.parse(res.body).error.code,'BODY_TOO_LARGE');assert.equal(res.headers.connection,'close');
  assert.equal(locks,0);assert.equal(req.destroyed,true);assert.equal(res.headers['set-cookie'],undefined);assert.doesNotMatch(res.body,/private|secret/);
});

test('aborted body collection settles without opening storage or leaking stream listeners',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  let locks=0;const req=request(new PassThrough()),res=response();
  const handler=withPortalPersistence({run:async work=>{locks++;return work();}},async(req,out)=>{await readBytes(req);out.end('{}');},{bodyTimeoutMs:1000});
  const pending=handler(req,res);req.destroy(new Error('private socket detail'));await pending;
  assert.equal(locks,0);assert.equal(res.statusCode,400);assert.doesNotMatch(res.body,/private socket/);
  for(const event of ['data','end','aborted','error','close'])assert.equal(req.listenerCount(event),0,event);
});

test('prebuffering preserves checkout origin, content-type, JSON and stricter size guards',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  const {createCheckoutRoutes}=await import('../src/checkout-routes.js');
  const origin='https://perkpilot.example';let locks=0,operations=0;
  const routes=createCheckoutRoutes({origin,resolvePrincipal:()=>({subjectKey:'portal:fixture',sessionDigest:'fixture'}),service:{createPreview:()=>{operations++;return{};}}});
  const handler=withPortalPersistence({run:async work=>{locks++;return work();}},routes.handle);
  const cases=[
    {body:'{}',headers:{origin:'https://other.example'},code:'ORIGIN_REJECTED',status:403},
    {body:'{}',headers:{'content-type':'text/plain'},code:'JSON_REQUIRED',status:415},
    {body:'{',code:'INVALID_JSON',status:400},
    {body:JSON.stringify({name:'x'.repeat(17000)}),code:'BODY_TOO_LARGE',status:413}
  ];
  for(const entry of cases){
    const req=request(Readable.from([Buffer.from(entry.body)]));req.url='/api/v1/agent-checkout/previews';
    Object.assign(req.headers,{host:'perkpilot.example',origin,...entry.headers});
    const res=response();await handler(req,res);
    assert.equal(res.statusCode,entry.status);assert.equal(JSON.parse(res.body).error.code,entry.code);
  }
  assert.equal(locks,cases.length);assert.equal(operations,0);
});

test('portal response and cookie are withheld until durable commit completes',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  const res=response();let committed=false;
  const handler=withPortalPersistence({run:async work=>{await work();assert.equal(res.writableEnded,false);assert.deepEqual(res.headers,{});committed=true;}},async(_req,out)=>{
    out.setHeader('Set-Cookie','session=opaque');out.writeHead(201,{'Content-Type':'application/json'});out.end('{"ok":true}');
  });
  await handler({url:'/api/v1/auth/register'},res);
  assert.equal(committed,true);assert.equal(res.statusCode,201);assert.equal(res.headers['set-cookie'],'session=opaque');assert.equal(res.body,'{"ok":true}');
});

test('failed persistence returns 503 without success body or login cookie',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  const res=response();
  const handler=withPortalPersistence({run:async work=>{await work();throw new Error('database secret must stay private');}},async(_req,out)=>{
    out.setHeader('Set-Cookie','session=opaque');out.writeHead(201);out.end('private success');
  });
  await handler({url:'/api/v1/auth/register'},res);
  assert.equal(res.statusCode,503);assert.equal(res.headers['set-cookie'],undefined);
  assert.equal(JSON.parse(res.body).error.code,'PORTAL_STORAGE_UNAVAILABLE');
  assert.doesNotMatch(res.body,/private|secret/);
});

test('application error triggers rollback and cannot publish a tentative cookie',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  const res=response();let rolledBack=false;
  const handler=withPortalPersistence({run:async work=>{try{await work();assert.fail('error response must reject transaction');}catch(error){rolledBack=true;throw error;}}},async(_req,out)=>{
    out.setHeader('Set-Cookie','session=uncommitted');out.writeHead(409);out.end('{"error":{"code":"ACCOUNT_EXISTS"}}');
  });
  await handler({url:'/api/v1/auth/register'},res);
  assert.equal(rolledBack,true);assert.equal(res.statusCode,409);assert.equal(res.headers['set-cookie'],undefined);
});

test('static content, health, and signed Stripe webhook bypass portal snapshot serialization',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  let calls=0;
  const handler=withPortalPersistence({run:()=>assert.fail('unneeded snapshot lock')},async(_req,out)=>{calls++;out.end('ok');});
  for(const url of ['/','/store','/api/health','/api/v1/health','/api/v1/agent-checkout/webhooks/stripe'])await handler({url},response());
  assert.equal(calls,5);
  const webhook=request(new PassThrough());webhook.url='/api/v1/agent-checkout/webhooks/stripe';
  try{await handler(webhook,response());assert.equal(webhook.readableEnded,false);assert.equal(calls,6);}finally{webhook.destroy();}
});

test('an explicitly marked domain decline commits its terminal purchase state',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  const res=response();let committed=false;
  const handler=withPortalPersistence({run:async work=>{await work();committed=true;}},async(_req,out)=>{
    out.commitErrorResponse=true;out.writeHead(402);out.end('{"error":{"code":"PAYMENT_DECLINED"}}');
  });
  await handler({url:'/api/v1/checkout/sessions/fixture/confirm'},res);
  assert.equal(committed,true);assert.equal(res.statusCode,402);
});

test('normalized API paths cannot bypass durable commits or the request queue',async()=>{
  const {withPortalPersistence}=await import('../src/portal-persistence-http.js');
  for(const url of ['/unused/../api/v1/auth/register','/unused/%2e%2e/api/v1/auth/register','/./api/auth/session']){
    let persisted=false;
    const handler=withPortalPersistence({run:async work=>{await work();persisted=true;}},async(_req,out)=>out.end('{"ok":true}'));
    await handler({url},response());assert.equal(persisted,true,url);
  }
});
