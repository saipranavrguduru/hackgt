import {randomUUID,createHash} from 'node:crypto';
import {fail,requireValue} from './errors.js';
import {rankPaymentCards,validatePermission} from './checkout-policy.js';
import {checkoutIntentFromRow} from './checkout-repository.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal=new Set(['confirmed','payment_failed','blocked','cancelled','expired','agent_failed']);
const messages={AMOUNT_LIMIT_EXCEEDED:'The merchant total exceeds the amount you authorized. No payment was submitted.',PURCHASE_SCOPE_CHANGED:'The purchase no longer matches your permission.',PERMISSION_EXPIRED:'Your purchase permission expired. Review and approve a new purchase.',PERMISSION_REVOKED:'This purchase permission is no longer active.',CARD_NOT_ALLOWED:'The selected card is no longer the best eligible enrolled card.',NO_ELIGIBLE_CARD:'Enroll an eligible test card before buying.',QUOTE_EXPIRED:'The payment quote expired. Prepare a new quote.',CART_CHANGED:'The merchant cart changed. Request a fresh quote.',PAYMENT_MISMATCH:'The provider result requires reconciliation.',AGENT_FAILED:'The agent could not finish preparation. Review a new purchase to try again.'};
const methodView=row=>({id:row.id,cardId:row.card_id,productId:row.product_id,brand:row.data.brand,last4:row.data.last4,active:row.active,sourceLabel:'Test card · reward product selected by you'});
const permissionCard=row=>({...methodView(row),subjectKey:row.subject_key,providerAccountId:row.provider_account_id,revokedAt:row.revoked_at});

