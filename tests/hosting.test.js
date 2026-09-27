import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request as httpRequest} from 'node:http';
import {createApplication} from '../src/server.js';

async function serve(t,options={}) {
  const app=createApplication({persist:false,...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  let cookie='';
  const request=async(path,method='GET',body,headers={})=>{
    const response=await new Promise((resolve,reject)=>{
      const req=httpRequest(`http://127.0.0.1:${app.server.address().port}${path}`,{
        method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers}
      },res=>{
        let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);
        res.on('end',()=>resolve({status:res.statusCode,headers:new Headers(res.headers),json:async()=>JSON.parse(text)}));
      });
      req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
    });
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  return {app,request};
}

test('HTTPS deployment sets secure cookies behind a TLS-terminating proxy',async t=>{
  const {request}=await serve(t,{origin:'https://perkpilot.example'});
  const headers={Host:'perkpilot.example',Origin:'https://perkpilot.example'};
  const registered=await request('/api/v1/auth/register','POST',{name:'Hosted user',email:'hosted@example.test',password:'hosted-test-password'},headers);
  assert.equal(registered.status,201);
  assert.match(registered.headers.get('set-cookie'),/; Secure(?:;|$)/);
  assert.match(registered.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const logout=await request('/api/v1/auth/logout','POST',{},headers);
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0; Secure/);
});

test('hosted store and approval links use the configured HTTPS origin',async t=>{
  const {request}=await serve(t,{origin:'https://perkpilot.example'});
  const headers={Host:'perkpilot.example',Origin:'https://perkpilot.example'};
  const products=await request('/api/v1/store/products','GET',undefined,headers);
  assert.equal((await products.json()).portalUrl,'https://perkpilot.example');
  await request('/api/v1/auth/demo','POST',{userId:'alex'},headers);
  const bootstrap=await request('/api/v1/bootstrap','GET',undefined,headers);
  assert.equal((await bootstrap.json()).storeUrl,'https://perkpilot.example');
  const pairing=await request('/api/v1/extension/pairings','POST',{extensionId:'a'.repeat(32)},headers);
  assert.equal(pairing.status,201);
  assert.match((await pairing.json()).approvalUrl,/^https:\/\/perkpilot\.example\/\?pairing=/);
  const store=await request('/store','GET',undefined,headers);
  assert.equal(store.status,200);
});

test('configured durable directory preserves portal identity and wallet across app recreation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'perkpilot-hosting-'));
  const previous=process.env.PERKPILOT_DATA_DIR;
  process.env.PERKPILOT_DATA_DIR=directory;
  try {
    const first=createApplication();
    assert.equal(first.auth.path,join(directory,'auth.json'));
    assert.equal(first.store.path,join(directory,'state.json'));
    const user=first.auth.register({name:'Durable user',email:'durable@example.test',password:'durable-test-password'});
    first.store.data.users.push({...user,sample:false});
    first.store.data.cards.push({id:'retained-wallet-card',userId:user.id});
    first.store.save();
    const second=createApplication();
    assert.equal(second.auth.lookup(second.auth.login(user.email,'durable-test-password')).userId,user.id);
    assert.ok(second.store.data.cards.some(card=>card.id==='retained-wallet-card'&&card.userId===user.id));
  } finally {
    if(previous===undefined)delete process.env.PERKPILOT_DATA_DIR;else process.env.PERKPILOT_DATA_DIR=previous;
    await rm(directory,{recursive:true,force:true});
  }
});
