import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { createStripeCheckoutProvider } from '../src/checkout-stripe.js';
const payment = overrides => ({id:'pi_test',livemode:false,status:'succeeded',amount:10400,currency:'usd',customer:'cus_test',payment_method:'pm_test',metadata:{orderId:'order-1'},client_secret:'private_secret',...overrides});
function fixture(overrides={}) {
 const calls=[];
 const sdk={accounts:{retrieve:async()=>({id:'acct_test'})},customers:{create:async(params,opts)=>{calls.push({params,opts});return{id:'cus_test',livemode:false};}},setupIntents:{create:async(params,opts)=>{calls.push({params,opts});return{id:'seti_test',livemode:false,status:'requires_payment_method',customer:params.customer,client_secret:'setup_secret'};},retrieve:async()=>({id:'seti_test',livemode:false,status:'succeeded',customer:'cus_test',payment_method:'pm_test'})},paymentMethods:{retrieve:async()=>({id:'pm_test',livemode:false,type:'card',customer:'cus_test',card:{brand:'visa',last4:'4242'}}),detach:async()=>({id:'pm_test',livemode:false,type:'card',customer:null,card:{brand:'visa',last4:'4242'}})},paymentIntents:{create:async(params,opts)=>{calls.push({params,opts});return payment();},retrieve:async()=>payment(),cancel:async()=>payment({status:'canceled'})},webhooks:new Stripe('sk_test_fixture').webhooks,...overrides};
 return {calls,sdk,provider:createStripeCheckoutProvider({stripeClient:sdk,secretKey:'sk_test_fixture',publishableKey:'pk_test_fixture',webhookSecret:'whsec_fixture',expectedAccountId:'acct_test'})};
}
const input={orderId:'order-1',customerId:'cus_test',paymentMethodId:'pm_test',amountCents:10400,currency:'USD',idempotencyKey:'stable-key'};
test('Stripe adapter refuses live keys and unconfigured account',()=>{
 assert.throws(()=>createStripeCheckoutProvider({secretKey:'sk_live_bad',publishableKey:'pk_test_x',expectedAccountId:'acct_test'}),{code:'STRIPE_TEST_MODE_REQUIRED'});
 assert.throws(()=>createStripeCheckoutProvider({secretKey:'sk_test_x',publishableKey:'pk_live_bad',expectedAccountId:'acct_test'}),{code:'STRIPE_TEST_MODE_REQUIRED'});
 assert.throws(()=>createStripeCheckoutProvider({secretKey:'sk_test_x',publishableKey:'pk_test_x'}),{code:'STRIPE_ACCOUNT_REQUIRED'});
});
test('account verification fails closed before sending payment',async()=>{
 const {provider,calls}=fixture({accounts:{retrieve:async()=>({id:'acct_wrong'})}});
 await assert.rejects(provider.submitPayment(input),{code:'STRIPE_ACCOUNT_MISMATCH'});assert.equal(calls.length,0);
});
test('enrollment uses on-session card setup and exposes secret only to enrollment caller',async()=>{
 const {provider,calls}=fixture();const customer=await provider.createCustomer({subjectKey:'portal:alice',idempotencyKey:'customer-key'});assert.equal(customer.id,'cus_test');
 const setup=await provider.createEnrollment({customerId:'cus_test',idempotencyKey:'setup-key'});assert.equal(setup.clientSecret,'setup_secret');assert.equal(calls[1].params.usage,'on_session');assert.deepEqual(calls[1].params.payment_method_types,['card']);assert.equal(calls[1].opts.idempotencyKey,'setup-key');
 assert.equal((await provider.getEnrollment('seti_test')).paymentMethodId,'pm_test');assert.equal((await provider.getPaymentMethod('pm_test')).last4,'4242');assert.equal((await provider.detachMethod('pm_test')).customerId,null);
});
test('selected saved method, amount, automatic capture and stable key cross Stripe boundary exactly',async()=>{
 const {provider,calls}=fixture();const result=await provider.submitPayment(input);
 assert.equal(result.amountCents,10400);assert.equal(result.currency,'USD');assert.equal(result.accountId,'acct_test');assert.equal(result.orderId,'order-1');assert.equal(result.customerId,'cus_test');assert.equal(result.paymentMethodId,'pm_test');assert.equal(result.clientSecret,undefined);
 assert.deepEqual(calls[0].params,{amount:10400,currency:'usd',customer:'cus_test',payment_method:'pm_test',payment_method_types:['card'],capture_method:'automatic',confirm:true,use_stripe_sdk:true,off_session:false,metadata:{orderId:'order-1'}});assert.equal(calls[0].opts.idempotencyKey,'stable-key');assert.equal((await provider.cancelPayment('pi_test')).status,'canceled');
});
test('live provider objects and invalid amount are refused',async()=>{
 const {provider}=fixture({paymentIntents:{create:async()=>payment({livemode:true})}});await assert.rejects(provider.submitPayment(input),{code:'STRIPE_TEST_MODE_REQUIRED'});
 await assert.rejects(provider.submitPayment({...input,amountCents:1.2}),{code:'INVALID_PAYMENT_REQUEST'});
});
test('challenge result exposes owner-action secret; decline has known result; timeout remains unknown',async()=>{
 const challenge=fixture({paymentIntents:{create:async()=>payment({status:'requires_action'})}});assert.equal((await challenge.provider.submitPayment(input)).clientSecret,'private_secret');
 const declined=fixture({paymentIntents:{create:async()=>{throw Object.assign(new Error('secret provider text'),{type:'StripeCardError',payment_intent:payment({status:'requires_payment_method'})});}}});assert.equal((await declined.provider.submitPayment(input)).status,'requires_payment_method');
 const timeout=fixture({paymentIntents:{create:async()=>{throw Object.assign(new Error('secret provider text'),{type:'StripeConnectionError'});}}});await assert.rejects(timeout.provider.submitPayment(input),error=>error.code==='PAYMENT_OUTCOME_UNKNOWN'&&!error.message.includes('secret'));
});
test('official raw webhook verification rejects altered, stale, oversized and live events',()=>{
 const {provider,sdk}=fixture();const raw=Buffer.from(JSON.stringify({id:'evt_test',type:'payment_intent.succeeded',livemode:false,data:{object:payment()}}));
 const signature=sdk.webhooks.generateTestHeaderString({payload:raw.toString(),secret:'whsec_fixture'});const event=provider.verifyWebhook(raw,signature);assert.equal(event.id,'evt_test');assert.equal(event.payment.clientSecret,undefined);assert.equal(event.payment.id,'pi_test');
 assert.throws(()=>provider.verifyWebhook(Buffer.concat([raw,Buffer.from(' ')]),signature),{code:'INVALID_WEBHOOK_SIGNATURE'});
 assert.throws(()=>provider.verifyWebhook(raw,sdk.webhooks.generateTestHeaderString({payload:raw.toString(),secret:'whsec_fixture',timestamp:1})),{code:'INVALID_WEBHOOK_SIGNATURE'});
 assert.throws(()=>provider.verifyWebhook(Buffer.alloc(262145),signature),{code:'WEBHOOK_TOO_LARGE'});
 const live=Buffer.from(JSON.stringify({id:'evt_live',type:'payment_intent.succeeded',livemode:true,data:{object:payment()}}));assert.throws(()=>provider.verifyWebhook(live,sdk.webhooks.generateTestHeaderString({payload:live.toString(),secret:'whsec_fixture'})),{code:'STRIPE_TEST_MODE_REQUIRED'});
});
test('webhook account and payment method types are checked independently of a valid signature',async()=>{
 const {provider,sdk}=fixture();const raw=Buffer.from(JSON.stringify({id:'evt_wrong',type:'payment_intent.succeeded',account:'acct_wrong',livemode:false,data:{object:payment()}}));
 assert.throws(()=>provider.verifyWebhook(raw,sdk.webhooks.generateTestHeaderString({payload:raw.toString(),secret:'whsec_fixture'})),{code:'STRIPE_ACCOUNT_MISMATCH'});
 const bank=fixture({paymentMethods:{retrieve:async()=>({id:'pm_bank',livemode:false,type:'us_bank_account',customer:'cus_test'})}});await assert.rejects(bank.provider.getPaymentMethod('pm_bank'),{code:'INVALID_PROVIDER_RESULT'});
});
test('declines normalize safe error code without Stripe private diagnostics',async()=>{
 const {provider}=fixture({paymentIntents:{create:async()=>{throw Object.assign(new Error('sensitive'),{type:'StripeCardError',payment_intent:payment({status:'requires_payment_method',last_payment_error:{message:'private details',code:'card_declined'}})});}}});
 const result=await provider.submitPayment(input);assert.equal(result.code,'PAYMENT_DECLINED');assert.equal(JSON.stringify(result).includes('private details'),false);
});
test('declined intent retains attempted method from last payment error when Stripe clears payment_method',async()=>{
 const declined=payment({status:'requires_payment_method',payment_method:null,last_payment_error:{code:'card_declined',payment_method:{id:'pm_test',object:'payment_method',type:'card'}}});
 const {provider}=fixture({paymentIntents:{create:async()=>{throw Object.assign(new Error('declined private diagnostics'),{type:'StripeCardError',payment_intent:declined});},retrieve:async()=>declined}});
 const result=await provider.submitPayment(input);assert.equal(result.status,'requires_payment_method');assert.equal(result.paymentMethodId,'pm_test');assert.equal(result.code,'PAYMENT_DECLINED');assert.equal(result.clientSecret,undefined);
 assert.equal((await provider.getPayment('pi_test')).paymentMethodId,'pm_test');
});
test('error method fallback cannot change successful payment identity or accept malformed method IDs',async()=>{
 const succeeded=fixture({paymentIntents:{retrieve:async()=>payment({payment_method:null,last_payment_error:{payment_method:'pm_test'}})}});assert.equal((await succeeded.provider.getPayment('pi_test')).paymentMethodId,null);
 const malformed=fixture({paymentIntents:{retrieve:async()=>payment({status:'requires_payment_method',payment_method:null,last_payment_error:{payment_method:{id:'cus_not_a_method'}}})}});assert.equal((await malformed.provider.getPayment('pi_test')).paymentMethodId,null);
});
test('normalized Stripe decline fails the existing order and releases stock without another card attempt',async t=>{
 const {checkoutFixture}=await import('./helpers/checkout-fixture.js');const f=await checkoutFixture();t.after(f.close);let submissions=0;
 const {sdk}=fixture({accounts:{retrieve:async()=>({id:'acct_checkout_test'})},paymentIntents:{create:async params=>{submissions++;throw Object.assign(new Error('private decline'),{type:'StripeCardError',payment_intent:payment({status:'requires_payment_method',amount:params.amount,customer:params.customer,payment_method:null,metadata:params.metadata,last_payment_error:{code:'card_declined',payment_method:{id:params.payment_method,type:'card'}}})});}}});
 const adapter=createStripeCheckoutProvider({stripeClient:sdk,secretKey:'sk_test_fixture',publishableKey:'pk_test_fixture',webhookSecret:'whsec_fixture',expectedAccountId:'acct_checkout_test'});
 f.provider.submitPayment=input=>adapter.submitPayment(input);
 const {context}=await f.prepare();const quote=await f.service.rankCards(context);const view=await f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'});
 assert.equal(view.state,'payment_failed');assert.equal(submissions,1);assert.equal((await f.repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,100);
 assert.equal((await f.repository.query('SELECT reservation_state FROM pp_checkout_orders')).rows[0].reservation_state,'released');
 const replay=await f.service.executePurchase(context,{quoteId:quote.id,cardId:'wallet-a'});assert.equal(replay.state,'payment_failed');assert.equal(submissions,1);assert.equal((await f.repository.query('SELECT id FROM pp_checkout_attempts')).rows.length,1);
});
