import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture({ready=true,recovered=null,delayed=false,lostResponse=false,lostAfterSuccess=false,discovered=[]}={}) {
  const requests=[],timers=[],store=new Map(recovered?[['perkpilot-checkout-intent',recovered]]:[]);
  const root={innerHTML:'',addEventListener(){},removeEventListener(){},querySelector(){return null;}};
  const cart={sku:'everyday-headphones',variantId:'black',quantity:1,name:'Headphones <script>evil()</script>',merchantName:'PerkPilot Test Store',currency:'USD',merchandiseCents:9000,taxCents:900,shippingCents:500,totalCents:10400,destinationLabel:'Saved test destination'};
  let release,previewCount=0,approvalCount=0;
  const api=async(path,method='GET',body)=>{
    requests.push({path,method,body});
    if(path.endsWith('/capabilities'))return {enabled:true,ready,publishableKey:ready?'pk_test_ui':null,missing:ready?[]:['Stripe test keys']};
    if(path.endsWith('/products'))return {products:[{...cart,stock:100}],destinations:[{id:'destination',label:'Atlanta test address'}]};
    if(path.endsWith('/methods')&&method==='GET')return [{id:'method',cardId:'card-a',productId:'active-cash',brand:'visa',last4:'4242'}];
    if(path.endsWith('/previews'))return {id:lostAfterSuccess?`preview-${++previewCount}`:'preview',cart,cards:[{cardId:'card-a',productId:'active-cash',brand:'visa',last4:'4242',estimatedRewardCents:208}],expiresAt:Date.now()+300000};
    if(path.endsWith('/intents')&&method==='GET')return discovered;
    if(path.endsWith('/intents')&&method==='POST') {approvalCount++;if(delayed)await new Promise(r=>{release=r;});if(lostAfterSuccess&&approvalCount===1){const prior={id:'prior-confirmed',previewId:body.previewId,state:'confirmed',events:[],order:{confirmedAt:Date.now()},maxAmountCents:body.maxAmountCents};discovered.push(prior);return prior;}if(lostAfterSuccess)throw new Error('Response was lost before commit.');if(lostResponse){discovered.push({id:'accepted-intent',previewId:body.previewId,state:'payment_pending'});throw new Error('Response was lost.');}const value={id:'intent',previewId:body.previewId,state:'queued',events:[],order:null,maxAmountCents:body.maxAmountCents};discovered.push(value);return value;}
    if(path.endsWith('/enrollments'))return {id:'setup',clientSecret:'setup_secret_sensitive'};
    if(path.endsWith('/complete'))return {cardId:'card-a'};
    if(path.endsWith('/payment-action'))return {clientSecret:'payment_secret_sensitive'};
    if(path.endsWith('/reconcile'))return {id:'intent',state:'payment_pending',events:[],order:null};
    if(path.includes('/intents/')){const id=path.split('/').at(-1),entry=discovered.find(value=>value.id===id);return {id,previewId:entry?.previewId||'preview',state:entry?.state==='confirmed'?'confirmed':'payment_pending',events:[{code:'PAYMENT_DISPATCHED',state:'payment_pending'}],order:{paymentId:'pi_pending',totalCents:10400,card:{last4:'4242'}}};}
    return {};
  };
  const stripeCalls=[];
  const stripe={elements(options){stripeCalls.push({elements:options});return {create:()=>({mount(){},destroy(){stripeCalls.push({destroyed:true});}})};},async confirmSetup(options){stripeCalls.push({confirmSetup:options});return {setupIntent:{status:'succeeded'}};},async handleNextAction(options){stripeCalls.push({handleNextAction:options});return {paymentIntent:{status:'succeeded'}};}};
  const window={Stripe:()=>stripe,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},location:{href:'http://localhost:3000/#connected'}};
  const context={window,document:{},console,Intl,URL,Date,Promise,queueMicrotask,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){}};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/checkout-ui.js',import.meta.url),'utf8'),context);
  const ui=window.CheckoutUI.mount({root,api,identity:'alice',walletCards:[{id:'card-a',productId:'active-cash',name:'Active Cash'}]});
  const remount=(identity='alice')=>{const nextRoot={...root,innerHTML:''};const nextUI=window.CheckoutUI.mount({root:nextRoot,api,identity,walletCards:[{id:'card-a',productId:'active-cash',name:'Active Cash'}]});return {ui:nextUI,root:nextRoot};};
  return {ui,root,requests,timers,store,stripeCalls,discovered,remount,release:()=>release?.()};
}
test('checkout missing test keys shows setup status and cannot authorize',async()=>{
  const f=fixture({ready:false});await f.ui.ready;
  assert.match(f.root.innerHTML,/Stripe test keys/);assert.match(f.root.innerHTML,/Buy with PerkPilot/);
  await assert.rejects(f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'}),/not ready/i);
  assert.equal(f.requests.some(r=>r.path.endsWith('/intents')&&r.method==='POST'),false);
});
test('preview escapes merchant text and one buy click submits only explicit cap and approval',async()=>{
  const f=fixture();await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
  assert.match(f.root.innerHTML,/\$104\.00/);assert.match(f.root.innerHTML,/4242/);assert.match(f.root.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(f.root.innerHTML,/<script>evil/);
  await f.ui.buy(11000);
  const sent=f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST');
  assert.equal(sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(sent[0].body)),{previewId:'preview',maxAmountCents:11000,approved:true});
  assert.equal(f.store.get('perkpilot-checkout-intent'),'intent');assert.equal(f.store.size,1);
  assert.doesNotMatch(f.root.innerHTML,/Order confirmed/);
});
test('duplicate purchase clicks cannot submit concurrently',async()=>{
  const f=fixture({delayed:true});await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
  const first=f.ui.buy(10400);await f.ui.buy(10400);f.release();await first;
  assert.equal(f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST').length,1);
});
test('reload polls the original owner-checked pending intent and backs off to five seconds',async()=>{
  const f=fixture({recovered:'existing-intent'});await f.ui.ready;
  assert.equal(f.requests.some(r=>r.path==='/agent-checkout/intents/existing-intent'),true);
  assert.equal(f.timers.at(-1).ms,5000);assert.match(f.root.innerHTML,/Processing test payment/);assert.doesNotMatch(f.root.innerHTML,/Order confirmed/);
  f.ui.dispose();assert.equal(f.root.innerHTML,'');assert.equal(f.store.size,0);
});
test('enrollment requires consent and keeps setup secret only within Stripe Elements',async()=>{
  const f=fixture();await f.ui.ready;
  await assert.rejects(f.ui.startEnrollment('card-a',false),/consent/i);
  await f.ui.startEnrollment('card-a',true);await f.ui.confirmEnrollment();
  assert.equal(f.requests.filter(r=>r.path.endsWith('/enrollments')).length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests.find(r=>r.path.endsWith('/enrollments')).body)),{walletCardId:'card-a',saveConsent:true});
  assert.equal(f.stripeCalls[0].elements.clientSecret,'setup_secret_sensitive');assert.equal(f.stripeCalls[1].confirmSetup.redirect,'if_required');
  assert.doesNotMatch(f.root.innerHTML,/setup_secret_sensitive/);assert.equal(f.store.size,0);
});
test('challenge completion reconciles the existing intent without client success claims',async()=>{
  const f=fixture({recovered:'intent'});await f.ui.ready;await f.ui.authenticatePayment();
  assert.equal(f.stripeCalls.find(c=>c.handleNextAction).handleNextAction.clientSecret,'payment_secret_sensitive');
  assert.equal(f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST').length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests.find(r=>r.path.endsWith('/reconcile')).body)),{});
  assert.doesNotMatch(f.root.innerHTML,/Order confirmed/);assert.doesNotMatch(f.root.innerHTML,/payment_secret_sensitive/);
});
test('disposing during authorization prevents a stale response from repainting or persisting the prior user',async()=>{
  const f=fixture({delayed:true});await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
  const pending=f.ui.buy(10400);f.ui.dispose();f.release();await pending;
  assert.equal(f.root.innerHTML,'');assert.equal(f.store.size,0);
});
test('mount discovers the original pending purchase when navigation lost the approval response',async()=>{
  const f=fixture({discovered:[{id:'original-pending-intent',state:'payment_pending'}]});await f.ui.ready;
  assert.equal(f.requests.some(r=>r.path==='/agent-checkout/intents/original-pending-intent'),true);
  assert.match(f.root.innerHTML,/Processing test payment/);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST').length,0);
});
test('ambiguous approval response discovers accepted payment and prevents a fresh purchase',async()=>{
  const f=fixture({lostResponse:true});await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
  await f.ui.buy(11000);
  assert.equal(f.requests.some(r=>r.path==='/agent-checkout/intents/accepted-intent'),true);
  assert.match(f.root.innerHTML,/Processing test payment/);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST').length,1);
  await assert.rejects(f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'}),/Finish or cancel/);
});
test('a prior confirmed purchase cannot resolve a newer interrupted approval',async()=>{
  const f=fixture({lostAfterSuccess:true});await f.ui.ready;
  const input={sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'};
  await f.ui.preparePreview(input);await f.ui.buy(11000);await f.ui.preparePreview(input);await f.ui.buy(11000);
  assert.match(f.root.innerHTML,/Checking your existing approval/);assert.doesNotMatch(f.root.innerHTML,/data-checkout-receipt/);
  await assert.rejects(f.ui.preparePreview(input),/Finish or cancel/);
  f.discovered.push({id:'new-pending',previewId:'preview-2',state:'payment_pending'});await f.ui.reconcile();
  assert.equal(f.store.get('perkpilot-checkout-intent'),'new-pending');assert.match(f.root.innerHTML,/Processing test payment/);
});
test('navigation returning before approval commits recovers the exact pending purchase on late response',async()=>{
  const f=fixture({delayed:true});await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
  const pending=f.ui.buy(11000);f.ui.dispose({clearRecovery:false});const next=f.remount();await next.ui.ready;
  assert.match(next.root.innerHTML,/Checking your existing approval/);f.release();await pending;
  assert.match(next.root.innerHTML,/Processing test payment/);assert.equal(f.store.get('perkpilot-checkout-intent'),'intent');
  assert.equal(f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST').length,1);
});
test('a late approval response cannot populate the next signed-in identity',async()=>{
  const f=fixture({delayed:true});await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
  const pending=f.ui.buy(11000);f.ui.dispose();const other=f.remount('bob');await other.ui.ready;f.release();await pending;
  assert.doesNotMatch(other.root.innerHTML,/Processing test payment|Order confirmed|Checking your existing approval/);
  assert.equal(f.store.size,0);
});
