import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture({ready=true,enabled=true,recovered=null,delayed=false,lostResponse=false,lostAfterSuccess=false,discovered=[],walletCards=[{id:'card-a',productId:'active-cash',name:'Active Cash'}],savedMethods=[{id:'method',cardId:'card-a',productId:'active-cash',brand:'visa',last4:'4242'}],resourceErrors={},sample=false,selection=null,storeProducts=null,previewCards=[{cardId:'card-a',productId:'active-cash',brand:'visa',last4:'4242',estimatedRewardCents:208,rateBps:200}]}={}) {
  const requests=[],timers=[],store=new Map(recovered?[['perkpilot-checkout-intent',recovered]]:[]);
  const root={innerHTML:'',addEventListener(){},removeEventListener(){},querySelector(){return null;}};
  const cart={sku:'everyday-headphones',variantId:'black',quantity:1,name:'Headphones <script>evil()</script>',merchantName:'PerkPilot Test Store',currency:'USD',merchandiseCents:9000,taxCents:900,shippingCents:500,totalCents:10400,destinationLabel:'Saved test destination'};
  let release,previewCount=0,approvalCount=0;
  const capabilities={enabled,ready,publishableKey:ready?'pk_test_ui':null,missing:ready?[]:['Stripe test keys']};
  const api=async(path,method='GET',body)=>{
    requests.push({path,method,body});
    if(resourceErrors[path])throw new Error(resourceErrors[path]);
    if(path.endsWith('/capabilities'))return capabilities;
    if(path.endsWith('/products'))return {products:(storeProducts||[{...cart,stock:100}]).map(p=>({...p})),destinations:[{id:'destination',label:'Atlanta test address'}]};
    if(path.endsWith('/methods')&&method==='GET')return savedMethods;
    if(path.endsWith('/previews')){const product=storeProducts?.find(p=>p.sku===body.sku&&p.variantId===body.variantId);const previewCart=product?{...cart,...product,quantity:body.quantity,merchandiseCents:product.merchandiseCents*body.quantity,taxCents:product.taxCents*body.quantity,totalCents:(product.merchandiseCents+product.taxCents)*body.quantity+product.shippingCents}:cart;return {id:lostAfterSuccess?`preview-${++previewCount}`:'preview',cart:previewCart,cards:previewCards,expiresAt:Date.now()+300000};}
    if(path.endsWith('/intents')&&method==='GET')return discovered;
    if(path.endsWith('/intents')&&method==='POST') {approvalCount++;if(delayed)await new Promise(r=>{release=r;});if(lostAfterSuccess&&approvalCount===1){const prior={id:'prior-confirmed',previewId:body.previewId,state:'confirmed',events:[],order:{confirmedAt:Date.now()},maxAmountCents:body.maxAmountCents};discovered.push(prior);return prior;}if(lostAfterSuccess)throw new Error('Response was lost before commit.');if(lostResponse){discovered.push({id:'accepted-intent',previewId:body.previewId,state:'payment_pending'});throw new Error('Response was lost.');}const value={id:'intent',previewId:body.previewId,state:'queued',events:[],order:null,maxAmountCents:body.maxAmountCents};discovered.push(value);return value;}
    if(path.endsWith('/enrollments'))return {id:'setup',clientSecret:'setup_secret_sensitive'};
    if(path.endsWith('/complete'))return {cardId:'card-a'};
    if(path.endsWith('/payment-action'))return {clientSecret:'payment_secret_sensitive'};
    if(path.endsWith('/reconcile'))return {id:'intent',state:'payment_pending',events:[],order:null};
    if(path.includes('/intents/')){const id=path.split('/').at(-1),entry=discovered.find(value=>value.id===id);return {...entry,id,previewId:entry?.previewId||'preview',state:entry?.state==='confirmed'?'confirmed':'payment_pending',events:[{code:'PAYMENT_DISPATCHED',state:'payment_pending'}],order:entry?.order||{paymentId:'pi_pending',totalCents:10400,card:{last4:'4242'}}};}
    return {};
  };
  const stripeCalls=[];
  const stripe={elements(options){stripeCalls.push({elements:options});return {create:()=>({mount(){},destroy(){stripeCalls.push({destroyed:true});}})};},async confirmSetup(options){stripeCalls.push({confirmSetup:options});return {setupIntent:{status:'succeeded'}};},async handleNextAction(options){stripeCalls.push({handleNextAction:options});return {paymentIntent:{status:'succeeded'}};}};
  const window={Stripe:()=>stripe,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},location:{href:'http://localhost:3000/#connected'}};
  const context={window,document:{},console,Intl,URL,Date,Promise,queueMicrotask,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){}};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/checkout-ui.js',import.meta.url),'utf8'),context);
  const ui=window.CheckoutUI.mount({root,api,identity:'alice',walletCards,sample,selection});
  const remount=(identity='alice',nextSelection=selection)=>{const nextRoot={...root,innerHTML:''};const nextUI=window.CheckoutUI.mount({root:nextRoot,api,identity,walletCards:[{id:'card-a',productId:'active-cash',name:'Active Cash'}],selection:nextSelection});return {ui:nextUI,root:nextRoot};};
  return {ui,root,requests,timers,store,stripeCalls,discovered,capabilities,resourceErrors,remount,release:()=>release?.()};
}
test('disabled checkout provides working setup actions without unusable payment forms or disabled API calls',async()=>{
  const f=fixture({ready:false,enabled:false});await f.ui.ready;
  assert.match(f.root.innerHTML,/data-checkout-setup/);
  assert.match(f.root.innerHTML,/data-checkout-action="setup-details"/);
  assert.match(f.root.innerHTML,/data-checkout-action="retry"/);
  assert.match(f.root.innerHTML,/data-action="add-card"/);
  assert.doesNotMatch(f.root.innerHTML,/data-checkout-form="(?:enroll|preview)"/);
  assert.deepEqual(f.requests.map(r=>r.path),['/agent-checkout/capabilities']);
  Object.assign(f.capabilities,{enabled:true,ready:true,publishableKey:'pk_test_ui',missing:[]});
  await f.ui.refreshSetup();
  assert.doesNotMatch(f.root.innerHTML,/data-checkout-setup/);
  assert.match(f.root.innerHTML,/data-checkout-form="preview"/);
});
test('a ready checkout with an empty wallet offers adding a card before enrollment',async()=>{
  const f=fixture({walletCards:[],savedMethods:[]});await f.ui.ready;
  assert.match(f.root.innerHTML,/data-action="add-card"/);
  assert.match(f.root.innerHTML,/Add a wallet card/);
  assert.doesNotMatch(f.root.innerHTML,/data-checkout-form="enroll"/);
  assert.match(f.root.innerHTML,/Enroll a test card to review/);
});
test('store data failures are visible, block previews and can be retried',async()=>{
  for(const resource of ['products','methods']){
    const f=fixture({resourceErrors:{[`/agent-checkout/${resource}`]:'Store data unavailable'}});await f.ui.ready;
    assert.match(f.root.innerHTML,/Store data unavailable/);
    assert.match(f.root.innerHTML,/data-checkout-action="retry"/);
    await assert.rejects(f.ui.preparePreview({sku:'everyday-headphones'}),/not ready/i);
    delete f.resourceErrors[`/agent-checkout/${resource}`];await f.ui.refreshSetup();
    assert.doesNotMatch(f.root.innerHTML,/Store data unavailable/);
    await f.ui.preparePreview({sku:'everyday-headphones'});
    assert.match(f.root.innerHTML,/Purchase permission/);
  }
});
test('sample checkout explains the registered account requirement without an endless loading message',async()=>{
  const f=fixture({sample:true});await f.ui.ready;
  assert.match(f.root.innerHTML,/Create a registered PerkPilot account/);
  assert.doesNotMatch(f.root.innerHTML,/Checking test checkout availability/);
  assert.equal(f.requests.length,0);
});
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

