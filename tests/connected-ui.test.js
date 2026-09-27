import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture({configured=true,failSearch=false}={}) {
  const requests=[];
  const state={page:'connected',data:{user:{id:'portal-one',name:'Portal Person',sample:false},watches:[]}};
  const user={id:'live-one',name:'Portal Person',email:'person@example.test',consent:false};
  const dashboard={user,connections:[],accounts:[],transactions:[],profile:null,aiConfigured:configured,catalogConfigured:configured};
  dashboard.accounts.push({name:'Travel account',type:'asset',balanceCents:123456,currency:'CAD',last4:'1234'});
  const product={id:'real-1',name:'Current headphones',merchantName:'Retailer',priceCents:9900,source:'Live catalog',url:'https://example.test/headphones',observedAt:'2026-09-26T12:00:00Z',priceNote:'Tax and shipping unknown'};
  const main={innerHTML:''};
  const App={state,escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money:v=>`$${v/100}`,icon:()=>'',pageHeading:(title,subtitle)=>`<h1>${title}</h1><p>${subtitle}</p>`,toast:()=>{},renderShell:()=>{},closeSheet:()=>{},dataArray:v=>Array.isArray(v)?v:[]};
  const context={window:{App},document:{querySelector:()=>main},location:{search:'',hash:'#connected'},queueMicrotask,URLSearchParams,URL,console,
    fetch:async(path,init)=>{
      requests.push({path,body:init.body?JSON.parse(init.body):undefined});
      const failed=failSearch&&path.startsWith('/api/products');
      const body=path==='/api/auth/session'?{user,authMode:'portal'}:path==='/api/dashboard'?dashboard:path.startsWith('/api/products')?failed?{error:{code:'CATALOG_UNAVAILABLE',message:'The catalog is temporarily unavailable.'}}:{products:[product],observedAt:product.observedAt}:path==='/api/assistant'?{answer:'Here is the observed price.',source:'Model',model:'test'}:{};
      return {ok:!failed,status:failed?502:200,json:async()=>body};
    }};
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../public/connected-ui.js',import.meta.url),'utf8'),context);
  return {ui:context.window.ConnectedUI,state,requests,main,context};
}

test('Connected renders bank management and Explore renders the live shopping workspace',async()=>{
  const {ui,state}=fixture();
  await ui.refresh();
  const connected=ui.render();
  assert.match(connected,/Bank connection/);
  assert.doesNotMatch(connected,/id="connected-search-form"/,'shopping search belongs in Explore');
  assert.doesNotMatch(connected,/id="connected-assistant-form"/,'shopping assistant belongs in Explore');
  assert.doesNotMatch(connected,/Sign in to connected services/);
  assert.match(connected,/•••• 1234/);
  assert.match(connected,/CA\$1,234\.56/,'bank balances retain their reported currency');
  assert.equal(typeof ui.renderExplore,'function','Explore must have a live workspace renderer');
  state.page='explore';
  const explore=ui.renderExplore();
  assert.match(explore,/id="connected-search-form"/);
  assert.match(explore,/id="connected-assistant-form"/);
  assert.doesNotMatch(explore,/id="connected-connections"/);
});

test('live Explore search and assistant keep current catalog evidence in the same workspace',async()=>{
  const {ui,state,requests}=fixture();
  await ui.refresh();
  state.page='explore';
  await ui.submit({id:'connected-search-form'},{query:'headphones'});
  assert.equal(typeof ui.renderExplore,'function');
  assert.match(ui.renderExplore(),/Current headphones/);
  await ui.submit({id:'connected-assistant-form'},{message:'Which costs less?'});
  assert.match(ui.renderExplore(),/Here is the observed price/);
  assert.deepEqual(requests.at(-1).body,{message:'Which costs less?',catalogQuery:'headphones'});
});

test('catalog search failure clears stale listings and presents a manual search path',async()=>{
  const {ui,state}=fixture({failSearch:true});
  await ui.refresh();state.page='explore';
  await ui.submit({id:'connected-search-form'},{query:'headphones'});
  assert.match(ui.renderExplore(),/catalog is temporarily unavailable/);
  assert.match(ui.renderExplore(),/google\.com\/search/);
});

test('unconfigured providers preserve manual search and portal identity changes clear shopping context',async()=>{
  const {ui,state}=fixture({configured:false});
  await ui.refresh();
  assert.equal(typeof ui.renderExplore,'function');
  state.page='explore';
  assert.match(ui.renderExplore(),/Current product search is unavailable/);
  assert.match(ui.renderExplore(),/google\.com\/search/);
  state.data.user={id:'alex',name:'Alex',sample:true};state.page='connected';
  assert.match(ui.render(),/sample/i);
  assert.doesNotMatch(ui.render(),/person@example\.test/);
});

test('late browser location permission from a previous portal identity sends no coordinates',async()=>{
  const {ui,state,requests,context}=fixture();
  await ui.refresh();state.page='explore';
  let positionCallback;
  context.navigator={geolocation:{getCurrentPosition(success){positionCallback=success;}}};
  const pending=ui.action('connected-locate',{});
  state.data.user={id:'alex',name:'Alex',sample:true};state.page='connected';ui.render();
  positionCallback({coords:{latitude:33.7756,longitude:-84.3963,accuracy:12}});
  await pending;
  assert.equal(requests.filter(request=>request.path==='/api/profile/location/locate').length,0);
});

test('late product results cannot restore context after switching portal identity',async()=>{
  const {ui,state,context}=fixture();
  await ui.refresh();state.page='explore';
  const originalFetch=context.fetch;
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  context.fetch=async(path,init)=>{if(path.startsWith('/api/products'))await held;return originalFetch(path,init);};
  const pending=ui.search('headphones');
  state.data.user={id:'alex',name:'Alex',sample:true};state.page='connected';ui.render();
  release();await pending;
  assert.equal(ui.productById('real-1'),undefined);
  assert.doesNotMatch(ui.render(),/Travel account/);
});

test('a Plaid callback from a previous portal identity cannot link a bank to the new identity',async()=>{
  const {ui,state,requests,context}=fixture();
  await ui.refresh();
  const stored=new Map();
  context.sessionStorage={setItem:(key,value)=>stored.set(key,value),getItem:key=>stored.get(key),removeItem:key=>stored.delete(key)};
  context.history={replaceState:()=>{}};
  let plaidOptions;
  context.window.Plaid={create:options=>{plaidOptions=options;return{open:()=>{}};}};
  await ui.action('connected-link',{});
  state.data.user={id:'alex',name:'Alex',sample:true};ui.render();
  await plaidOptions.onSuccess('public-token');
  assert.equal(requests.filter(request=>request.path==='/api/plaid/exchange').length,0);
});
