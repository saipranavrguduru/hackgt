import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutFixture} from './helpers/checkout-fixture.js';

const reference='11111111-1111-4111-8111-111111111111';
const listing={id:'provider-123',name:'Travel headphones',merchantName:'External retailer',priceCents:9999,currency:'USD',availability:'listed',url:'https://example.test/headphones',observedAt:'2026-09-27T12:00:00Z',source:'Live listing provider'};

test('Explore import persists an immutable owner-scoped sandbox product and confirms its exact test amount',async()=>{
 const f=await checkoutFixture();try{
  assert.equal(typeof f.merchant.importCatalogProduct,'function');
  const result=await f.merchant.importCatalogProduct(f.principal,{checkoutReference:reference,listing});
  const p=result.product;assert.equal(p.name,listing.name);assert.equal(p.merchandiseCents,9999);assert.equal(p.taxCents,1000);assert.equal(p.shippingCents,500);assert.equal(p.merchantId,'perkpilot-test-store');assert.equal(p.sourceMerchantName,'External retailer');assert.match(p.sourceLabel,/sandbox/i);assert.equal(p.ownerSubjectKey,undefined);
  const repeated=await f.merchant.importCatalogProduct(f.principal,{checkoutReference:reference,listing:{...listing,priceCents:1}});
  assert.equal(repeated.product.sku,p.sku);assert.equal(repeated.product.merchandiseCents,9999);
  const input={sku:p.sku,variantId:p.variantId,quantity:1,destinationId:result.destinations[0].id};
  const preview=await f.service.createPreview(f.principal,input);assert.equal(preview.cart.totalCents,11499);assert.equal(preview.cart.merchantName,'PerkPilot Test Store');assert.equal(preview.cart.name,listing.name);
  const intent=await f.service.authorize(f.principal,{previewId:preview.id,maxAmountCents:11499,approved:true});const context={principal:f.principal,intentId:intent.id};
  await f.service.readCart(context);const ranked=await f.service.rankCards(context);await f.service.executePurchase(context,{quoteId:ranked.id,cardId:ranked.rankedCards[0].cardId});
  assert.equal(f.provider.calls.length,1);assert.equal(f.provider.calls[0].amountCents,11499);assert.equal((await f.service.getStatus(f.principal,intent.id)).state,'confirmed');
  const other={subjectKey:'portal:22222222-2222-4222-8222-222222222222',userId:'22222222-2222-4222-8222-222222222222',sessionDigest:'session-bob'};
  const otherCatalog=await f.merchant.listProducts(other);assert.equal(otherCatalog.products.some(product=>product.sku===p.sku),false);assert.equal((await f.merchant.listProducts(f.principal)).products.some(product=>product.sku===p.sku),true);
  await assert.rejects(f.merchant.previewCart(other,{...input,destinationId:otherCatalog.destinations[0].id}),{code:'NOT_FOUND'});
  await assert.rejects(f.merchant.readCart({subjectKey:other.subjectKey,permission:{cart:preview.cart}}),{code:'NOT_FOUND'});
 }finally{await f.close();}
});

test('Explore import rejects listings outside the sandbox payment contract',async()=>{
 const f=await checkoutFixture();try{
  assert.equal(typeof f.merchant.importCatalogProduct,'function');
  for(const patch of [{priceCents:-1},{priceCents:0},{priceCents:50000},{priceCents:12.5},{currency:'EUR'},{availability:'unavailable'},{availability:'out_of_stock'},{url:'javascript:alert(1)'},{name:''}]){
   await assert.rejects(f.merchant.importCatalogProduct(f.principal,{checkoutReference:reference,listing:{...listing,...patch}}),{code:'CATALOG_CHECKOUT_UNAVAILABLE'});
  }
 }finally{await f.close();}
});

test('catalog reference limits evict old selections and never change a returned snapshot',async()=>{
 const {createCheckoutCatalog}=await import('../src/checkout-catalog.js');
 const principal={subjectKey:'portal:11111111-1111-4111-8111-111111111111',sessionDigest:'session-a'};
 const other={subjectKey:'portal:22222222-2222-4222-8222-222222222222',sessionDigest:'session-b'};
 const cache=createCheckoutCatalog({maxPerOwner:2,maxEntries:3});
 const selections=cache.issue(principal,[listing,listing,listing]);
 assert.throws(()=>cache.resolve(principal,selections[0].checkoutReference),{code:'CATALOG_REFERENCE_EXPIRED'});
 const read=cache.resolve(principal,selections[2].checkoutReference);read.priceCents=1;
 assert.equal(cache.resolve(principal,selections[2].checkoutReference).priceCents,9999);
 cache.issue(other,[listing,listing]);
 assert.throws(()=>cache.resolve(principal,selections[1].checkoutReference),{code:'CATALOG_REFERENCE_EXPIRED'});
 assert.equal(cache.resolve(principal,selections[2].checkoutReference).name,listing.name);
 const anonymous=cache.issue(null,[listing]);assert.equal(anonymous[0].checkoutReference,undefined);assert.match(anonymous[0].checkoutUnavailableReason,/portal/);
});

test('service resolves trusted listing references only after validating the active portal session',async()=>{
 const {createCheckoutService}=await import('../src/checkout-service.js');
 const f=await checkoutFixture();let active=true,resolveCalls=0;
 try{
  const service=createCheckoutService({repository:f.repository,merchant:f.merchant,provider:f.provider,authAdapter:{isSessionActive:()=>active},resolveCatalogReference:(principal,ref)=>{assert.equal(principal,f.principal);assert.equal(ref,reference);resolveCalls++;return listing;}});
  const result=await service.importCatalogProduct(f.principal,{checkoutReference:reference});assert.equal(result.product.merchandiseCents,9999);assert.equal(resolveCalls,1);assert.equal(f.provider.calls.length,0);
  active=false;
  await assert.rejects(service.importCatalogProduct(f.principal,{checkoutReference:reference}),{code:'LOGIN_REQUIRED'});assert.equal(resolveCalls,1);
 }finally{await f.close();}
});