const catalogProducts=[
  {sku:'everyday-headphones',variantId:'black',name:'Everyday Headphones',merchandiseCents:9000,taxCents:900,shippingCents:500,stock:100},
  {sku:'catalog-shoes',variantId:'blue',name:'Trail Shoes <blue>',merchandiseCents:12000,taxCents:1200,shippingCents:500,stock:10},
  {sku:'catalog-shoes',variantId:'red',name:'Trail Shoes red',merchandiseCents:12500,taxCents:1250,shippingCents:500,stock:10}
];
const shoeSelection={sku:'catalog-shoes',variantId:'blue'};

test('selected checkout locks the exact server product and variant while preserving editable quantity',async()=>{
  const f=fixture({selection:shoeSelection,storeProducts:catalogProducts});await f.ui.ready;
  assert.match(f.root.innerHTML,/Trail Shoes &lt;blue&gt;/);
  assert.doesNotMatch(f.root.innerHTML,/<select name="sku"|Everyday Headphones|Trail Shoes red/);
  assert.match(f.root.innerHTML,/name="quantity" type="number"[^>]*value="1" required>/);
  await f.ui.preparePreview({quantity:2,destinationId:'destination'});
  const request=f.requests.find(r=>r.path.endsWith('/previews'));
  assert.deepEqual(JSON.parse(JSON.stringify(request.body)),{sku:'catalog-shoes',variantId:'blue',quantity:2,destinationId:'destination'});
  assert.match(f.root.innerHTML,/\$269\.00/);
  await assert.rejects(f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'}),/selected product/i);
  await assert.rejects(f.ui.preparePreview({sku:'catalog-shoes',variantId:'red',quantity:1,destinationId:'destination'}),/selected product/i);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/previews')).length,1);
  await f.ui.buy(27000);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST').length,1);
});

test('missing or unavailable selected products never fall back to the default store item',async()=>{
  for(const selection of [{sku:'removed',variantId:'black'},{sku:'catalog-shoes',variantId:'missing'},{sku:'sold-out',variantId:'blue'},{}]){
    const f=fixture({selection,storeProducts:[...catalogProducts,{sku:'sold-out',variantId:'blue',name:'Sold out shoes',stock:0}]});await f.ui.ready;
    assert.match(f.root.innerHTML,/selected product.*(?:unavailable|available)/i);
    assert.match(f.root.innerHTML,/reopen.*product|return.*product/i);
    assert.doesNotMatch(f.root.innerHTML,/data-checkout-form="preview"|<select name="sku"|Everyday Headphones/);
    await assert.rejects(f.ui.preparePreview({quantity:1,destinationId:'destination'}),/selected product/i);
    assert.equal(f.requests.some(r=>r.path.endsWith('/previews')),false);
  }
});

test('a selected product preview cannot authorize a mismatched server cart',async()=>{
  const products=[...catalogProducts];
  const selected=fixture({selection:shoeSelection,storeProducts:products});await selected.ui.ready;
  // Simulate a server regression that returns its default product after removal.
  products.splice(0,products.length);
  await assert.rejects(selected.ui.preparePreview({quantity:1,destinationId:'destination'}),/selected product/i);
  await assert.rejects(selected.ui.buy(11000));
  assert.equal(selected.requests.some(r=>r.path.endsWith('/intents')&&r.method==='POST'),false);
});

test('selected checkout omits confirmed receipts from another product or unknown product',async()=>{
  for(const cart of [{sku:'everyday-headphones',variantId:'black',name:'Everyday Headphones'},undefined]){
    const f=fixture({selection:shoeSelection,storeProducts:catalogProducts,recovered:'old-order',discovered:[{id:'old-order',previewId:'old-preview',state:'confirmed',cart,order:{confirmedAt:1,merchantName:'PerkPilot Test Store',totalCents:10400}}]});await f.ui.ready;
    assert.doesNotMatch(f.root.innerHTML,/data-checkout-receipt|Order confirmed/);
    await f.ui.preparePreview({quantity:1,destinationId:'destination'});
    assert.match(f.root.innerHTML,/data-checkout-form="buy"/);
  }
});

test('selected checkout recovers its own confirmed item with the product name in the receipt',async()=>{
  const f=fixture({selection:shoeSelection,storeProducts:catalogProducts,discovered:[{id:'shoe-order',previewId:'shoe-preview',state:'confirmed',cart:{...shoeSelection,name:'Trail Shoes <blue>',quantity:2},order:{confirmedAt:1,merchantName:'PerkPilot Test Store',totalCents:26900}}]});await f.ui.ready;
  const receipt=f.root.innerHTML.split('data-checkout-receipt')[1];
  assert.ok(receipt,'Matching confirmed product has a receipt');
  assert.match(receipt,/Trail Shoes &lt;blue&gt;/);
  assert.match(receipt,/Quantity 2/);
});

test('another product pending purchase is named and blocks the selected checkout',async()=>{
  const f=fixture({selection:shoeSelection,storeProducts:catalogProducts,discovered:[{id:'headphone-order',state:'payment_pending',cart:{sku:'everyday-headphones',variantId:'black',name:'Everyday Headphones',quantity:1}}]});await f.ui.ready;
  assert.match(f.root.innerHTML,/Previous purchase/);
  assert.match(f.root.innerHTML,/Everyday Headphones/);
  await assert.rejects(f.ui.preparePreview({quantity:1,destinationId:'destination'}),/Finish or cancel/);
  assert.equal(f.requests.some(r=>r.path.endsWith('/intents')&&r.method==='POST'),false);
});

test('switching selected products during approval recovers the first purchase without dispatching the second',async()=>{
  const f=fixture({selection:shoeSelection,storeProducts:catalogProducts,delayed:true});await f.ui.ready;
  await f.ui.preparePreview({quantity:1,destinationId:'destination'});
  const pending=f.ui.buy(14000);f.ui.dispose({clearRecovery:false});
  const next=f.remount('alice',{sku:'everyday-headphones',variantId:'black'});await next.ui.ready;
  assert.match(next.root.innerHTML,/Checking your existing approval/);
  f.release();await pending;
  assert.match(next.root.innerHTML,/Previous purchase/);
  assert.match(next.root.innerHTML,/Trail Shoes &lt;blue&gt;/);
  await assert.rejects(next.ui.preparePreview({quantity:1,destinationId:'destination'}),/Finish or cancel/);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/intents')&&r.method==='POST').length,1);
});

test('selected purchase highlights the server-ranked enrolled card before authorization and keeps alternatives',async()=>{
  const f=fixture({selection:shoeSelection,storeProducts:catalogProducts,previewCards:[
    {cardId:'card-z',productId:'active-cash',brand:'visa',last4:'4242',estimatedRewardCents:274,rateBps:200},
    {cardId:'card-a',productId:'freedom-unlimited',brand:'visa',last4:'1111',estimatedRewardCents:206,rateBps:150}
  ]});await f.ui.ready;
  assert.doesNotMatch(f.root.innerHTML,/data-checkout-best-card/);
  await f.ui.preparePreview({quantity:1,destinationId:'destination'});
  const highlight=f.root.innerHTML.match(/<aside[^>]*data-checkout-best-card[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(highlight,'Review visibly identifies the best enrolled test card');
  assert.match(highlight,/Best enrolled card for this test purchase/);
  assert.match(highlight,/Active Cash.*4242/);
  assert.match(highlight,/2% base reward/);
  assert.match(highlight,/\$2\.74/);
  assert.match(highlight,/Highest estimated base reward/);
  assert.doesNotMatch(highlight,/1111/);
  assert.match(f.root.innerHTML,/Other enrolled test cards/);
  assert.match(f.root.innerHTML,/1111.*<span>.*\$2\.06/);
  assert.match(f.root.innerHTML,/Current total<\/dt><dd>\$137\.00/);
  assert.match(f.root.innerHTML,/name="maximum"[^>]*value="137.00"/);
  assert.equal(f.requests.some(r=>r.path.endsWith('/intents')&&r.method==='POST'),false);
  await f.ui.buy(14000);
  const sent=f.requests.find(r=>r.path.endsWith('/intents')&&r.method==='POST');
  assert.deepEqual(JSON.parse(JSON.stringify(sent.body)),{previewId:'preview',maxAmountCents:14000,approved:true});
});

test('equal reward estimates disclose the tie and preserve the server first card',async()=>{
  const f=fixture({previewCards:[
    {cardId:'card-z',productId:'active-cash',brand:'visa',last4:'4242',estimatedRewardCents:208,rateBps:200},
    {cardId:'card-a',productId:'double-cash',brand:'mastercard',last4:'1111',estimatedRewardCents:208,rateBps:200}
  ]});await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
  const highlight=f.root.innerHTML.match(/<aside[^>]*data-checkout-best-card[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(highlight);
  assert.match(highlight,/Active Cash.*4242/);
  assert.match(highlight,/Tied.*same estimated reward/i);
  assert.match(f.root.innerHTML,/1111.*<span>.*\$2\.08/);
  assert.doesNotMatch(highlight,/extra|more than|additional savings/i);
});

test('missing optional rate never becomes a fabricated zero rate in the best enrolled card highlight',async()=>{
  for(const rateBps of [undefined,null,'200',-1]){
    const f=fixture({previewCards:[{cardId:'card-a',productId:'active-cash',brand:'visa',last4:'4242',estimatedRewardCents:208,rateBps}]});
    await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
    const highlight=f.root.innerHTML.match(/<aside[^>]*data-checkout-best-card[^>]*>([\s\S]*?)<\/aside>/)?.[1];
    assert.ok(highlight);assert.match(highlight,/\$2\.08/);
    assert.doesNotMatch(highlight,/NaN|undefined|(?:0|2)%/);
    assert.match(highlight,/rate unavailable/i);
  }
});

test('a preview without ranked cards reports no enrolled recommendation instead of inventing a winner',async()=>{
  for(const previewCards of [[],null]){
    const f=fixture({previewCards});await f.ui.ready;await f.ui.preparePreview({sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:'destination'});
    assert.match(f.root.innerHTML,/No enrolled card recommendation/);
    assert.doesNotMatch(f.root.innerHTML,/data-checkout-best-card|Best enrolled card for this test purchase/);
    assert.match(f.root.innerHTML,/Current total<\/dt><dd>\$104\.00/);
  }
});
