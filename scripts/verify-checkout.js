import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const tools=new Set(['read_cart','rank_cards','execute_purchase','get_order_status']);
const validSubject=value=>typeof value==='string' && /^portal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const checkNames=['configuration','portalIdentity','database','providerAccount','modelCapability','modelTools','successfulOrder','blockedAmount','signedWebhook','decline','challenge','replay','timeoutRecovery','postgresConcurrency'];

async function registeredIdentity(env) {
  const dir=resolve(env.CHECKOUT_VERIFY_DATA_DIR || 'data');
  const [auth,state]=await Promise.all(['auth.json','state.json'].map(file=>readFile(resolve(dir,file),'utf8').then(JSON.parse)));
  return {auth,state};
}

export async function collectCheckoutVerification({env=process.env,repository,provider,identity,fetchImpl=fetch,now=Date.now}={}) {
  const report={checkedAt:new Date(now()).toISOString(),acceptanceComplete:false,
    scope:{merchant:'PerkPilot Test Store',providerMode:'test',enforcement:'application policy',operation:'read-only verification'},
    checks:Object.fromEntries(checkNames.map(name=>[name,{status:'not-run'}]))};
  const missing=[];
  for(const name of ['DATABASE_URL','STRIPE_SECRET_KEY','STRIPE_PUBLISHABLE_KEY','STRIPE_EXPECTED_ACCOUNT_ID','STRIPE_WEBHOOK_SECRET','GEMINI_API_KEY','CHECKOUT_VERIFY_SUBJECT'])if(!env[name])missing.push(name);
  if(env.PERKPILOT_CHECKOUT_ENABLED!=='1')missing.push('PERKPILOT_CHECKOUT_ENABLED=1');
  let origin;try{origin=new URL(env.CHECKOUT_ORIGIN || `http://localhost:${env.PORT || 3000}`);}catch{}
  const safeOrigin=origin?.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname) && origin.origin===(env.CHECKOUT_ORIGIN || `http://localhost:${env.PORT || 3000}`);
  const invalid=(!safeOrigin || env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith('sk_test_') || env.STRIPE_PUBLISHABLE_KEY && !env.STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_') || env.STRIPE_EXPECTED_ACCOUNT_ID && !/^acct_[A-Za-z0-9_]+$/.test(env.STRIPE_EXPECTED_ACCOUNT_ID) || env.CHECKOUT_VERIFY_SUBJECT && !validSubject(env.CHECKOUT_VERIFY_SUBJECT));
  if(missing.length || invalid){report.checks.configuration={status:'blocked',code:invalid?'INVALID_TEST_CONFIGURATION':'CHECKOUT_CONFIGURATION_INCOMPLETE',missing};return report;}
  report.checks.configuration={status:'configured',checkoutOrigin:origin.origin};
  let database;
  try {
    identity=identity || await registeredIdentity(env);
    const userId=env.CHECKOUT_VERIFY_SUBJECT.slice('portal:'.length);
    if(!identity.auth?.users?.some(user=>user.id===userId) || !identity.state?.users?.some(user=>user.id===userId && user.sample!==true)){
      report.checks.portalIdentity={status:'blocked',code:'REGISTERED_TEST_SUBJECT_REQUIRED'};return report;
    }
    report.checks.portalIdentity={status:'verified',subjectKey:env.CHECKOUT_VERIFY_SUBJECT};
    const {createCheckoutRepository,CHECKOUT_SCHEMA_VERSION}=await import('../src/checkout-repository.js');
    if(!repository){const {createDatabase}=await import('../src/connected-db.js');database=createDatabase(env.DATABASE_URL);repository=createCheckoutRepository({pool:database.pool});}
    const schema=(await repository.query('SELECT version FROM pp_checkout_schema_versions WHERE version=$1',[CHECKOUT_SCHEMA_VERSION])).rows;
    if(!schema.length){report.checks.database={status:'blocked',code:'CHECKOUT_SCHEMA_REQUIRED'};return report;}
    const subject=(await repository.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1',[env.CHECKOUT_VERIFY_SUBJECT])).rows[0];
    if(!subject || subject.provider_account_id!==env.STRIPE_EXPECTED_ACCOUNT_ID){report.checks.database={status:'blocked',code:'ENROLLED_TEST_SUBJECT_REQUIRED'};return report;}
    report.checks.database={status:'verified',schemaVersion:CHECKOUT_SCHEMA_VERSION};
    const {createStripeCheckoutProvider,CHECKOUT_STRIPE_API_VERSION}=await import('../src/checkout-stripe.js');
    provider=provider || createStripeCheckoutProvider({secretKey:env.STRIPE_SECRET_KEY,publishableKey:env.STRIPE_PUBLISHABLE_KEY,webhookSecret:env.STRIPE_WEBHOOK_SECRET,expectedAccountId:env.STRIPE_EXPECTED_ACCOUNT_ID});
    try{const account=await provider.verifyAccount();if((account.accountId || account.id)!==env.STRIPE_EXPECTED_ACCOUNT_ID || account.mode!=='test')throw new Error('account mismatch');report.checks.providerAccount={status:'verified',accountId:env.STRIPE_EXPECTED_ACCOUNT_ID,mode:'test',apiVersion:CHECKOUT_STRIPE_API_VERSION};}
    catch{report.checks.providerAccount={status:'failed',code:'STRIPE_ACCOUNT_VERIFICATION_FAILED'};return report;}
    const model=env.GEMINI_CHECKOUT_MODEL || env.GEMINI_MODEL || 'gemini-3.8-flash';
    try{
      const response=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({model,store:false,system_instruction:'This is a read-only capability check. Call checkout_capability_probe with an empty object exactly once. It has no purchase or payment capability.',input:'Check function calling support.',tools:[{type:'function',name:'checkout_capability_probe',description:'Read-only function calling capability probe.',parameters:{type:'object',properties:{},additionalProperties:false}}],generation_config:{max_output_tokens:200,thinking_level:'low'}}),signal:AbortSignal.timeout(20000)});
      const result=await response.json();const call=result.steps?.find(step=>step.type==='function_call' && step.name==='checkout_capability_probe');
      if(!response.ok || !call?.arguments || typeof call.arguments!=='object' || Array.isArray(call.arguments) || Object.keys(call.arguments).length)throw new Error('no tool');
      report.checks.modelCapability={status:'verified',model};
    }catch{report.checks.modelCapability={status:'failed',code:'GEMINI_FUNCTION_CALL_UNVERIFIED',model};}
    const intents=(await repository.query('SELECT * FROM pp_checkout_intents WHERE subject_key=$1 ORDER BY created_at DESC LIMIT 100',[env.CHECKOUT_VERIFY_SUBJECT])).rows;
    const observations=[];
    for(const intent of intents){
      const events=(await repository.query('SELECT data FROM pp_checkout_actions WHERE intent_id=$1 ORDER BY sequence',[intent.id])).rows.map(row=>row.data);
      const orders=(await repository.query('SELECT * FROM pp_checkout_orders WHERE intent_id=$1 AND subject_key=$2',[intent.id,env.CHECKOUT_VERIFY_SUBJECT])).rows;
      const attempts=orders.length?(await repository.query('SELECT * FROM pp_checkout_attempts WHERE order_id=$1',[orders[0].id])).rows:[];
      observations.push({intent,events,orders,attempts});
    }
    const toolEvents=observations.flatMap(row=>row.events.filter(event=>tools.has(event.tool)).map(event=>({intentId:row.intent.id,tool:event.tool,code:event.code==='OK'?'OK':'REFUSED'})));
    report.checks.modelTools={status:toolEvents.length?'observed':'not-verified',events:toolEvents,source:'Persisted application tool activity; model capability is checked separately.'};
    const verified=[];
    for(const row of observations.filter(row=>row.attempts[0]?.payment_id)){
      const order=row.orders[0],attempt=row.attempts[0],expected=attempt.data?.request;
      try{
        const payment=await provider.getPayment(attempt.payment_id);
        if(payment.id!==attempt.payment_id || payment.livemode!==false || payment.accountId!==env.STRIPE_EXPECTED_ACCOUNT_ID || payment.orderId!==order.id || payment.amountCents!==order.amount_cents || payment.currency?.toUpperCase()!=='USD' || payment.customerId!==expected?.customerId || payment.paymentMethodId!==expected?.paymentMethodId)throw new Error('mismatch');
        verified.push({...row,payment});
      }catch{/* Record no success from an unverifiable provider result. */}
    }
    const success=verified.find(row=>row.intent.state==='confirmed' && row.payment.status==='succeeded');
    report.checks.successfulOrder=success?{status:'verified',intentId:success.intent.id,orderId:success.orders[0].id,paymentId:success.payment.id,totalCents:success.payment.amountCents,currency:'USD'}:{status:'not-verified'};
    const blocked=observations.find(row=>row.intent.state==='blocked' && row.intent.data?.error?.code==='AMOUNT_LIMIT_EXCEEDED' && !row.orders.length && !row.attempts.length);
    report.checks.blockedAmount=blocked?{status:'verified',intentId:blocked.intent.id,maxAmountCents:blocked.intent.max_amount_cents,dispatchRecords:0,enforcement:'PerkPilot blocked submission before Stripe'}:{status:'not-verified'};
    const received=(await repository.query('SELECT data FROM pp_checkout_events WHERE provider_account_id=$1 AND environment=$2 AND state=$3',[env.STRIPE_EXPECTED_ACCOUNT_ID,'test','processed'])).rows.map(row=>row.data);
    const delivered=success && received.some(event=>event.paymentId===success.payment.id);
    report.checks.signedWebhook={status:delivered?'observed':'not-verified',source:'Processed events from signed webhook ingestion; confirm local forwarding during the walkthrough.'};
    const declined=verified.find(row=>row.intent.state==='payment_failed' && row.payment.status==='requires_payment_method' && row.payment.code==='PAYMENT_DECLINED');
    report.checks.decline=declined?{status:'verified',paymentId:declined.payment.id,state:'payment_failed'}:{status:'not-verified'};
    report.checks.challenge={status:'interactive-check-required',detail:'Complete a documented test authentication challenge in the actual Stripe browser fields and confirm the resulting payment. A mocked challenge is not provider evidence.'};
    report.checks.replay=success?{status:success.orders.length===1 && success.attempts.length===1?'observed':'failed',orderRecords:success.orders.length,attemptRecords:success.attempts.length,paymentId:success.payment.id,detail:'One persisted operation observed; duplicate-click and restart exercises require separately recorded runs.'}:{status:'not-verified'};
    const recovered=verified.find(row=>row.payment.status==='succeeded' && row.events.some(event=>event.code==='PAYMENT_OUTCOME_UNKNOWN'));
    report.checks.timeoutRecovery=recovered?{status:'observed',paymentId:recovered.payment.id,orderId:recovered.orders[0].id}:{status:'not-verified'};
    report.checks.postgresConcurrency={status:'separate-test-required',detail:'Run the real PostgreSQL suite with TEST_CHECKOUT_DATABASE_URL. In-memory tests do not verify database locks or rollback.'};
    report.acceptanceComplete=false;
    return report;
  }catch{report.checks.database={status:'failed',code:'CHECKOUT_IDENTITY_OR_DATABASE_UNAVAILABLE'};return report;}
  finally{if(database)await database.close();}
}

export async function runCheckoutVerification(args=process.argv.slice(2)) {
  let path=resolve('test-results/checkout/verification.json');
  if(args.length){if(args.length!==2 || args[0]!=='--report')throw new Error('Use --report <path> only.');path=resolve(args[1]);}
  const report=await collectCheckoutVerification();
  await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(`Checkout verification: acceptance incomplete. Redacted report: ${path}`);
  if(report.checks.configuration.status==='blocked')console.log('Test configuration is incomplete or invalid; no provider verification was run.');
  return report;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runCheckoutVerification().then(report=>{if(!report.acceptanceComplete)process.exitCode=1;}).catch(()=>{console.error('Checkout verification could not write its redacted report.');process.exitCode=1;});
}
