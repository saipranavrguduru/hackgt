import { newDb } from 'pg-mem';
import { createCheckoutRepository } from '../../src/checkout-repository.js';
import { createCheckoutMerchant } from '../../src/checkout-merchant.js';
import { createCheckoutService } from '../../src/checkout-service.js';

export async function checkoutFixture({pool:injectedPool,repositoryOptions={}}={}) {
  const {Pool}=newDb().adapters.createPg(); const pool=injectedPool || new Pool();
  let clock=Date.now(), sessionActive=true, sequence=0;
  const principal={subjectKey:'portal:11111111-1111-4111-8111-111111111111',userId:'11111111-1111-4111-8111-111111111111',sessionDigest:'session-alice'};
  const cards=[{id:'wallet-a',productId:'active-cash'},{id:'wallet-b',productId:'quicksilver'}];
  const repository=createCheckoutRepository({pool,...repositoryOptions,now:()=>clock}); await repository.migrate();
  const merchant=createCheckoutMerchant({repository,now:()=>clock,providerAccountId:'acct_checkout_test'}); await merchant.seed();
  const setups=new Map(),methods=new Map(),payments=new Map(),calls=[];
  const provider={accountId:'acct_checkout_test',publishableKey:'pk_test_fixture',calls,payments,
    createCustomer:async()=>({id:'cus_alice',accountId:'acct_checkout_test',livemode:false}),
    createEnrollment:async({customerId})=>{const id=`seti_${++sequence}`,pm=`pm_${sequence}`;setups.set(id,{id,status:'succeeded',customerId,paymentMethodId:pm,livemode:false});methods.set(pm,{id:pm,type:'card',customerId,brand:'visa',last4:'4242',livemode:false});return {...setups.get(id),clientSecret:'setup-client-secret'};},
    getEnrollment:async id=>setups.get(id),getPaymentMethod:async id=>methods.get(id),detachMethod:async()=>({}),
    submitPayment:async input=>{calls.push(input);let p=payments.get(input.idempotencyKey);if(!p){p={id:`pi_${payments.size+1}`,accountId:'acct_checkout_test',livemode:false,status:provider.status||'succeeded',amountCents:input.amountCents,currency:input.currency,customerId:input.customerId,paymentMethodId:input.paymentMethodId,orderId:input.orderId};payments.set(input.idempotencyKey,p);}if(provider.timeout){provider.timeout=false;throw Object.assign(new Error('unknown'),{code:'PAYMENT_OUTCOME_UNKNOWN'});}return {...p};},
    getPayment:async id=>({...Array.from(payments.values()).find(p=>p.id===id)}),
    cancelPayment:async id=>{const p=Array.from(payments.values()).find(p=>p.id===id);p.status='canceled';return {...p};}
  };
  const authAdapter={isSessionActive:()=>sessionActive,getWalletCards:()=>cards};
  const service=createCheckoutService({repository,merchant,provider,authAdapter,now:()=>clock});
  for(const card of cards){const setup=await service.startEnrollment(principal,{walletCardId:card.id,saveConsent:true});await service.completeEnrollment(principal,setup.id);}
  const catalog=await merchant.listProducts(principal),product=catalog.products[0],destination=catalog.destinations[0];
  const prepare=async()=>{const preview=await service.createPreview(principal,{sku:product.sku,variantId:product.variantId,quantity:1,destinationId:destination.id});const intent=await service.authorize(principal,{previewId:preview.id,maxAmountCents:11000,approved:true});const context={principal,intentId:intent.id};return {intent,context,preview};};
  return {pool,repository,merchant,provider,service,principal,cards,prepare,now:()=>clock,advance:ms=>{clock+=ms;},logout:()=>{sessionActive=false;},close:()=>pool.end()};
}
