import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture({sample=false,recommendation={},purchaseHandler,refreshHandler}={}) {
  const requests=[],renders=[];let refreshes=0,uuid=0;
  const state={page:'wallet',data:{user:{id:sample?'alex':'registered-one',sample}}};
  const sheet={open:false,dataset:{},innerHTML:'',scrollTop:0};
  let form={id:'location-form',elements:{category:{value:'other'},placeName:{value:''},amount:{value:''}}};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const App={state,escapeHtml:escape,money:value=>`$${(value/100).toFixed(2)}`,icon:()=>'',empty:(title,body,action)=>`<h3>${title}</h3><p>${body}</p>${action}`,button:(label,action)=>`<button data-action="${action}">${label}</button>`,renderShell:()=>{},closeSheet:()=>{sheet.open=false;}};
  App.showSheet=(title,body,options)=>{
    sheet.open=true;sheet.dataset.owner=options.owner;sheet.innerHTML=body;renders.push(body);
    form={id:'location-form',elements:{category:{value:body.match(/<option value="([^"]+)" selected/)?.[1]||'other'},placeName:{value:body.match(/name="placeName"[^>]*value="([^"]*)"/)?.[1]||''},amount:{value:body.match(/name="amount"[^>]*value="([^"]*)"/)?.[1]||''}}};
  };
  App.api=async(path,method,body)=>{
    requests.push({path,method,body});
    if(path==='/location/recommendations')return {category:body.category,categoryLabel:body.category==='dining'?'Dining':'Other / unsure',placeName:body.placeName||'',amountCents:body.amountCents??null,bestCardId:'wallet-best',cards:[{cardId:'wallet-best',cardName:'Wells Fargo Active Cash',rewardBps:200,baseRewardBps:200,basis:'base',rewardCents:body.amountCents==null?null:Math.round(body.amountCents*0.02),sourceUrl:'https://issuer.example.test/rewards',ownership:sample?'synthetic':'self_reported'}],explanation:'Highest supported rate in your wallet.',...recommendation};
    if(path==='/rewards/card-purchases')return purchaseHandler?purchaseHandler(body):{purchase:{id:'purchase-one',cardName:'Wells Fargo Active Cash',rewardCents:125},duplicate:false};
    throw new Error('Unexpected path '+path);
  };
  App.refresh=async()=>{refreshes++;if(refreshHandler)return refreshHandler();};
  const document={querySelector:selector=>{
    if(selector==='#sheet')return sheet;
    if(selector==='#location-form')return sheet.open&&sheet.innerHTML.includes('id="location-form"')?form:null;
    if(selector==='#location-results')return {remove:()=>{const start=sheet.innerHTML.indexOf('<section class="location-results"'),end=sheet.innerHTML.indexOf('<form id="location-form"');if(start>=0&&end>=0)sheet.innerHTML=sheet.innerHTML.slice(0,start)+sheet.innerHTML.slice(end);}};
    if(selector==='#location-status')return {textContent:'',classList:{remove:()=>{}}};
    if(selector==='#location-form [type="submit"]'||selector==='[data-action="location-locate"]')return {disabled:false,innerHTML:''};
    return null;
  }};
  const context={window:{App},document,location:{hash:'#wallet'},navigator:{},crypto:{randomUUID:()=>`11111111-1111-4111-8111-${String(++uuid).padStart(12,'0')}`},URL,Intl,console};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/location-ui.js',import.meta.url),'utf8'),context);
  const ui=context.window.LocationUI;
  const compare=async(fields={category:'other',placeName:'Test retailer',amount:'100.00'})=>{if(!sheet.open)ui.open();await ui.submit(form,fields);};
  const change=values=>{for(const [key,value] of Object.entries(values))form.elements[key].value=value;ui.change({target:{closest:selector=>selector==='#location-form'?form:null}});};
  return {ui,App,state,sheet,requests,renders,compare,change,get refreshes(){return refreshes;}};
}
const recorded=f=>f.requests.filter(request=>request.path==='/rewards/card-purchases');
const normalize=value=>JSON.parse(JSON.stringify(value));

test('best-card comparison requires an explicit bought action and uses the saved canonical estimate',async()=>{
  for(const sample of [false,true]){
    const f=fixture({sample});await f.compare();
    assert.equal(recorded(f).length,0,'Showing a recommendation must never record a purchase.');
    assert.match(f.sheet.innerHTML,/data-action="location-track-purchase"/);assert.match(f.sheet.innerHTML,/I bought this/);
    assert.match(f.sheet.innerHTML,/Self-reported purchase/);
    await f.ui.action('location-track-purchase',{});
    assert.equal(recorded(f).length,1);const {requestId,...payload}=normalize(recorded(f)[0].body);
    assert.match(requestId,/^[0-9a-f-]{36}$/);assert.deepEqual(payload,{cardId:'wallet-best',category:'other',placeName:'Test retailer',amountCents:10000});
    assert.match(f.sheet.innerHTML,/Added \$1\.25 estimated cashback to Saved/,'Use the backend recorded reward rather than the earlier comparison estimate.');
    assert.match(f.sheet.innerHTML,/data-action="location-track-purchase"[^>]*disabled/);assert.equal(f.refreshes,1);assert.equal(f.sheet.open,true);
    await f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,1);
  }
});

test('tracking requires a positive amount and an actual recommended owned card',async()=>{
  for(const recommendation of [{amountCents:null},{amountCents:0},{amountCents:-1},{cards:[],bestCardId:null},{bestCardId:'missing'}]){
    const f=fixture({recommendation});await f.compare();
    assert.doesNotMatch(f.sheet.innerHTML,/data-action="location-track-purchase"/);
    if(recommendation.amountCents===null)assert.match(f.sheet.innerHTML,/Enter a purchase amount.*track/i);
    await f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,0);
  }
});

