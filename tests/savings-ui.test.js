import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(savings={}) {
  const nodes=new Map(),listeners=new Map(),requests=[];
  const node=()=>({innerHTML:'',dataset:{},open:false,addEventListener(){},classList:{add(){},remove(){}}});
  for(const selector of ['#app','#sheet','#toast','#main-content'])nodes.set(selector,node());
  const data={user:{id:'savings-user',name:'Shopper'},savings,cards:[],cardProducts:[],offers:[],purchases:[],notifications:[]};
  const context={window:{addEventListener(){},scrollTo(){}},document:{querySelector:s=>nodes.get(s)||null,addEventListener:(name,fn)=>listeners.set(name,fn)},location:{hash:'#saved',search:''},URLSearchParams,Intl,Date,setTimeout:()=>1,clearTimeout(){},console,
    fetch:async(path,options)=>{requests.push({path,...options});return {ok:true,json:async()=>data};}};
  vm.createContext(context);
  const helper=new URL('../public/savings-ui.js',import.meta.url);
  if(existsSync(helper))vm.runInContext(readFileSync(helper,'utf8'),context);
  vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  context.window.App.state.data=data;
  return {context,data,nodes,listeners,requests,render:page=>{context.window.App.state.page=page;context.window.App.renderPage();return nodes.get('#main-content').innerHTML;}};
}

test('home Saved total includes tracked cashback and discloses the estimated portion',()=>{
  const f=fixture({totalCents:1000,confirmedCents:1000,trackedTotalCents:1458,estimatedCashbackCents:458});
  const html=f.render('for-you');
  assert.match(html,/Saved this year<\/p><strong class="money">\$14\.58/);
  assert.match(html,/Includes estimated cashback/);
  assert.doesNotMatch(html,/Confirmed benefits only/);
});

test('Saved separates confirmed benefits from estimated cashback without adding purchases twice',()=>{
  const f=fixture({year:2026,totalCents:1000,confirmedCents:1000,trackedTotalCents:1458,estimatedCashbackCents:458,checkoutCashbackCents:208,reportedCashbackCents:250,sampleCashbackCents:0});
  const html=f.render('saved');
  assert.match(html,/metric-value money">\$14\.58/);
  assert.match(html,/Including estimated cashback/);
  assert.match(html,/Confirmed benefits<\/p><strong>\$10\.00/);
  assert.match(html,/Estimated cashback<\/p><strong>\$4\.58/);
  assert.match(html,/Sandbox checkout.*\$2\.08/);
  assert.match(html,/Self-reported purchases.*\$2\.50/);
  assert.match(html,/Your savings ledger/);
  assert.doesNotMatch(html,/Real clarity on your sample savings/);
});

test('reward purchase history names products and cards with truthful source labels and escaped content',()=>{
  const f=fixture({rewardPurchases:[
    {id:'sandbox-id',kind:'sandbox',name:'Headphones <script>alert(1)</script>',merchantName:'PerkPilot Test Store',cardName:'Active Cash',amountCents:10400,rewardCents:208,occurredAt:'2026-09-27T12:00:00Z'},
    {id:'reported-id',kind:'self_reported',name:'Dinner',merchantName:'Cafe',cardName:'Dining Card',amountCents:5000,rewardCents:150,occurredAt:'2026-09-26T12:00:00Z'},
    {id:'sample-id',kind:'sample',name:'Sample jacket',merchantName:'Sample Shop',cardName:'Sample card',amountCents:8000,rewardCents:160,occurredAt:'2026-09-25T12:00:00Z'}
  ]});
  const html=f.render('saved');
  assert.match(html,/Headphones &lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/Active Cash/);assert.match(html,/Purchase amount.*\$104\.00/);assert.match(html,/Estimated cashback.*\$2\.08/);
  assert.match(html,/Sandbox purchase/);assert.match(html,/Self-reported purchase/);assert.match(html,/Sample purchase/);
  assert.match(html,/data-action="remove-card-purchase" data-id="reported-id"/);
  assert.doesNotMatch(html,/data-action="remove-card-purchase" data-id="(?:sandbox-id|sample-id)"/);
  assert.match(html,/not posted rewards/i);
});

test('legacy savings remain confirmed-only and unavailable checkout rewards are disclosed',()=>{
  const f=fixture({totalCents:4704,checkoutRewardsUnavailable:true});
  assert.match(f.render('for-you'),/\$47\.04/);
  const html=f.render('saved');
  assert.match(html,/metric-value money">\$47\.04/);
  assert.doesNotMatch(html,/Including estimated cashback/);
  assert.match(html,/checkout.*temporarily unavailable/i);
  assert.match(html,/No tracked cashback purchases yet/);
});

test('removing a self-reported purchase calls the correction endpoint and refreshes Saved',async()=>{
  const f=fixture({});await new Promise(resolve=>setImmediate(resolve));
  const target={dataset:{action:'remove-card-purchase',id:'reported-id'},disabled:false,isConnected:true};
  await f.listeners.get('click')({target:{closest:()=>target},preventDefault(){}});
  assert.ok(f.requests.some(r=>r.path==='/api/v1/rewards/card-purchases/reported-id'&&r.method==='DELETE'));
  assert.equal(f.requests.at(-1).path,'/api/v1/bootstrap');
});
