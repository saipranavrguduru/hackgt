import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

async function storefront({origin='https://perkpilot.onrender.com',portalUrl=origin,catalogFails=false}={}) {
  const nodes=new Map(),links=[{href:'http://localhost:3000'},{href:'http://localhost:3000'}],requests=[];
  const element=()=>({dataset:{},style:{},children:[],hidden:true,classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},toggleAttribute(){},replaceChildren(){},append(child){this.children.push(child);}});
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},querySelectorAll:()=>links,createElement:element,createTextNode:text=>({textContent:text})};
  const product={id:'alo-jacket',merchantId:'alo',merchantName:'Alo',name:'Everyday jacket',priceCents:10400,referencePriceCents:13000};
  const context={document,location:new URL(origin+'/store?product=alo-jacket'),URL,URLSearchParams,Intl,AbortSignal,console,
    fetch:async(path,options)=>{requests.push({path,options});return {ok:!catalogFails,json:async()=>path==='/api/v1/store/products'?{portalUrl,products:[product],error:{message:'Catalog unavailable'}}:{id:'cart-owned',secret:'fixture-secret',revision:4,cart:{quantity:1,merchandiseCents:10400,shippingCents:0,taxCents:832,currency:'USD',version:1}}};}};
  vm.createContext(context);
  await vm.runInContext(`(async()=>{${readFileSync(new URL('../public/store.js',import.meta.url),'utf8')}\n})()`,context);
  return {nodes,links,requests};
}

test('hosted storefront approval and research links stay on its exact HTTPS origin',async()=>{
  const f=await storefront();
  assert.equal(f.nodes.get('checkout-link').href,'https://perkpilot.onrender.com/?product=alo-jacket&quantity=1&cartId=cart-owned&cartRevision=4');
  assert.equal(f.nodes.get('research-link').href,'https://perkpilot.onrender.com/?research=alo-jacket');
  assert.deepEqual(f.links.map(link=>link.href),['https://perkpilot.onrender.com','https://perkpilot.onrender.com']);
});

test('untrusted HTTPS destinations cannot redirect a hosted storefront approval',async()=>{
  for(const portalUrl of ['https://evil.example','https://perkpilot.onrender.com.evil.example','https://sub.perkpilot.onrender.com','https://perkpilot.onrender.com:444','https://user:secret@perkpilot.onrender.com','http://perkpilot.onrender.com']){
    const f=await storefront({portalUrl});
    assert.equal(new URL(f.nodes.get('checkout-link').href).origin,'https://perkpilot.onrender.com',portalUrl);
    assert.equal(new URL(f.nodes.get('research-link').href).origin,'https://perkpilot.onrender.com',portalUrl);
  }
});

test('same-origin response paths never become approval redirect targets',async()=>{
  const f=await storefront({portalUrl:'https://perkpilot.onrender.com/redirect?url=https://evil.example#external'});
  assert.equal(f.nodes.get('checkout-link').href,'https://perkpilot.onrender.com/?product=alo-jacket&quantity=1&cartId=cart-owned&cartRevision=4');
});

test('loopback storefronts preserve the configured local portal hostname and port',async()=>{
  for(const portalUrl of ['http://localhost:3000','http://localhost:3310','http://127.0.0.1:4311']){
    const f=await storefront({origin:'http://localhost:3001',portalUrl});
    assert.equal(new URL(f.nodes.get('checkout-link').href).origin,portalUrl);
    assert.deepEqual(f.links.map(link=>link.href),[portalUrl,portalUrl]);
  }
  const untrusted=await storefront({origin:'http://localhost:3001',portalUrl:'https://evil.example'});
  assert.equal(new URL(untrusted.nodes.get('checkout-link').href).origin,'http://localhost:3000');
});

test('hosted navigation stays local when catalog data is missing or unavailable',async()=>{
  const missing=await storefront({portalUrl:null});
  assert.equal(new URL(missing.nodes.get('checkout-link').href).origin,'https://perkpilot.onrender.com');
  const failed=await storefront({catalogFails:true});
  assert.deepEqual(failed.links.map(link=>link.href),['https://perkpilot.onrender.com','https://perkpilot.onrender.com']);
  assert.match(failed.nodes.get('store-status').textContent,/Catalog unavailable/);
});
