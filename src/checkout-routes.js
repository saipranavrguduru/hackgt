import {fail,requireValue} from './errors.js';
import {catalogReferenceValid} from './checkout-catalog.js';
const BASE='/api/v1/agent-checkout';
const safeKeys=new Set(['previewId','id','state','enabled','ready','configured','verified','database','schema','provider','agent','model','providerMode','accountId','publishableKey','webhook','enrollment','missing','error','code','message','maxAmountCents','events','order','orderId','paymentId','merchantId','merchantName','sku','variantId','quantity','destinationId','destinationHash','destinationLabel','shippingOptionId','currency','category','merchandiseCents','taxCents','shippingCents','totalCents','revision','stock','description','name','cart','rankedCards','eligibleCards','eligibleCardIds','cards','methods','products','product','sourceMerchantName','observedAt','destinations','label','fictitious','createdAt','expiresAt','card','cardId','walletCardId','productId','brand','last4','estimatedRewardCents','rateBps','sourceUrl','selectionReason','confirmedAt','tool','sequence','quoteId','checks','ok','statusUrl','setupId','mode','reason','requiresAction','paymentAction','permission','termsVersion','sourceLabel','active','destination','permissions','rewardBps','estimatedReward','enrolled','requiresSetup']);
function project(value,{allowSecret=false}={},depth=0) {
 if(depth>12)return null;
 if(value===null || typeof value==='boolean' || typeof value==='number' || typeof value==='string')return value;
 if(Array.isArray(value))return value.map(item=>project(item,{allowSecret},depth+1));
 if(typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>safeKeys.has(key) || allowSecret&&key==='clientSecret').map(([key,item])=>[key,project(item,{allowSecret},depth+1)]));
 return null;
}
async function readBytes(req,limit) {
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;requireValue(length<=limit,limit===262144?'WEBHOOK_TOO_LARGE':'BODY_TOO_LARGE','Request exceeds the allowed body size.',413);chunks.push(chunk);}
 return Buffer.concat(chunks);
}
async function readJSON(req,supplied) {
 requireValue(req.headers['content-type']?.split(';')[0]==='application/json','JSON_REQUIRED','Send application/json.',415);
 let body=supplied;
 if(body===undefined){const bytes=await readBytes(req,16384);try{body=bytes.length?JSON.parse(bytes.toString('utf8')):{};}catch{fail('INVALID_JSON','Malformed JSON.');}}
 requireValue(body && typeof body==='object' && !Array.isArray(body),'INVALID_JSON','Send a JSON object.');
 requireValue(Buffer.byteLength(JSON.stringify(body))<=16384,'BODY_TOO_LARGE','Request exceeds the allowed body size.',413);
 return body;
}
function fields(body,allowed,required=allowed){requireValue(Object.keys(body).every(key=>allowed.includes(key)) && required.every(key=>Object.hasOwn(body,key)),'INVALID_CHECKOUT_REQUEST','Use only the required checkout fields.');}
const idValid=value=>typeof value==='string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value);
const identityFields=(body,keys)=>requireValue(keys.every(key=>idValid(body[key])),'INVALID_CHECKOUT_REQUEST','Checkout identifiers are invalid.');
export function createCheckoutRoutes({service,merchant,provider,resolvePrincipal,capabilities,origin,onAuthorized=()=>{},now=Date.now}) {
 const originURL=new URL(origin);const limits=new Map(),seenApprovals=new Map(),reconciles=new Map();
 function send(res,value,status=200,allowSecret=false){if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(project(value,{allowSecret})));}
 function error(res,err){const status=err.status || err.statusCode || 500;send(res,{error:{code:typeof err.code==='string'?err.code:'CHECKOUT_FAILED',message:status>=500?'Checkout could not complete this request.':err.message}},status);}
 function quota(subject,kind,maximum=3){const key=subject+':'+kind,time=now(),entries=(limits.get(key)||[]).filter(value=>value>time-60000);requireValue(entries.length<maximum,'RATE_LIMITED','Please wait before starting another checkout.',429);entries.push(time);limits.set(key,entries);}
 async function handleWebhook(req,res) {
  const pathname=new URL(req.url,origin).pathname;
  if(pathname!==BASE+'/webhooks/stripe')return false;
  try{requireValue(req.method==='POST','METHOD_NOT_ALLOWED','Use POST for webhooks.',405);requireValue(req.headers.host===originURL.host,'INVALID_HOST','Use the configured checkout address.',403);const raw=await readBytes(req,262144);const event=provider.verifyWebhook(raw,req.headers['stripe-signature']);await service.acceptWebhook(event);send(res,{ok:true});}catch(err){error(res,err);}
  return true;
 }
 async function handle(req,res,{principal,body:suppliedBody}={}) {
  const pathname=new URL(req.url,origin).pathname;
  if(pathname!==BASE && !pathname.startsWith(BASE+'/'))return false;
  if(pathname===BASE+'/webhooks/stripe')return handleWebhook(req,res);
  try {
   requireValue(req.headers.host===originURL.host,'INVALID_HOST','Use the configured checkout address.',403);
   requireValue(!req.headers.authorization,'SCOPE_FORBIDDEN','Checkout requires a portal session without bearer credentials.',403);
   requireValue(!req.headers.origin || req.headers.origin===origin,'ORIGIN_REJECTED','Checkout request origin is not permitted.',403);
   if(!['GET','HEAD'].includes(req.method))requireValue(req.headers.origin===origin && req.headers['sec-fetch-site']!=='cross-site','ORIGIN_REJECTED','Checkout request origin is not permitted.',403);
   const owner=principal || await resolvePrincipal(req);
   requireValue(owner?.subjectKey?.startsWith('portal:') && owner.sessionDigest,'REGISTERED_USER_REQUIRED','Sign in with a registered portal account.',403);
   const path=pathname.slice(BASE.length),method=req.method;
   const body=['POST','DELETE','PATCH'].includes(method)?await readJSON(req,suppliedBody):{};
   if(path==='/capabilities' && method==='GET')return send(res,await capabilities()),true;
   if(path==='/products' && method==='GET')return send(res,await (service.listProducts?service.listProducts(owner):merchant.listProducts(owner))),true;
   if(path==='/catalog-products' && method==='POST'){fields(body,['checkoutReference']);requireValue(catalogReferenceValid(body.checkoutReference),'INVALID_CHECKOUT_REQUEST','Select a current Explore product.');quota(owner.subjectKey,'catalog-import',20);send(res,await service.importCatalogProduct(owner,body),201);return true;}
   if(path==='/intents' && method==='GET')return send(res,await service.listIntents(owner)),true;
   if(path==='/methods' && method==='GET')return send(res,await service.listMethods(owner)),true;
   if(path==='/enrollments' && method==='POST'){fields(body,['walletCardId','saveConsent']);identityFields(body,['walletCardId']);requireValue(body.saveConsent===true,'SAVE_CONSENT_REQUIRED','Agree to save this test method.');send(res,await service.startEnrollment(owner,body),201,true);return true;}
   const enrollment=path.match(/^\/enrollments\/([^/]+)\/complete$/);
   if(enrollment && method==='POST'){fields(body,[]);send(res,await service.completeEnrollment(owner,decodeURIComponent(enrollment[1])));return true;}
   const removed=path.match(/^\/methods\/([^/]+)$/);
   if(removed && method==='DELETE'){fields(body,[]);send(res,await service.removeMethod(owner,decodeURIComponent(removed[1])));return true;}
   if(path==='/previews' && method==='POST'){fields(body,['sku','variantId','quantity','destinationId']);identityFields(body,['sku','variantId','destinationId']);requireValue(Number.isSafeInteger(body.quantity)&&body.quantity>=1&&body.quantity<=10,'INVALID_CHECKOUT_REQUEST','Quantity must be 1–10.');quota(owner.subjectKey,'preview');send(res,await service.createPreview(owner,body),201);return true;}
   if(path==='/intents' && method==='POST'){
    fields(body,['previewId','maxAmountCents','approved']);identityFields(body,['previewId']);requireValue(body.approved===true && Number.isSafeInteger(body.maxAmountCents)&&body.maxAmountCents>=0&&body.maxAmountCents<=50000,'INVALID_CHECKOUT_REQUEST','Explicit approval and a valid maximum are required.');
    const key=owner.subjectKey+':'+body.previewId;
    if(!seenApprovals.has(key)){quota(owner.subjectKey,'intent');seenApprovals.set(key,now());}
    const view=await service.authorize(owner,body);await onAuthorized(view.id);send(res,{...view,statusUrl:BASE+'/intents/'+view.id},202);return true;
   }
   const intent=path.match(/^\/intents\/([^/]+)(?:\/(cancel|payment-action|reconcile))?$/);
   if(intent){const id=decodeURIComponent(intent[1]);requireValue(idValid(id),'INVALID_CHECKOUT_REQUEST','Intent ID is invalid.');const action=intent[2];
    if(!action&&method==='GET'){send(res,await service.getStatus(owner,id));return true;}
    if(action==='payment-action'&&method==='GET'){send(res,await service.getPaymentAction(owner,id),200,true);return true;}
    if(method==='POST'&&['cancel','reconcile'].includes(action)){fields(body,[]);if(action==='cancel')send(res,await service.cancel(owner,id));else{await service.getStatus(owner,id);const time=now(),previous=reconciles.get(id);requireValue(previous===undefined||time-previous>=5000,'RATE_LIMITED','Wait before checking payment again.',429);reconciles.set(id,time);await service.reconcile(id);send(res,await service.getStatus(owner,id));}return true;}
   }
   fail('NOT_FOUND','Checkout endpoint not found.',404);
  }catch(err){error(res,err);}
  return true;
 }
 return {handle,handleWebhook};
}
