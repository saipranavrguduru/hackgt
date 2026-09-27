import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {newDb} from 'pg-mem';
import {createDatabase} from '../src/connected-db.js';
import {createIntegratedApplication} from '../src/integrated-server.js';

const origin='https://perkpilot.example';
function application(memory){
  const {Pool}=memory.adapters.createPg();
  return createIntegratedApplication({origin,portalStorage:'postgres',demoOptions:{persist:false},connectedOptions:{
    db:createDatabase(null,new Pool()),plaidOptions:{clientId:'',secret:''},aiOptions:{apiKey:'',geminiApiKey:''},
    serpapiOptions:{apiKey:''},ebayOptions:{clientId:'',clientSecret:''},shopifyOptions:{storeDomain:'',token:''}
  }});
}
async function request(app,path,method='GET',body,cookie=''){
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
  Object.assign(req,{url:path,method,headers:{host:'perkpilot.example',origin,cookie,...(body?{'content-type':'application/json'}:{})},socket:{encrypted:false,remoteAddress:'127.0.0.1'}});
  const res={headers:{},writableEnded:false,statusCode:200,setHeader(name,value){this.headers[name.toLowerCase()]=value;},getHeader(name){return this.headers[name.toLowerCase()];},writeHead(status,headers={}){this.statusCode=status;for(const [k,v] of Object.entries(headers))this.setHeader(k,v);},end(body){this.body=JSON.parse(body);this.writableEnded=true;}};
  await app.server.listeners('request')[0](req,res);
  return {...res,cookie:res.headers['set-cookie']?.split(';')[0]};
}

test('hosted portal registration and session survive app recreation without local files',async()=>{
  const memory=newDb({noAstCoverageCheck:true}),first=application(memory);await first.migrate();
  let registered,cardId;
  try {
    assert.ok(first.portalPersistence,'hosted mode must attach durable portal storage');
    registered=await request(first,'/api/v1/auth/register','POST',{name:'Hosted user',email:'persist@example.test',password:'persistent-test-password'});
    assert.equal(registered.statusCode,201);
    assert.match(registered.headers['set-cookie'],/Secure/);
    assert.equal(first.demo.auth.path,null);assert.equal(first.demo.store.path,null);
    const card=await request(first,'/api/v1/finance/cards','POST',{productId:'active-cash'},registered.cookie);
    assert.equal(card.statusCode,201);cardId=card.body.id;
    const purchase=await request(first,'/api/v1/rewards/card-purchases','POST',{requestId:randomUUID(),cardId,category:'other',placeName:'Hosted test shop',amountCents:5000},registered.cookie);
    assert.equal(purchase.statusCode,201);
  }finally{await first.close();}
  const second=application(memory);await second.migrate();
  try {
    const session=await request(second,'/api/v1/auth/session','GET',undefined,registered.cookie);
    assert.equal(session.body.user.id,registered.body.user.id);
    const login=await request(second,'/api/v1/auth/login','POST',{email:'persist@example.test',password:'persistent-test-password'});
    assert.equal(login.statusCode,200);assert.equal(login.body.user.id,registered.body.user.id);
    const connected=await request(second,'/api/auth/session','GET',undefined,login.cookie);
    assert.equal(connected.body.user.email,'persist@example.test');
    const cards=await request(second,'/api/v1/finance/cards','GET',undefined,login.cookie);
    assert.equal(cards.body[0].id,cardId);
    const savings=await request(second,'/api/v1/rewards/summary','GET',undefined,login.cookie);
    assert.equal(savings.body.trackedTotalCents,100);
  }finally{await second.close();}
});

test('separate hosted instances reload accounts and logout before serving requests',async()=>{
  const memory=newDb({noAstCoverageCheck:true}),first=application(memory),second=application(memory);
  await first.migrate();await second.migrate();
  try {
    const registered=await request(first,'/api/v1/auth/register','POST',{name:'Shared user',email:'shared@example.test',password:'shared-test-password'});
    assert.equal(registered.statusCode,201);
    assert.equal((await request(second,'/api/v1/auth/session','GET',undefined,registered.cookie)).body.user?.id,registered.body.user.id);
    const logout=await request(second,'/api/v1/auth/logout','POST',{},registered.cookie);assert.equal(logout.statusCode,200);
    assert.equal((await request(first,'/api/v1/auth/session','GET',undefined,registered.cookie)).body.user,null);
  }finally{await first.close();await second.close();}
});

test('plain and encoded dot API paths persist registrations and sessions across restart',async()=>{
  const memory=newDb({noAstCoverageCheck:true}),first=application(memory);await first.migrate();
  const registrations=[];
  try{
    for(const [index,path] of ['/unused/../api/v1/auth/register','/outside/%2e%2e/api/v1/auth/register','/%2e/api/v1/auth/register'].entries()){
      const registered=await request(first,path,'POST',{name:'Normalized path user',email:`normalized-${index}@example.test`,password:'normalized-test-password'});
      assert.equal(registered.statusCode,201,path);assert.ok(registered.cookie,path);
      registrations.push(registered);
      assert.equal((await first.portalPersistence.readSnapshot()).auth.users.length,index+1);
    }
  }finally{await first.close();}
  const restarted=application(memory);await restarted.migrate();
  try{
    for(const registered of registrations){
      const session=await request(restarted,'/api/v1/auth/session','GET',undefined,registered.cookie);
      assert.equal(session.body.user?.id,registered.body.user.id);
    }
    const connected=await request(restarted,'/outside/../api/auth/session','GET',undefined,registrations[0].cookie);
    assert.equal(connected.body.user.email,registrations[0].body.user.email);
  }finally{await restarted.close();}
});