export function createCheckoutService({repository,merchant,provider,authAdapter,now=Date.now,resolveCatalogReference}) {
  const locks=new Map();
  const query=(sql,params=[])=>repository.query(sql,params);
  const accountId=provider.accountId;
  async function serial(key,fn) {
    const previous=locks.get(key)||Promise.resolve();let release;const next=new Promise(resolve=>{release=resolve;});locks.set(key,next);
    await previous;try{return await fn();}finally{release();if(locks.get(key)===next)locks.delete(key);}
  }
  async function assertPrincipal(principal) {
    requireValue(principal?.subjectKey?.startsWith('portal:') && typeof principal.sessionDigest==='string','REGISTERED_USER_REQUIRED','Sign in with your registered portal account.',403);
    requireValue(await authAdapter.isSessionActive(principal),'LOGIN_REQUIRED','Your session ended. Sign in again.',401);
  }
  async function wallet(principal) {return await authAdapter.getWalletCards(principal);}
  async function ownedIntent(principal,id,tx=repository,lock=false) {
    const row=(await tx.query(`SELECT * FROM pp_checkout_intents WHERE id=$1 AND subject_key=$2${lock?' FOR UPDATE':''}`,[id,principal.subjectKey])).rows[0];
    requireValue(row,'NOT_FOUND','Purchase not found.',404);return {...checkoutIntentFromRow(row),data:row.data,sessionDigest:row.session_digest};
  }
  async function activeMethods(principal,tx=repository) {
    const cards=await wallet(principal);
    const rows=(await tx.query('SELECT * FROM pp_checkout_methods WHERE subject_key=$1 AND provider_account_id=$2 AND active=true',[principal.subjectKey,accountId])).rows;
    return rows.filter(row=>cards.some(c=>c.id===row.card_id && c.productId===row.product_id));
  }
  async function event(id,code,state) {await repository.appendAction(id,{code,state});}
  async function setState(intent,state,error=null,tx=repository) {
    const data={...intent.data,...(error?{error}:{})};
    await tx.query('UPDATE pp_checkout_intents SET state=$1,data=$2 WHERE id=$3',[state,data,intent.id]);
    if(terminal.has(state))await tx.query('UPDATE pp_checkout_jobs SET state=$1 WHERE intent_id=$2',[state,intent.id]);
  }
  async function block(intent,code,totalCents) {
    const state=code==='PERMISSION_EXPIRED'?'expired':'blocked';
    const current=await ownedIntent({subjectKey:intent.subjectKey},intent.id);
    if(!['queued','running'].includes(current.state))return;
    const message=code==='AMOUNT_LIMIT_EXCEEDED' && Number.isSafeInteger(totalCents)?`The merchant total is now $${(totalCents/100).toFixed(2)}, above your $${(current.maxAmountCents/100).toFixed(2)} approval. No payment was submitted.`:messages[code]||'The purchase does not meet your approved terms.';
    await setState(current,state,{code,message});await event(intent.id,code,state);
  }
  async function ensureCustomer(principal) {
    const subject=await repository.ensureSubject(principal);
    requireValue(!subject.revoked_at,'PERMISSION_REVOKED','Payment profile is unavailable.',403);
    requireValue(!subject.provider_account_id || subject.provider_account_id===accountId,'PROVIDER_ACCOUNT_MISMATCH','Payment account configuration changed.',503);
    if(subject.customer_id)return subject.customer_id;
    const customer=await provider.createCustomer({subjectKey:principal.subjectKey,idempotencyKey:`pp:customer:${hash(principal.subjectKey)}`});
    requireValue(customer?.id && customer.livemode!==true,'INVALID_PROVIDER_RESULT','Customer setup failed.',502);
    await query('UPDATE pp_checkout_subjects SET provider_account_id=$1,customer_id=$2 WHERE subject_key=$3',[accountId,customer.id,principal.subjectKey]);return customer.id;
  }
  async function startEnrollment(principal,{walletCardId,saveConsent}) {
    await assertPrincipal(principal);requireValue(saveConsent===true,'CONSENT_REQUIRED','Agree to save this test method for future purchases.');
    return serial(principal.subjectKey,async()=>{
      const card=(await wallet(principal)).find(c=>c.id===walletCardId);requireValue(card,'NOT_FOUND','Wallet card not found.',404);
      requireValue(!(await activeMethods(principal)).some(m=>m.card_id===walletCardId),'CARD_ALREADY_ENROLLED','This card is already enrolled.',409);
      requireValue((await activeMethods(principal)).length<10,'CARD_LIMIT','A maximum of ten cards can be enrolled.',409);
      const customerId=await ensureCustomer(principal),enrollmentId=randomUUID();
      const setup=await provider.createEnrollment({customerId,idempotencyKey:`pp:setup:${enrollmentId}`});
      requireValue(setup?.id && setup.customerId===customerId && setup.livemode!==true,'INVALID_PROVIDER_RESULT','The payment setup could not be verified.',502);
      await query('INSERT INTO pp_checkout_enrollments(id,subject_key,card_id,provider_account_id,customer_id,setup_id,state,consent_at,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[setup.id,principal.subjectKey,walletCardId,accountId,customerId,setup.id,'pending',now(),now(),{productId:card.productId}]);
      return {id:setup.id,clientSecret:setup.clientSecret};
    });
  }
  async function completeEnrollment(principal,id) {
    await assertPrincipal(principal);
    return serial(principal.subjectKey,async()=>{
      const row=(await query('SELECT * FROM pp_checkout_enrollments WHERE id=$1 AND subject_key=$2',[id,principal.subjectKey])).rows[0];
      requireValue(row,'NOT_FOUND','Enrollment not found.',404);
      requireValue((await wallet(principal)).some(c=>c.id===row.card_id && c.productId===row.data.productId),'NOT_FOUND','Wallet card no longer exists.',404);
      const existing=(await query('SELECT * FROM pp_checkout_methods WHERE setup_id=$1 AND subject_key=$2',[id,principal.subjectKey])).rows[0];
      if(existing)return methodView(existing);
      const setup=await provider.getEnrollment(row.setup_id);
      requireValue(setup?.status==='succeeded' && setup.livemode===false && setup.customerId===row.customer_id && setup.paymentMethodId,'ENROLLMENT_NOT_READY','The test card setup has not completed.',409);
      const method=await provider.getPaymentMethod(setup.paymentMethodId);
      requireValue(method?.type==='card' && method.livemode===false && method.customerId===row.customer_id,'PAYMENT_METHOD_MISMATCH','This payment method does not belong to your payment profile.',403);
      requireValue(!method.accountId || method.accountId===accountId,'PROVIDER_ACCOUNT_MISMATCH','Wrong payment account.',503);
      return repository.transaction(async tx=>{
        await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey]);
        const enrolled=await activeMethods(principal,tx);
        requireValue(enrolled.length<10,'CARD_LIMIT','A maximum of ten cards can be enrolled.',409);
        requireValue(!enrolled.some(m=>m.card_id===row.card_id),'CARD_ALREADY_ENROLLED','This card is already enrolled.',409);
        const conflict=(await tx.query('SELECT * FROM pp_checkout_methods WHERE provider_account_id=$1 AND payment_method_id=$2',[accountId,method.id])).rows[0];
        requireValue(!conflict,'METHOD_ALREADY_ENROLLED','This method has already been enrolled.',409);
        const inserted=(await tx.query('INSERT INTO pp_checkout_methods(id,subject_key,card_id,product_id,provider_account_id,setup_id,payment_method_id,active,consent_at,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[randomUUID(),principal.subjectKey,row.card_id,row.data.productId,accountId,id,method.id,true,Number(row.consent_at),now(),{brand:method.brand,last4:method.last4}])).rows[0];
        await tx.query("UPDATE pp_checkout_enrollments SET state='completed' WHERE id=$1",[id]);return methodView(inserted);
      });
    });
  }
  async function listMethods(principal) {await assertPrincipal(principal);return (await activeMethods(principal)).map(methodView);}
  async function listProducts(principal) {await assertPrincipal(principal);return merchant.listProducts(principal);}
  async function importCatalogProduct(principal,{checkoutReference}) {
    await assertPrincipal(principal);
    requireValue(typeof resolveCatalogReference==='function','CATALOG_CHECKOUT_UNAVAILABLE','Explore checkout is unavailable. Search again after restarting the checkout server.',503);
    return serial(principal.subjectKey,async()=>{
      const listing=await resolveCatalogReference(principal,checkoutReference);
      return merchant.importCatalogProduct(principal,{checkoutReference,listing});
    });
  }
  async function rateLimit(principal,table) {
    const rows=(await query(`SELECT id FROM ${table} WHERE subject_key=$1 AND created_at>$2`,[principal.subjectKey,now()-60000])).rows;
    requireValue(rows.length<3,'RATE_LIMITED','Wait a minute before preparing another purchase.',429);
  }
  async function createPreview(principal,input) {
    await assertPrincipal(principal);return serial(principal.subjectKey,async()=>{
    await rateLimit(principal,'pp_checkout_previews');
    const cards=await activeMethods(principal);requireValue(cards.length>0 && cards.length<=10,'NO_ELIGIBLE_CARD',messages.NO_ELIGIBLE_CARD,409);
    const snapshot=await merchant.previewCart(principal,input);
    requireValue(snapshot.cart.providerAccountId===accountId,'PROVIDER_ACCOUNT_MISMATCH','Test merchant account is not configured correctly.',503);
    requireValue(snapshot.cart.totalCents>0 && snapshot.cart.totalCents<=50000,'INVALID_PURCHASE','Purchase must be between $0.01 and $500.');
    const preview=await repository.createPreview(principal,{...snapshot,eligibleCardIds:cards.map(c=>c.card_id),cards:rankPaymentCards({cards:cards.map(permissionCard),cart:snapshot.cart})});
    return preview;
    });
  }
  async function authorize(principal,{previewId,maxAmountCents,approved}) {
    await assertPrincipal(principal);requireValue(approved===true,'APPROVAL_REQUIRED','Approve the displayed purchase permission.');
    return serial(principal.subjectKey,async()=>{
      const existing=(await query('SELECT id FROM pp_checkout_intents WHERE preview_id=$1 AND subject_key=$2',[previewId,principal.subjectKey])).rows[0];
      if(!existing){await rateLimit(principal,'pp_checkout_intents');const active=(await query("SELECT id FROM pp_checkout_intents WHERE subject_key=$1 AND state IN ('queued','running') AND expires_at>$2",[principal.subjectKey,now()])).rows;requireValue(active.length===0,'RUN_IN_PROGRESS','Finish or cancel the current purchase first.',409);}
      const intent=await repository.authorizePreview(principal,{previewId,maxAmountCents});return getStatus(principal,intent.id);
    });
  }
  async function readCart(context) {await assertPrincipal(context.principal);const intent=await ownedIntent(context.principal,context.intentId);return merchant.readCart(intent);}
  async function rankCards(context) {
    return serial(context.principal.subjectKey,async()=>{
    await assertPrincipal(context.principal);const intent=await ownedIntent(context.principal,context.intentId),cart=await merchant.readCart(intent);
    const methods=(await activeMethods(context.principal)).filter(m=>intent.permission.eligibleCardIds.includes(m.card_id));
    const rankedCards=rankPaymentCards({cards:methods.map(permissionCard),cart});
    const check=validatePermission({intent,cart,cardId:rankedCards[0]?.cardId,activeCards:methods.map(permissionCard),now:now()});
    if(!check.allowed){await block(intent,check.code,cart.totalCents);fail(check.code,messages[check.code]||'Purchase not allowed.',409);}
    const quote={id:randomUUID(),intentId:intent.id,cart,rankedCards,createdAt:now(),expiresAt:now()+60000};
    await query('INSERT INTO pp_checkout_quotes(id,intent_id,created_at,expires_at,data) VALUES($1,$2,$3,$4,$5)',[quote.id,intent.id,quote.createdAt,quote.expiresAt,{cart,rankedCards}]);return quote;
    });
  }
  async function listIntents(principal) {
    await assertPrincipal(principal);
    const rows=(await query('SELECT id FROM pp_checkout_intents WHERE subject_key=$1 ORDER BY created_at DESC LIMIT 20',[principal.subjectKey])).rows;
    return Promise.all(rows.map(row=>getStatus(principal,row.id)));
  }
  async function getStatus(principal,id) {
    const intent=await ownedIntent(principal,id);
    const row=(await query('SELECT * FROM pp_checkout_orders WHERE intent_id=$1',[id])).rows[0];
    const events=(await query('SELECT * FROM pp_checkout_actions WHERE intent_id=$1 ORDER BY sequence',[id])).rows.map(a=>({...a.data,sequence:a.sequence,createdAt:Number(a.created_at)}));
    let order=null;
    if(row){const attempt=(await query('SELECT payment_id FROM pp_checkout_attempts WHERE order_id=$1',[row.id])).rows[0];order={orderId:row.id,paymentId:attempt?.payment_id||null,merchantName:'PerkPilot Test Store',totalCents:row.amount_cents,currency:row.currency,card:row.data.card,estimatedRewardCents:row.data.card?.estimatedRewardCents||0,selectionReason:'Highest estimated published base reward among your authorized enrolled cards.',providerMode:'test',confirmedAt:row.confirmed_at?Number(row.confirmed_at):null};}
    const approvedCart=intent.permission?.cart || {};
    const cart={sku:approvedCart.sku,variantId:approvedCart.variantId,name:approvedCart.name,quantity:approvedCart.quantity};
    return {id:intent.id,previewId:intent.previewId,cart,state:intent.state,maxAmountCents:intent.maxAmountCents,expiresAt:intent.expiresAt,events,order,error:intent.data.error||null};
  }
  async function executePurchase(context,{quoteId,cardId}) {
    const {principal,intentId}=context;
    return serial(principal.subjectKey,async()=>{
      let dispatch;
      try{dispatch=await repository.transaction(async tx=>{
        await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey]);
        const intent=await ownedIntent(principal,intentId,tx,true);
        const existing=(await tx.query('SELECT id FROM pp_checkout_orders WHERE intent_id=$1',[intentId])).rows[0];
        if(existing)return null;
        await assertPrincipal(principal);
        requireValue(intent.sessionDigest===principal.sessionDigest,'PERMISSION_REVOKED',messages.PERMISSION_REVOKED,403);
        await tx.query('SELECT sku FROM pp_checkout_products WHERE sku=$1 AND variant_id=$2 FOR UPDATE',[intent.permission.sku,intent.permission.variantId]);
        const cart=await merchant.readCart(intent,{tx}),methods=await activeMethods(principal,tx);
        const decision=validatePermission({intent,cart,cardId,activeCards:methods.map(permissionCard),now:now()});
        if(!decision.allowed)throw Object.assign(new Error(messages[decision.code]||'Purchase is not permitted.'),{code:decision.code,status:409,cartTotalCents:cart.totalCents});
        const q=(await tx.query('SELECT * FROM pp_checkout_quotes WHERE id=$1 AND intent_id=$2',[quoteId,intentId])).rows[0];
        requireValue(q && Number(q.expires_at)>now(),'QUOTE_EXPIRED',messages.QUOTE_EXPIRED,409);
        requireValue(hash(q.data.cart)===hash(cart),'CART_CHANGED',messages.CART_CHANGED,409);
        const method=methods.find(m=>m.card_id===cardId),subject=(await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1',[principal.subjectKey])).rows[0];
        requireValue(method?.payment_method_id && subject?.customer_id && subject.provider_account_id===accountId,'CARD_NOT_ALLOWED',messages.CARD_NOT_ALLOWED,409);
        const id=randomUUID(),card=rankPaymentCards({cards:[permissionCard(method)],cart})[0];
        await tx.query('INSERT INTO pp_checkout_orders(id,intent_id,subject_key,sku,variant_id,quantity,amount_cents,currency,card_id,state,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,intentId,principal.subjectKey,cart.sku,cart.variantId,cart.quantity,cart.totalCents,'USD',cardId,'payment_pending',now(),{cart,card}]);
        await merchant.reserve(tx,id,cart);
        const request={orderId:id,customerId:subject.customer_id,paymentMethodId:method.payment_method_id,amountCents:cart.totalCents,currency:'USD',idempotencyKey:`pp-checkout:${id}:payment:v1`};
        await tx.query('INSERT INTO pp_checkout_attempts(id,order_id,idempotency_key,request_digest,state,dispatched_at,data) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),id,request.idempotencyKey,hash(request),'dispatching',now(),{request}]);
        await setState(intent,'payment_pending',null,tx);await tx.query("UPDATE pp_checkout_jobs SET state='dispatched' WHERE intent_id=$1",[intentId]);return {intent,request};
      });}catch(error){
        if(['AMOUNT_LIMIT_EXCEEDED','PURCHASE_SCOPE_CHANGED','PERMISSION_EXPIRED','CARD_NOT_ALLOWED','NO_ELIGIBLE_CARD','OUT_OF_STOCK'].includes(error.code)){const intent=await ownedIntent(principal,intentId);await block(intent,error.code,error.cartTotalCents);}
        throw error;
      }
      if(!dispatch)return getStatus(principal,intentId);
      await event(intentId,'PAYMENT_DISPATCHED','payment_pending');
      try{await applyPayment(dispatch.intent,await provider.submitPayment(dispatch.request));}
      catch(error){await event(intentId,error.code==='PAYMENT_MISMATCH'?'PAYMENT_MISMATCH':'PAYMENT_OUTCOME_UNKNOWN','payment_pending');}
      return getStatus(principal,intentId);
    });
  }
  function verifyPayment(result,attempt) {
    const expected=attempt.data.request;
    requireValue(result?.id && result.livemode===false && result.accountId===accountId && result.orderId===expected.orderId && result.amountCents===expected.amountCents && result.currency?.toUpperCase()===expected.currency && result.customerId===expected.customerId && result.paymentMethodId===expected.paymentMethodId,'PAYMENT_MISMATCH',messages.PAYMENT_MISMATCH,502);
    requireValue(!attempt.payment_id || result.id===attempt.payment_id,'PAYMENT_MISMATCH',messages.PAYMENT_MISMATCH,502);
  }
  async function applyPayment(intent,result) {
    await repository.transaction(async tx=>{
      await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[intent.subjectKey]);
      const current=await ownedIntent({subjectKey:intent.subjectKey},intent.id,tx,true);
      const order=(await tx.query('SELECT * FROM pp_checkout_orders WHERE intent_id=$1',[intent.id])).rows[0];
      const attempt=(await tx.query('SELECT * FROM pp_checkout_attempts WHERE order_id=$1 FOR UPDATE',[order.id])).rows[0];verifyPayment(result,attempt);
      if(['confirmed','payment_failed'].includes(current.state))return;
      let state='payment_pending';
      if(result.status==='succeeded')state='confirmed';
      else if(result.status==='requires_action')state='requires_action';
      else if(['canceled','requires_payment_method'].includes(result.status))state='payment_failed';
      await tx.query('UPDATE pp_checkout_attempts SET payment_id=$1,state=$2,last_reconciled_at=$3 WHERE id=$4',[result.id,result.status,now(),attempt.id]);
      if(state==='confirmed')await merchant.finalize(tx,order.id,'confirmed');
      else if(state==='payment_failed')await merchant.finalize(tx,order.id,'released');
      else await tx.query('UPDATE pp_checkout_orders SET state=$1 WHERE id=$2',[state,order.id]);
      await setState(current,state,state==='payment_failed'?{code:result.code||'PAYMENT_FAILED',message:'The test payment was not completed. Review a new purchase to try again.'}:null,tx);
    });
  }
  async function reconcile(id) {
    const hint=(await query('SELECT * FROM pp_checkout_intents WHERE id=$1',[id])).rows[0];if(!hint)return null;
    return serial(hint.subject_key,async()=>{
      const intent=await ownedIntent({subjectKey:hint.subject_key},id);
      if(!['payment_pending','requires_action'].includes(intent.state))return getStatus({subjectKey:hint.subject_key},id);
      const order=(await query('SELECT * FROM pp_checkout_orders WHERE intent_id=$1',[id])).rows[0];if(!order)return getStatus({subjectKey:hint.subject_key},id);
      let attempt=(await query('SELECT * FROM pp_checkout_attempts WHERE order_id=$1',[order.id])).rows[0];
      if(attempt.last_reconciled_at && now()-Number(attempt.last_reconciled_at)<5000)return getStatus({subjectKey:hint.subject_key},id);
      await query('UPDATE pp_checkout_attempts SET last_reconciled_at=$1 WHERE id=$2',[now(),attempt.id]);
      try{
        let result;
        if(attempt.payment_id)result=await provider.getPayment(attempt.payment_id);
        else if(now()-Number(attempt.dispatched_at)<23*60*60*1000)result=await provider.submitPayment(attempt.data.request);
        else {await event(id,'OPERATOR_RECONCILIATION_REQUIRED','payment_pending');return getStatus({subjectKey:hint.subject_key},id);}
        if(result.status==='requires_action' && now()-Number(attempt.dispatched_at)>600000)result=await provider.cancelPayment(result.id);
        await applyPayment(intent,result);
      }catch{await event(id,'RECONCILIATION_PENDING',intent.state);}
      return getStatus({subjectKey:hint.subject_key},id);
    });
  }
  async function processWebhook(row) {
    const paymentId=row.data.paymentId;
    if(paymentId){
      const attempt=(await query('SELECT * FROM pp_checkout_attempts WHERE payment_id=$1',[paymentId])).rows[0];
      const orderId=attempt?.order_id || row.data.orderId;
      const order=orderId?(await query('SELECT intent_id FROM pp_checkout_orders WHERE id=$1',[orderId])).rows[0]:null;
      if(order){
        const hint=(await query('SELECT subject_key FROM pp_checkout_intents WHERE id=$1',[order.intent_id])).rows[0];
        // Re-fetch the provider object: signed but stale events cannot regress state.
        await serial(hint.subject_key,async()=>applyPayment(await ownedIntent({subjectKey:hint.subject_key},order.intent_id),await provider.getPayment(paymentId)));
      }
    }
    await query("UPDATE pp_checkout_events SET state='processed',processed_at=$1 WHERE id=$2",[now(),row.id]);
  }
  async function acceptWebhook(incoming) {
    requireValue(incoming?.id && incoming.accountId===accountId && incoming.livemode===false,'INVALID_WEBHOOK','Webhook account or environment mismatch.',400);
    const data={type:incoming.type,paymentId:incoming.payment?.id||null,orderId:incoming.payment?.orderId||null};
    const row=(await query('INSERT INTO pp_checkout_events(id,provider_account_id,environment,provider_event_id,received_at,state,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider_account_id,environment,provider_event_id) DO NOTHING RETURNING *',[randomUUID(),accountId,'test',incoming.id,now(),'received',data])).rows[0];
    if(row){try{await processWebhook(row);}catch{/* The worker retries the durable event. */}}
    return {received:true};
  }
  async function maintenance() {
    const events=(await query("SELECT * FROM pp_checkout_events WHERE state='received' AND provider_account_id=$1 ORDER BY received_at LIMIT 20",[accountId])).rows;
    for(const row of events){try{await processWebhook(row);}catch{/* Retry on the next bounded worker tick. */}}
    const methods=(await query('SELECT * FROM pp_checkout_methods WHERE active=false AND provider_account_id=$1',[accountId])).rows.filter(row=>!row.data.detached).slice(0,20);
    for(const row of methods){await serial(row.subject_key,async()=>{
      const pending=(await query("SELECT id FROM pp_checkout_orders WHERE subject_key=$1 AND card_id=$2 AND state IN ('payment_pending','requires_action')",[row.subject_key,row.card_id])).rows;
      if(pending.length)return;
      try{await provider.detachMethod(row.payment_method_id);await query('UPDATE pp_checkout_methods SET data=$1 WHERE id=$2',[{...row.data,detached:true},row.id]);}catch{/* Durable revocation already blocks selection. */}
    });}
  }
  async function getPaymentAction(principal,id) {
    await assertPrincipal(principal);const intent=await ownedIntent(principal,id);requireValue(intent.state==='requires_action','NO_PAYMENT_ACTION','No bank authentication is pending.',409);
    const order=(await query('SELECT id FROM pp_checkout_orders WHERE intent_id=$1',[id])).rows[0],attempt=(await query('SELECT * FROM pp_checkout_attempts WHERE order_id=$1',[order.id])).rows[0];
    const result=await provider.getPayment(attempt.payment_id);verifyPayment(result,attempt);requireValue(result.status==='requires_action' && result.clientSecret,'NO_PAYMENT_ACTION','The payment status changed. Refresh the order.',409);return {clientSecret:result.clientSecret};
  }
  async function cancel(principal,id) {
    await assertPrincipal(principal);return serial(principal.subjectKey,()=>repository.transaction(async tx=>{
      await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey]);const intent=await ownedIntent(principal,id,tx,true);
      const order=(await tx.query('SELECT id FROM pp_checkout_orders WHERE intent_id=$1',[id])).rows[0];requireValue(!order,'PAYMENT_IN_FLIGHT','Payment was already submitted. Its status will be reconciled.',409);
      if(!terminal.has(intent.state)){await tx.query('UPDATE pp_checkout_intents SET revoked_at=$1 WHERE id=$2',[now(),id]);await setState(intent,'cancelled',null,tx);}return {id,state:'cancelled'};
    }));
  }
  async function revokeSession(principal) {
    if(!principal)return;
    return serial(principal.subjectKey,()=>repository.transaction(async tx=>{
      await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey]);
      await tx.query("UPDATE pp_checkout_intents SET state='cancelled',revoked_at=$1 WHERE subject_key=$2 AND session_digest=$3 AND state IN ('queued','running')",[now(),principal.subjectKey,principal.sessionDigest]);
    }));
  }
  async function removeMethod(principal,id) {
    await assertPrincipal(principal);return serial(principal.subjectKey,async()=>{
      const row=(await query('SELECT * FROM pp_checkout_methods WHERE subject_key=$1 AND (id=$2 OR card_id=$2)',[principal.subjectKey,id])).rows[0];if(!row)return {ok:true};
      await repository.transaction(async tx=>{await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey]);await tx.query('UPDATE pp_checkout_methods SET active=false,revoked_at=$1 WHERE id=$2',[now(),row.id]);await tx.query("UPDATE pp_checkout_intents SET state='cancelled',revoked_at=$1 WHERE subject_key=$2 AND state IN ('queued','running')",[now(),principal.subjectKey]);});
      const pending=(await query("SELECT id FROM pp_checkout_orders WHERE subject_key=$1 AND card_id=$2 AND state IN ('payment_pending','requires_action')",[principal.subjectKey,row.card_id])).rows;
      if(!pending.length){try{await provider.detachMethod(row.payment_method_id);await query('UPDATE pp_checkout_methods SET data=$1 WHERE id=$2',[{...row.data,detached:true},row.id]);}catch{/* Revocation is already durable; provider detach can retry. */}}
      return {ok:true};
    });
  }
  async function markAgentFailed(context,error) {
    return serial(context.principal.subjectKey,async()=>{
    const intent=await ownedIntent(context.principal,context.intentId);
    if(['queued','running'].includes(intent.state)){await setState(intent,'agent_failed',{code:'AGENT_FAILED',message:messages.AGENT_FAILED});await query('UPDATE pp_checkout_intents SET revoked_at=$1 WHERE id=$2',[now(),intent.id]);await event(intent.id,typeof error?.code==='string'?error.code:'AGENT_FAILED','agent_failed');}
    });
  }
  return {startEnrollment,completeEnrollment,listMethods,listProducts,importCatalogProduct,removeMethod,createPreview,authorize,readCart,rankCards,executePurchase,getStatus,listIntents,getPaymentAction,cancel,reconcile,acceptWebhook,maintenance,revokeSession,markAgentFailed};
}