test('a pending bought action ignores duplicate clicks and remains disabled after success',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture({purchaseHandler:()=>pending});await f.compare();
  const saved=f.ui.action('location-track-purchase',{});await f.ui.action('location-track-purchase',{});
  assert.equal(recorded(f).length,1);assert.match(f.sheet.innerHTML,/data-action="location-track-purchase"[^>]*disabled/);
  release({purchase:{id:'purchase-one',rewardCents:200,cardName:'Active Cash'},duplicate:false});await saved;
  await f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,1);assert.match(f.sheet.innerHTML,/Added \$2\.00 estimated cashback/);
});

test('retrying an uncertain purchase response reuses its request ID',async()=>{
  let attempts=0;const f=fixture({purchaseHandler:async()=>{if(++attempts===1)throw new Error('Connection interrupted. Try again.');return{purchase:{id:'purchase-one',rewardCents:200,cardName:'Active Cash'},duplicate:true};}});await f.compare();
  await f.ui.action('location-track-purchase',{});assert.match(f.sheet.innerHTML,/Connection interrupted/);
  await f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,2);assert.equal(recorded(f)[0].body.requestId,recorded(f)[1].body.requestId);
  assert.match(f.sheet.innerHTML,/Added \$2\.00 estimated cashback/);assert.equal(f.refreshes,1);
});

test('an idempotent response for a removed purchase never claims it was added again',async()=>{
  const f=fixture({purchaseHandler:async()=>({purchase:{id:'purchase-one',status:'removed',rewardCents:200,cardName:'Active Cash'},duplicate:true})});await f.compare();
  await f.ui.action('location-track-purchase',{});
  assert.match(f.sheet.innerHTML,/previously removed/i);assert.doesNotMatch(f.sheet.innerHTML,/Added \$2\.00 estimated cashback/);
  assert.match(f.sheet.innerHTML,/data-action="location-track-purchase"[^>]*disabled/);
  await f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,1);assert.equal(f.refreshes,1);
});

test('nearby privacy text discloses the place name saved by an explicit purchase record',()=>{
  const f=fixture();f.ui.open();
  assert.match(f.sheet.innerHTML,/Coordinates aren’t saved\. Recording a purchase saves the place name you confirm\./);
  assert.doesNotMatch(f.sheet.innerHTML,/keeps no location history/);
});

test('changing details removes the bought action until a new comparison with a new request ID',async()=>{
  const f=fixture();await f.compare();await f.ui.action('location-track-purchase',{});const first=recorded(f)[0].body.requestId;
  f.change({amount:'20.00'});assert.doesNotMatch(f.sheet.innerHTML,/data-action="location-track-purchase"/);await f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,1);
  await f.compare({category:'dining',placeName:'New restaurant',amount:'20.00'});await f.ui.action('location-track-purchase',{});
  assert.notEqual(recorded(f)[1].body.requestId,first);assert.equal(recorded(f)[1].body.amountCents,2000);assert.equal(recorded(f)[1].body.category,'dining');
});

test('stale purchase responses cannot repaint after closing, identity change, or a newer comparison',async()=>{
  for(const transition of ['close','identity','comparison']){
    let release;const held=new Promise(resolve=>{release=resolve;});const f=fixture({purchaseHandler:()=>held});await f.compare();const pending=f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,1);
    if(transition==='close'){f.sheet.open=false;f.ui.reset();}
    if(transition==='identity'){f.state.data.user={id:'different-user',sample:false};f.ui.reset();}
    if(transition==='comparison')await f.compare({category:'gas',placeName:'New station',amount:'35.00'});
    const renders=f.renders.length;release({purchase:{id:'old-purchase',rewardCents:200},duplicate:false});await pending;
    assert.equal(f.renders.length,renders);assert.equal(f.refreshes,0);assert.doesNotMatch(f.sheet.innerHTML,/Added \$2\.00 estimated cashback/);
  }
});

test('a saved purchase stays recorded when refreshing Saved fails',async()=>{
  const f=fixture({refreshHandler:async()=>{throw new Error('Bootstrap unavailable.');}});await f.compare();await f.ui.action('location-track-purchase',{});
  assert.match(f.sheet.innerHTML,/Added \$1\.25 estimated cashback to Saved/);assert.match(f.sheet.innerHTML,/data-action="location-track-purchase"[^>]*disabled/);
  await f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,1);
});

test('closing while the saved purchase refresh is pending never reopens its dialog',async()=>{
  let release,started;const held=new Promise(resolve=>{release=resolve;}),refreshStarted=new Promise(resolve=>{started=resolve;});const f=fixture({refreshHandler:async()=>{started();await held;}});await f.compare();
  const pending=f.ui.action('location-track-purchase',{});assert.equal(recorded(f).length,1);await refreshStarted;f.sheet.open=false;f.ui.reset();const renders=f.renders.length;release();await pending;
  assert.equal(f.sheet.open,false);assert.equal(f.renders.length,renders);
});
