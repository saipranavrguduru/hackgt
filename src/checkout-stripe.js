import Stripe from 'stripe';
import { fail, requireValue } from './errors.js';

// Pinned with the installed official SDK; upgrade and verify these together.
export const CHECKOUT_STRIPE_API_VERSION = '2026-08-26.dahlia';
const idOf = value => typeof value === 'string' ? value : value?.id || null;
const validId = (value, prefix) => typeof value === 'string' && value.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(value) && value.length <= 200;
const testObject = value => requireValue(value && value.livemode === false, 'STRIPE_TEST_MODE_REQUIRED', 'Stripe checkout requires verified test objects.', 502);
const keyOptions = key => {
  requireValue(typeof key === 'string' && key.length > 0 && key.length <= 255, 'INVALID_PAYMENT_REQUEST', 'A stable operation key is required.');
  return {idempotencyKey:key};
};

export function createStripeCheckoutProvider({stripeClient,secretKey,publishableKey,webhookSecret,expectedAccountId} = {}) {
  requireValue(typeof secretKey === 'string' && secretKey.startsWith('sk_test_') && typeof publishableKey === 'string' && publishableKey.startsWith('pk_test_'), 'STRIPE_TEST_MODE_REQUIRED', 'Configure Stripe test secret and publishable keys.', 503);
  requireValue(validId(expectedAccountId,'acct_'), 'STRIPE_ACCOUNT_REQUIRED', 'Configure the expected Stripe account.', 503);
  const stripe = stripeClient || new Stripe(secretKey,{apiVersion:CHECKOUT_STRIPE_API_VERSION,maxNetworkRetries:0,timeout:20000});
  let verification;
  async function verifyAccount() {
    if (!verification) verification = Promise.resolve().then(()=>stripe.accounts.retrieve()).then(account=>{
      requireValue(account?.id === expectedAccountId,'STRIPE_ACCOUNT_MISMATCH','Stripe account does not match configuration.',503);
      return {id:expectedAccountId,accountId:expectedAccountId,mode:'test',apiVersion:CHECKOUT_STRIPE_API_VERSION};
    }).catch(error=>{verification=null;if(error.code==='STRIPE_ACCOUNT_MISMATCH')throw error;fail('STRIPE_UNAVAILABLE','Stripe account verification failed.',503);});
    return verification;
  }
  function normalizePayment(value, includeSecret=true) {
    testObject(value);
    requireValue(validId(value.id,'pi_') && Number.isSafeInteger(value.amount) && value.amount >= 0 && value.currency === 'usd' && typeof value.status === 'string','INVALID_PROVIDER_RESULT','Stripe payment response is incomplete.',502);
    let paymentMethodId=idOf(value.payment_method);
    // Stripe clears the current method after a decline; its error still identifies
    // the attempted method. This is evidence only for the failed attempt, never success.
    const attemptedMethodId=idOf(value.last_payment_error?.payment_method);
    if(paymentMethodId===null && value.status==='requires_payment_method' && validId(attemptedMethodId,'pm_')) paymentMethodId=attemptedMethodId;
    const result={id:value.id,accountId:expectedAccountId,livemode:false,status:value.status,amountCents:value.amount,currency:'USD',customerId:idOf(value.customer),paymentMethodId,orderId:value.metadata?.orderId || null};
    if(value.status==='requires_payment_method' && value.last_payment_error) result.code='PAYMENT_DECLINED';
    if(includeSecret && value.status === 'requires_action' && typeof value.client_secret === 'string') result.clientSecret=value.client_secret;
    return result;
  }
  function normalizeSetup(value) {
    testObject(value);
    requireValue(validId(value.id,'seti_'),'INVALID_PROVIDER_RESULT','Stripe enrollment response is incomplete.',502);
    return {id:value.id,accountId:expectedAccountId,livemode:false,status:value.status,customerId:idOf(value.customer),paymentMethodId:idOf(value.payment_method),...(value.client_secret?{clientSecret:value.client_secret}:{})};
  }
  function normalizeMethod(value) {
    testObject(value);
    requireValue(validId(value.id,'pm_') && value.type === 'card' && value.card,'INVALID_PROVIDER_RESULT','Stripe returned an unsupported payment method.',502);
    return {id:value.id,accountId:expectedAccountId,livemode:false,customerId:idOf(value.customer),type:'card',brand:value.card.brand,last4:value.card.last4};
  }
  async function call(operation) {
    await verifyAccount();
    try {return await operation();} catch(error) {
      if(['STRIPE_TEST_MODE_REQUIRED','INVALID_PROVIDER_RESULT','INVALID_PAYMENT_REQUEST'].includes(error.code))throw error;
      fail('STRIPE_UNAVAILABLE','Stripe could not complete the request.',502);
    }
  }
  async function createCustomer({subjectKey,idempotencyKey}) {
    requireValue(typeof subjectKey==='string' && /^portal:[A-Za-z0-9-]+$/.test(subjectKey),'INVALID_PAYMENT_REQUEST','A registered payment subject is required.');
    const options=keyOptions(idempotencyKey);
    return call(async()=>{const result=await stripe.customers.create({metadata:{subjectKey}},options);testObject(result);requireValue(validId(result.id,'cus_'),'INVALID_PROVIDER_RESULT','Stripe customer response is incomplete.',502);return{id:result.id,accountId:expectedAccountId,livemode:false};});
  }
  async function createEnrollment({customerId,idempotencyKey}) {
    requireValue(validId(customerId,'cus_'),'INVALID_PAYMENT_REQUEST','A saved customer is required.');const options=keyOptions(idempotencyKey);
    return call(async()=>normalizeSetup(await stripe.setupIntents.create({customer:customerId,usage:'on_session',payment_method_types:['card']},options)));
  }
  async function getEnrollment(setupId) {requireValue(validId(setupId,'seti_'),'INVALID_PAYMENT_REQUEST','Invalid enrollment ID.');return call(async()=>normalizeSetup(await stripe.setupIntents.retrieve(setupId)));}
  async function getPaymentMethod(methodId) {requireValue(validId(methodId,'pm_'),'INVALID_PAYMENT_REQUEST','Invalid method ID.');return call(async()=>normalizeMethod(await stripe.paymentMethods.retrieve(methodId)));}
  async function detachMethod(methodId) {requireValue(validId(methodId,'pm_'),'INVALID_PAYMENT_REQUEST','Invalid method ID.');return call(async()=>normalizeMethod(await stripe.paymentMethods.detach(methodId)));}
  async function submitPayment({orderId,customerId,paymentMethodId,amountCents,currency,idempotencyKey}) {
    requireValue(typeof orderId==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(orderId) && validId(customerId,'cus_') && validId(paymentMethodId,'pm_') && Number.isSafeInteger(amountCents) && amountCents>0 && amountCents<=50000 && currency==='USD','INVALID_PAYMENT_REQUEST','Invalid controlled payment request.');
    const options=keyOptions(idempotencyKey);await verifyAccount();
    try {return normalizePayment(await stripe.paymentIntents.create({amount:amountCents,currency:'usd',customer:customerId,payment_method:paymentMethodId,payment_method_types:['card'],capture_method:'automatic',confirm:true,use_stripe_sdk:true,off_session:false,metadata:{orderId}},options));}
    catch(error) {
      if(['STRIPE_TEST_MODE_REQUIRED','INVALID_PROVIDER_RESULT'].includes(error.code))throw error;
      if(error.type==='StripeCardError' && error.payment_intent)return normalizePayment(error.payment_intent);
      // All transport/API uncertainty is reconciled using the persisted identical operation.
      fail('PAYMENT_OUTCOME_UNKNOWN','The payment outcome is unknown; reconcile the existing operation.',502);
    }
  }
  async function getPayment(paymentId) {requireValue(validId(paymentId,'pi_'),'INVALID_PAYMENT_REQUEST','Invalid payment ID.');return call(async()=>normalizePayment(await stripe.paymentIntents.retrieve(paymentId)));}
  async function cancelPayment(paymentId) {requireValue(validId(paymentId,'pi_'),'INVALID_PAYMENT_REQUEST','Invalid payment ID.');return call(async()=>normalizePayment(await stripe.paymentIntents.cancel(paymentId)));}
  function verifyWebhook(rawBytes,signature) {
    requireValue(Buffer.isBuffer(rawBytes),'INVALID_WEBHOOK_SIGNATURE','Raw webhook bytes are required.');
    requireValue(rawBytes.length<=256*1024,'WEBHOOK_TOO_LARGE','Webhook body exceeds the limit.',413);
    requireValue(typeof webhookSecret==='string' && webhookSecret.startsWith('whsec_') && typeof signature==='string','INVALID_WEBHOOK_SIGNATURE','Webhook verification is unavailable.',400);
    let event;try{event=stripe.webhooks.constructEvent(rawBytes,signature,webhookSecret,300);}catch{fail('INVALID_WEBHOOK_SIGNATURE','Webhook signature is invalid.',400);}
    testObject(event);
    requireValue(!event.account || event.account===expectedAccountId,'STRIPE_ACCOUNT_MISMATCH','Webhook belongs to another Stripe account.',400);
    requireValue(validId(event.id,'evt_') && typeof event.type==='string','INVALID_PROVIDER_RESULT','Webhook event is invalid.');
    return {id:event.id,type:event.type,accountId:expectedAccountId,livemode:false,created:event.created || null,createdAt:event.created?new Date(event.created*1000).toISOString():null,payment:event.type.startsWith('payment_intent.')?normalizePayment(event.data?.object,false):null};
  }
  return {accountId:expectedAccountId,publishableKey,verifyAccount,createCustomer,createEnrollment,getEnrollment,getPaymentMethod,detachMethod,submitPayment,getPayment,cancelPayment,verifyWebhook};
}
