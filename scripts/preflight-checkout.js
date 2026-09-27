import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveCheckoutOrigin} from '../src/checkout-origin.js';

export async function preflightCheckout({env=process.env,verifyProvider=false}={}) {
 const missing=[];
 if(env.PERKPILOT_CHECKOUT_ENABLED!=='1')missing.push('PERKPILOT_CHECKOUT_ENABLED=1');
 for(const key of ['DATABASE_URL','STRIPE_SECRET_KEY','STRIPE_PUBLISHABLE_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_EXPECTED_ACCOUNT_ID','GEMINI_API_KEY'])if(!env[key])missing.push(key);
 if(env.STRIPE_SECRET_KEY&&!env.STRIPE_SECRET_KEY.startsWith('sk_test_'))missing.push('Stripe test secret key');
 if(env.STRIPE_PUBLISHABLE_KEY&&!env.STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_'))missing.push('Stripe test publishable key');
 try{resolveCheckoutOrigin({env});}catch{missing.push('valid HTTPS or loopback HTTP checkout origin');}
 if(missing.length)return{ready:false,missing,database:'unchecked',provider:'unchecked',modelTools:'unverified',webhookDelivery:'unverified'};
 const {createDatabase}=await import('../src/connected-db.js');const database=createDatabase(env.DATABASE_URL);
 try {
  await database.query('SELECT 1');
  const {CHECKOUT_SCHEMA_VERSION}=await import('../src/checkout-repository.js');
  const schema=await database.query('SELECT version FROM pp_checkout_schema_versions WHERE version=$1',[CHECKOUT_SCHEMA_VERSION]);
  if(!schema.rows.length)return{ready:false,missing:['checkout schema migration'],database:'verified',provider:'unchecked',modelTools:'unverified',webhookDelivery:'unverified'};
  let provider='configured';
  if(verifyProvider){const {createStripeCheckoutProvider}=await import('../src/checkout-stripe.js');await createStripeCheckoutProvider({secretKey:env.STRIPE_SECRET_KEY,publishableKey:env.STRIPE_PUBLISHABLE_KEY,webhookSecret:env.STRIPE_WEBHOOK_SECRET,expectedAccountId:env.STRIPE_EXPECTED_ACCOUNT_ID}).verifyAccount();provider='verified test account';}
  return{ready:false,missing:['verified enrollment','verified Gemini tool run','verified signed webhook delivery'],database:'verified',schema:'verified',provider,modelTools:'unverified',webhookDelivery:'unverified'};
 }finally{await database.close();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 preflightCheckout({verifyProvider:process.argv.includes('--verify-provider')}).then(result=>{console.log(JSON.stringify(result));if(result.missing?.some(value=>!['verified enrollment','verified Gemini tool run','verified signed webhook delivery'].includes(value)))process.exitCode=1;}).catch(error=>{console.error(`Checkout preflight failed: ${error.code || 'CONFIGURATION_ERROR'}.`);process.exitCode=1;});
}
