import {randomUUID} from 'node:crypto';
import {fail,requireValue} from './errors.js';
import {createCheckoutRoutes} from './checkout-routes.js';

export async function createCheckoutRuntime({auth,store,pool,provider,now=Date.now,agentFactory,config={}}={}) {
 const enabled=config.enabled ?? process.env.PERKPILOT_CHECKOUT_ENABLED==='1';
 if(!enabled)return{routes:{handle:async()=>false,handleWebhook:async()=>false},capabilities:()=>({enabled:false,ready:false}),start:async()=>{},close:async()=>{},beforeLogout:async()=>{},beforeWalletRemove:async()=>{}};
 const origin=config.origin || process.env.CHECKOUT_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
 let parsed;try{parsed=new URL(origin);}catch{fail('INVALID_CHECKOUT_ORIGIN','Configure a local checkout origin.',503);}
 requireValue(parsed.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) && parsed.origin===origin,'INVALID_CHECKOUT_ORIGIN','Checkout requires an exact loopback portal origin.',503);
 requireValue(auth?.data?.users && auth?.data?.sessions && store?.data?.users,'INVALID_CHECKOUT_AUTH','Portal identity stores are required.',503);
 function resolvePrincipal(sessionOrRequest) {
  let session=sessionOrRequest;
  if(sessionOrRequest?.headers){const token=sessionOrRequest.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('perkpilot_session='))?.slice('perkpilot_session='.length);session=auth.lookup(token);}
  requireValue(session?.kind==='portal' && typeof session.digest==='string' && session.expiresAt>now(),'REGISTERED_USER_REQUIRED','A registered portal session is required.',403);
  const live=auth.data.sessions.find(value=>value.digest===session.digest && value.userId===session.userId && value.kind==='portal' && value.expiresAt>now());
  const identity=auth.data.users.find(value=>value.id===session.userId),user=store.data.users.find(value=>value.id===session.userId);
  requireValue(live && identity && user && user.sample!==true && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id),'REGISTERED_USER_REQUIRED','A registered portal session is required.',403);
  return{subjectKey:'portal:'+user.id,userId:user.id,sessionDigest:session.digest};
 }
 function isSessionActive(principal){try{const session=auth.data.sessions.find(value=>value.digest===principal?.sessionDigest);const current=resolvePrincipal(session);return current.subjectKey===principal.subjectKey&&current.userId===principal.userId;}catch{return false;}}
 function getWalletCards(principal){requireValue(isSessionActive(principal),'REGISTERED_USER_REQUIRED','The authorizing session is no longer active.',403);return(store.data.cards||[]).filter(card=>card.userId===principal.userId);}
 const authAdapter={resolvePrincipal,isSessionActive,getWalletCards,isActive:isSessionActive,listWalletCards:getWalletCards,getWalletCard:(principal,id)=>getWalletCards(principal).find(card=>card.id===id)};
 let ownedDatabase=null;
 if(!pool&&!config.repository){const {createDatabase}=await import('./connected-db.js');ownedDatabase=createDatabase(config.databaseUrl);pool=ownedDatabase.pool;}
 const {createCheckoutRepository,CHECKOUT_SCHEMA_VERSION}=await import('./checkout-repository.js');
 const repository=config.repository || createCheckoutRepository({pool,now,demoConfig:(config.demoControls ?? process.env.PERKPILOT_CHECKOUT_DEMO_CONTROLS==='1')?{enabled:true,demoControls:true,origin,databaseUrl:config.databaseUrl || process.env.DATABASE_URL,providerAccountId:config.providerAccountId || provider?.accountId || process.env.STRIPE_EXPECTED_ACCOUNT_ID}:null});
 if(!provider){const {createStripeCheckoutProvider}=await import('./checkout-stripe.js');provider=createStripeCheckoutProvider({secretKey:process.env.STRIPE_SECRET_KEY,publishableKey:process.env.STRIPE_PUBLISHABLE_KEY,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,expectedAccountId:process.env.STRIPE_EXPECTED_ACCOUNT_ID});}
 const {createCheckoutMerchant}=await import('./checkout-merchant.js');
 const merchant=config.merchant || createCheckoutMerchant({repository,now,providerAccountId:provider.accountId});
 let service=config.service;
 if(!service){const {createCheckoutService}=await import('./checkout-service.js');service=createCheckoutService({repository,merchant,provider,authAdapter,now});}
 let agent=config.agent;
 if(!agent){const {createCheckoutAgent}=await import('./checkout-agent.js');agent=(agentFactory || createCheckoutAgent)({service,repository,now,apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_CHECKOUT_MODEL || process.env.GEMINI_MODEL});}
 let verifiedDatabase=false,verifiedProvider=false,started=false,closed=false,pollTimer,polling=false,activePoll=null,lastMaintenance=-Infinity;
 const workerId=randomUUID(),controllers=new Set(),activeRuns=new Set();
 const capabilities=()=>({enabled:true,ready:verifiedDatabase&&verifiedProvider&&agent.configured===true,database:{configured:true,verified:verifiedDatabase},provider:{configured:true,verified:verifiedProvider,mode:'test'},agent:{configured:agent.configured===true,verified:false,model:agent.model},webhook:{configured:Boolean(process.env.STRIPE_WEBHOOK_SECRET),verified:false},providerMode:'test',publishableKey:provider.publishableKey});
 async function finishUndispatched(id,state,code) {
  await repository.transaction(async tx=>{
   const hint=(await tx.query('SELECT subject_key FROM pp_checkout_intents WHERE id=$1',[id])).rows[0];if(!hint)return;
   await tx.query('SELECT subject_key FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[hint.subject_key]);
   const row=(await tx.query('SELECT * FROM pp_checkout_intents WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row || !['queued','running'].includes(row.state))return;
   const order=(await tx.query('SELECT id FROM pp_checkout_orders WHERE intent_id=$1',[id])).rows[0];if(order)return;
   await tx.query('UPDATE pp_checkout_intents SET state=$1,revoked_at=$2,data=$3 WHERE id=$4',[state,now(),{...row.data,error:{code,message:state==='agent_failed'?'AI checkout preparation failed. A new approval is required.':'The purchase permission is no longer active.'}},id]);
   await tx.query('UPDATE pp_checkout_jobs SET state=$1 WHERE intent_id=$2',[state,id]);
  });
 }
 async function runIntent(intent) {
  const digest=intent.sessionDigest || intent.permission?.sessionDigest;
  let principal;try{principal=resolvePrincipal(auth.data.sessions.find(session=>session.digest===digest));}catch{await finishUndispatched(intent.id,'cancelled','PERMISSION_REVOKED');return;}
  if(now()>=intent.expiresAt){await finishUndispatched(intent.id,'expired','PERMISSION_EXPIRED');return;}
  const claimed=await repository.claimRun(intent.id,workerId);if(!claimed)return;
  const controller=new AbortController();controllers.add(controller);
  const renewal=setInterval(()=>{repository.renewRun(intent.id,workerId).then(ok=>{if(!ok)controller.abort();}).catch(()=>controller.abort());},15000);renewal.unref?.();
  try{await agent.run({principal,intentId:intent.id},{signal:controller.signal});}
  catch(error){if(service.markAgentFailed)await service.markAgentFailed({principal,intentId:intent.id},error);else await finishUndispatched(intent.id,'agent_failed',typeof error.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'AGENT_FAILED');}
  finally{clearInterval(renewal);controllers.delete(controller);}
 }
 async function poll() {
  if(!started||closed||polling)return;polling=true;
  try{if(service.maintenance && now()-lastMaintenance>=5000){lastMaintenance=now();try{await service.maintenance();}catch{/* Retry durable housekeeping on the next tick. */}}
   for(const intent of await repository.listRecoverable()){
   if(closed)break;
   if(['payment_pending','requires_action'].includes(intent.state)){try{await service.reconcile(intent.id);}catch{/* Persisted payment remains reconcilable; no model retry. */}}
   else{const task=runIntent(intent);activeRuns.add(task);task.finally(()=>activeRuns.delete(task)).catch(()=>{});await task;}
  }}finally{polling=false;}
 }
 function schedulePoll(){if(!polling)activePoll=poll().catch(()=>{});}
 async function start() {
  requireValue(!closed,'CHECKOUT_CLOSED','Checkout runtime is closed.',503);if(started)return;
  try{const schema=await repository.query('SELECT version FROM pp_checkout_schema_versions WHERE version=$1',[CHECKOUT_SCHEMA_VERSION]);requireValue(schema.rows.some(row=>row.version===CHECKOUT_SCHEMA_VERSION),'CHECKOUT_SCHEMA_REQUIRED','Run the explicit checkout migration before startup.',503);verifiedDatabase=true;await provider.verifyAccount();verifiedProvider=true;requireValue(agent.configured===true,'AGENT_NOT_CONFIGURED','Configure Gemini before enabling checkout.',503);}
  catch(error){if(ownedDatabase)await ownedDatabase.close();throw error;}
  started=true;pollTimer=setInterval(schedulePoll,1000);pollTimer.unref?.();schedulePoll();
 }
 async function close(){closed=true;started=false;clearInterval(pollTimer);for(const controller of controllers)controller.abort();let timeout;await Promise.race([Promise.allSettled([...activeRuns,...(activePoll?[activePoll]:[])]),new Promise(resolveClose=>{timeout=setTimeout(resolveClose,30000);})]);clearTimeout(timeout);if(ownedDatabase){await ownedDatabase.close();ownedDatabase=null;}}
 function asPrincipal(value){try{return value?.subjectKey?value:resolvePrincipal(value);}catch(error){if(error.code==='REGISTERED_USER_REQUIRED')return null;throw error;}}
 async function beforeLogout(sessionOrPrincipal){const principal=asPrincipal(sessionOrPrincipal);if(!principal)return;return service.revokeSession(principal);}
 async function beforeWalletRemove(sessionOrPrincipal,cardId){const principal=asPrincipal(sessionOrPrincipal);if(!principal)return;const methods=await service.listMethods(principal);if(methods.some(method=>method.cardId===cardId || method.walletCardId===cardId))return service.removeMethod(principal,cardId);return{ok:true};}
 const routes=createCheckoutRoutes({service,merchant,provider,resolvePrincipal,capabilities,origin,now,onAuthorized:()=>{if(started)queueMicrotask(schedulePoll);}});
 return {routes,service,repository,merchant,provider,agent,authAdapter,resolvePrincipal,capabilities,start,close,beforeLogout,beforeWalletRemove};
}
