import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { StateStore } from './state.js';
import { AuthStore, digest } from './auth.js';
import { fail, requireValue } from './errors.js';
import { providerReadiness } from './providers.js';
import * as domain from './domain.js';
import * as research from './research.js';
import * as catalog from './card-catalog.js';
import { assistantAnswer, interpretMission } from './ai.js';
import { createNearbyPlacesService, validateLocationInput } from './places.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = join(root, 'public');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const money = value => Number.isSafeInteger(value) && value >= 0;
const owned = (rows, id, userId) => { const row = rows.find(item => item.id === id && item.userId === userId); requireValue(row,'NOT_FOUND','This record was not found.',404); return row; };
const cardProducts = () => catalog.CARD_PRODUCTS || catalog.cardProducts || catalog.CARD_CATALOG || [];
const cleanUser = user => ({id:user.id,name:user.name,email:user.email,sample:!!user.sample,consent:!!user.consent,preferences:user.preferences});

async function readBody(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) fail('BODY_TOO_LARGE','Request is too large.',413); }
  if (!raw) return {};
  requireValue(req.headers['content-type']?.split(';')[0] === 'application/json','JSON_REQUIRED','Send JSON with application/json.',415);
  try { const body = JSON.parse(raw); requireValue(body && typeof body === 'object' && !Array.isArray(body),'INVALID_JSON','Expected a JSON object.'); return body; }
  catch(error) { if (error.code) throw error; fail('INVALID_JSON','Request body must be valid JSON.'); }
}

export function createApplication(options = {}) {
  const mode = options.mode || process.env.PERKPILOT_MODE || 'demo';
  const persist = options.persist !== false;
  const dir = options.dataDir || join(root,'data');
  const store = new StateStore(persist ? join(dir,'state.json') : null);
  const auth = new AuthStore(persist ? join(dir,'auth.json') : null);
  let checkoutRuntime = options.checkoutRuntime || null;
  const endCheckoutSession = async (req,token) => {
    if(checkoutRuntime)await checkoutRuntime.beforeLogout(req);
    if(token)auth.logout(token);
  };
  const pairingAttempts = new Map();
  // Throttling holds user IDs and timestamps only, never coordinates or place history.
  const locationAttempts = new Map();
  const nearbyPlaces = createNearbyPlacesService({fetchImpl:options.locationFetch || fetch});
  const portalPort = Number(options.port ?? process.env.PORT ?? 3000);
  const storePort = Number(options.storePort ?? process.env.STORE_PORT ?? 3001);
  const allowedHost = options.origin ? new URL(options.origin).host : null;
  const scoped = (key,userId) => (store.data[key] || []).filter(row => row.userId === userId);
  const summary = userId => {
    const result = domain.savingsSummary(store.data,userId);
    return {...result,confirmedCents:result.confirmedCents ?? result.totalCents ?? result.confirmedSavingsCents ?? 0};
  };
  const feed = userId => {
    const result = domain.rankOffers(store.data,userId);
    if(!Array.isArray(result)) return {offers:result.offers || result.ranked || result.opportunities || [],suppressed:result.suppressed || []};
    const visible=result.filter(offer=>offer.score>=24).slice(0,4);
    const suppressed=store.data.offers.filter(offer=>offer.published!==false && !visible.some(item=>item.id===offer.id)).map(offer=>{
      const ranked=result.find(item=>item.id===offer.id);
      return {id:offer.id,title:offer.title,merchantId:offer.merchantId,reason:ranked?(ranked.score<24?'No meaningful connection to this profile; a large discount alone is not enough.':'Other opportunities are more relevant; the feed stays short.'):'Expired, muted, dismissed, unassigned, or unverified stacking terms. Excluded from ready recommendations.'};
    });
    return {offers:visible,suppressed};
  };
  const cookie = (res,token,req) => res.setHeader('Set-Cookie',`perkpilot_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?43200:0}${req.socket.encrypted?'; Secure':''}`);
  const portalUrl = req => `http://${req.headers.host?.startsWith('127.0.0.1')?'127.0.0.1':'localhost'}:${req.socket.localPort === storePort ? portalPort : req.socket.localPort}`;

  function validateCurrentQuote(quote,userId) {
    requireValue(quote && quote.userId===userId,'NOT_FOUND','Quote not found.',404);
    requireValue(quote.validUntil > Date.now(),'QUOTE_EXPIRED','This quote expired. Review a fresh quote.',409);
    requireValue(!store.data.purchases.some(p=>p.userId===userId && p.quoteId===quote.id),'QUOTE_ALREADY_PURCHASED','This quote has already been purchased. A new purchase requires a new review.',409);
    if(quote.sourceCartId) { const current=store.data.storeCarts.find(c=>c.id===quote.sourceCartId); requireValue(current && current.expiresAt>Date.now() && current.revision===quote.sourceCartRevision,'CART_CHANGED','Your merchant cart changed. Review a fresh quote before approving.',409); }
    requireValue(!quote.provisional && quote.executable !== false,'PROVISIONAL_QUOTE','Tax or shipping is unknown, or no connected demo card is available.',409);
    const product = store.data.products.find(p=>p.id===quote.cart.productId);
    requireValue(product && JSON.stringify(product)===quote.productSnapshot,'CART_CHANGED','The cart changed. Review a fresh quote before approving.',409);
    const user=store.data.users.find(u=>u.id===userId);
    requireValue(JSON.stringify(user.activatedOfferIds || []) === quote.activationSnapshot,'QUOTE_CHANGED','Offer activation changed. Review a fresh quote.',409);
    if(domain.validateQuote) { const validation=domain.validateQuote(store.data,userId,quote.id); requireValue(validation.valid,'QUOTE_CHANGED',validation.reasons?.join(' ') || 'Quote changed. Review a fresh quote.',409); }
  }
  function checkoutView(session,req) {
    const quote = owned(store.data.quotes,session.quoteId,session.userId);
    return {...session,quote,plan:quote.plans.find(p=>p.cardId===session.cardId),approvalUrl:`${portalUrl(req)}/?checkout=${session.id}`};
  }

  async function handler(req,res) {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','geolocation=(self)');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://production.plaid.com https://development.plaid.com https://sandbox.plaid.com http://localhost:3000 http://127.0.0.1:3000; frame-src https://cdn.plaid.com https://*.plaid.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(checkoutRuntime)res.setHeader('Content-Security-Policy',String(res.getHeader('Content-Security-Policy')).replace("script-src 'self'", "script-src 'self' https://js.stripe.com https://*.js.stripe.com").replace("connect-src 'self'", "connect-src 'self' https://api.stripe.com").replace('frame-src ', 'frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com '));
    const send = (body,status=200) => { if (!res.writableEnded) { store.save(); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); } };
    try {
      requireValue(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '') || req.headers.host === allowedHost,'INVALID_HOST','Use the configured application address.',403);
      const url = new URL(req.url,`http://${req.headers.host}`);
      const method = req.method;
      const path = url.pathname.replace(/^\/api\/v1/,'');
      const api = url.pathname.startsWith('/api/v1/');
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
      const token = bearer || req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('perkpilot_session='))?.slice('perkpilot_session='.length);
      const session = auth.lookup(token);
      // This exact signed endpoint consumes raw bytes before the normal JSON and
      // browser-origin checks. All other checkout routes retain browser guards.
      if(checkoutRuntime && url.pathname==='/api/v1/agent-checkout/webhooks/stripe') {
        await checkoutRuntime.routes.handleWebhook(req,res);return;
      }
      const origin = req.headers.origin;
      const extensionOrigin = origin?.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1];
      const sameOrigin = !origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
      const pairingRoute = /^\/extension\/pairings(?:\/[^/]+\/exchange)?$/.test(path);
      const extensionAllowed = !!extensionOrigin && ((pairingRoute && (!process.env.PERKPILOT_EXTENSION_ID || process.env.PERKPILOT_EXTENSION_ID === extensionOrigin)) || (session?.kind==='extension' && session.extensionId===extensionOrigin));
      if (origin && (sameOrigin || extensionAllowed)) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Idempotency-Key'); res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS'); }
      if (method === 'OPTIONS') {
        const knownExtension=extensionOrigin && auth.data.sessions.some(s=>s.kind==='extension' && s.extensionId===extensionOrigin && s.expiresAt>Date.now());
        requireValue(sameOrigin || extensionAllowed || knownExtension,'ORIGIN_REJECTED','Origin is not permitted.',403);
        if(knownExtension) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Idempotency-Key'); res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS'); }
        res.writeHead(204); return res.end();
      }
      if (api && !['GET','HEAD'].includes(method)) requireValue(extensionAllowed || (sameOrigin && req.headers['sec-fetch-site'] !== 'cross-site'),'ORIGIN_REJECTED','Cross-origin changes are not permitted.',403);
      if (!api) {
        requireValue(method==='GET' || method==='HEAD','METHOD_NOT_ALLOWED','Method not allowed.',405);
        const file = url.pathname==='/' ? 'index.html' : url.pathname==='/store' ? 'store.html' : decodeURIComponent(url.pathname).slice(1);
        const target = resolve(publicRoot,file);
        requireValue(target.startsWith(publicRoot + '/'),'NOT_FOUND','Not found.',404);
        let content; try { content=await readFile(target); } catch { fail('NOT_FOUND','Page not found.',404); }
        res.writeHead(200,{'Content-Type':mime[extname(target)] || 'application/octet-stream','Cache-Control':'no-cache'}); return res.end(method==='HEAD'?undefined:content);
      }
      if(path==='/health') return send(providerReadiness(mode),mode==='demo'?200:503);
      if(path==='/agent-checkout' || path.startsWith('/agent-checkout/')) {
        if(checkoutRuntime){await checkoutRuntime.routes.handle(req,res);return;}
        const checkoutUser=session?.kind==='portal' && !bearer && store.data.users.find(user=>user.id===session.userId && !user.sample);
        requireValue(checkoutUser,'REGISTERED_USER_REQUIRED','Sign in with a registered portal account.',403);
        if(path==='/agent-checkout/capabilities' && method==='GET')return send({enabled:false,ready:false,providerMode:'test',missing:['Start checkout after configuring Stripe test keys.']});
        fail('CHECKOUT_DISABLED','Test checkout is not configured yet.',503);
      }
      requireValue(mode==='demo','LIVE_PROVIDER_UNAVAILABLE',providerReadiness(mode).message,503);
      const body = ['POST','PATCH','DELETE'].includes(method) ? await readBody(req) : {};
      const state = store.data;
      if(session?.kind==='extension' && path.startsWith('/auth/')) fail('SCOPE_FORBIDDEN','This connection cannot access account identity.',403);
      if(path==='/store/products' && method==='GET') return send({products:state.products.filter(p=>['alo','nike'].includes(p.merchantId)),mode,portalUrl:`http://localhost:${portalPort}`});
      const cartSnapshot=record=>{
        const product=state.products.find(p=>p.id===record.productId);
        return {id:record.id,revision:record.revision,expiresAt:record.expiresAt,cart:{productId:product.id,quantity:record.quantity,merchandiseCents:product.priceCents*record.quantity,shippingCents:product.shippingCents,taxCents:product.taxCents,currency:product.currency,version:product.version}};
      };
      if(path==='/store/carts' && method==='POST') {
        const product=state.products.find(p=>p.id===body.productId && ['alo','nike'].includes(p.merchantId));
        requireValue(product,'NOT_FOUND','Controlled product not found.',404);
        const quantity=body.quantity ?? 1; requireValue(Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=10,'INVALID_QUANTITY','Quantity must be 1–10.');
        state.storeCarts=state.storeCarts.filter(c=>c.expiresAt>Date.now()); requireValue(state.storeCarts.length<1000,'CART_LIMIT','Too many active demo carts.',429);
        const secret=randomBytes(24).toString('base64url');
        const record={id:randomUUID(),secretDigest:digest(secret),productId:product.id,quantity,revision:1,expiresAt:Date.now()+2*60*60e3};
        state.storeCarts.push(record); return send({...cartSnapshot(record),secret},201);
      }
      const storeCart=path.match(/^\/store\/carts\/([^/]+)$/);
      if(storeCart && ['GET','PATCH'].includes(method)) {
        const record=state.storeCarts.find(c=>c.id===storeCart[1] && c.expiresAt>Date.now()); requireValue(record,'NOT_FOUND','Cart expired. Reload the storefront.',404);
        if(method==='PATCH') { requireValue(digest(body.secret)===record.secretDigest,'CART_FORBIDDEN','Cart update is not authorized.',403); requireValue(Number.isSafeInteger(body.quantity)&&body.quantity>=1&&body.quantity<=10,'INVALID_QUANTITY','Quantity must be 1–10.'); record.quantity=body.quantity;record.revision++; }
        return send(cartSnapshot(record));
      }
      if(path==='/auth/session' && method==='GET') return send({user:session ? cleanUser(state.users.find(u=>u.id===session.userId)) : null,mode});
      if(path==='/auth/register' && method==='POST') {
        const account=auth.register(body);
        const user={...account,sample:false,consent:false,preferences:{interests:[],mutedMerchants:[],mutedCategories:[],excludedTransactions:[]},activatedOfferIds:[]};
        state.users.push(user); await endCheckoutSession(req,token); cookie(res,auth.issue(user.id),req); return send({user:cleanUser(user)},201);
      }
      if(path==='/auth/login' && method==='POST') { const raw=auth.login(body.email,body.password,req.socket.remoteAddress); await endCheckoutSession(req,token); cookie(res,raw,req); return send({user:cleanUser(state.users.find(u=>u.id===auth.lookup(raw).userId))}); }
      if(path==='/auth/demo' && method==='POST') { const user=state.users.find(u=>u.id===body.userId && u.sample); requireValue(user,'INVALID_PROFILE','Choose Alex or Taylor.'); await endCheckoutSession(req,token); cookie(res,auth.issue(user.id),req); return send({user:cleanUser(user)}); }
      if(path==='/auth/logout' && method==='POST') { await endCheckoutSession(req,token); cookie(res,'',req); return send({ok:true}); }
      if(path==='/extension/pairings' && method==='POST') {
        requireValue(typeof body.extensionId==='string' && /^[a-p]{32}$/.test(body.extensionId),'INVALID_EXTENSION','A valid extension ID is required.');
        if(extensionOrigin) requireValue(body.extensionId===extensionOrigin,'ORIGIN_REJECTED','Extension origin does not match.',403);
        const recent=pairingAttempts.get(req.socket.remoteAddress)||[];
        const active=recent.filter(time=>time>Date.now()-60e3); requireValue(active.length<20,'RATE_LIMITED','Too many pairing requests.',429); active.push(Date.now()); pairingAttempts.set(req.socket.remoteAddress,active);
        const secret=randomBytes(32).toString('base64url');
        const pairing={id:randomUUID(),secretDigest:digest(secret),extensionId:body.extensionId,expiresAt:Date.now()+5*60e3,approved:false,used:false};
        state.pairings.push(pairing); return send({id:pairing.id,secret,expiresAt:pairing.expiresAt,approvalUrl:`${portalUrl(req)}/?pairing=${pairing.id}`},201);
      }
      const exchange=path.match(/^\/extension\/pairings\/([^/]+)\/exchange$/);
      if(exchange && method==='POST') {
        const pair=state.pairings.find(p=>p.id===exchange[1]);
        requireValue(pair && pair.expiresAt>Date.now() && pair.secretDigest===digest(body.secret),'INVALID_PAIRING','Pairing is invalid or expired.',403);
        requireValue(!pair.used,'PAIRING_USED','This pairing has already been exchanged.',409);
        requireValue(pair.approved,'PAIRING_PENDING','Approve this connection in the portal first.',409);
        if(extensionOrigin) requireValue(pair.extensionId===extensionOrigin,'ORIGIN_REJECTED','Wrong extension origin.',403);
        pair.used=true;
        const raw=auth.issue(pair.userId,{kind:'extension',extensionId:pair.extensionId,ttl:30*60e3});
        return send({token:raw,expiresAt:auth.lookup(raw).expiresAt});
      }
      requireValue(session,'LOGIN_REQUIRED','Sign in, or explicitly choose a sample profile.',401);
      const userId=session.userId;
      const user=state.users.find(u=>u.id===userId);
      requireValue(user,'LOGIN_REQUIRED','This profile is no longer available.',401);
      if(session.kind==='extension') {
        const allowed=(method==='POST' && (path==='/commerce/quotes' || /^\/commerce\/offers\/[^/]+\/activate$/.test(path) || path==='/checkout/sessions')) || (method==='GET' && (/^\/commerce\/quotes\/[^/]+$/.test(path) || /^\/checkout\/sessions\/[^/]+$/.test(path) || /^\/research\/products\/[^/]+\/brief$/.test(path))) || (method==='DELETE' && path==='/extension/session');
        requireValue(allowed,'SCOPE_FORBIDDEN','This connection does not permit that action.',403);
      }
      if(path==='/location/recommendations' && method==='POST') return send(domain.recommendLocationCards(state,userId,body));
      if(path==='/location/nearby' && method==='POST') {
        const location = validateLocationInput(body);
        const cutoff = Date.now() - 60e3;
        for (const [id,times] of locationAttempts) {
          const recent = times.filter(time => time > cutoff);
          if (recent.length) locationAttempts.set(id,recent); else locationAttempts.delete(id);
        }
        const attempts = locationAttempts.get(userId) || [];
        requireValue(attempts.length < 6,'LOCATION_RATE_LIMITED','Nearby search is limited to six attempts per minute. Choose a category manually or try again shortly.',429);
        attempts.push(Date.now()); locationAttempts.set(userId,attempts);
        return send(await nearbyPlaces(location));
      }
      if(path==='/extension/session' && method==='DELETE') { auth.logout(token); return send({ok:true}); }
      const pairingApprove=path.match(/^\/extension\/pairings\/([^/]+)(\/approve)?$/);
      if(pairingApprove) {
        const pair=state.pairings.find(p=>p.id===pairingApprove[1]);
        requireValue(pair && !pair.used && pair.expiresAt>Date.now(),'INVALID_PAIRING','Pairing expired or was already used.',409);
        if(method==='POST' && pairingApprove[2]) { requireValue(!pair.approved || pair.userId===userId,'PAIRING_OWNED','Pairing was already approved.',409); pair.approved=true; pair.userId=userId; return send({approved:true}); }
        if(method==='GET') return send({id:pair.id,extensionId:pair.extensionId,expiresAt:pair.expiresAt,approved:pair.approved});
      }
      if(path==='/bootstrap' && method==='GET') {
        const ranked=feed(userId);
        return send({user:cleanUser(user),profile:domain.getProfile(state,userId),...ranked,notifications:scoped('notifications',userId),cards:scoped('cards',userId),cardProducts:cardProducts(),accounts:scoped('accounts',userId),transactions:scoped('transactions',userId),products:state.products,merchants:state.merchants,missions:scoped('missions',userId),watches:scoped('watches',userId),purchases:scoped('purchases',userId),savings:summary(userId),mode,now:state.now || state.clock,storeUrl:`http://localhost:${storePort}`,finance:domain.financeSummary(state,userId)});
      }
      if(path==='/profile' && method==='GET') return send(domain.getProfile(state,userId));
      if(path==='/profile/regenerate' && method==='POST') return send(domain.getProfile(state,userId));
      if(path==='/preferences' && method==='GET') return send({...user.preferences,consent:user.consent});
      if((path==='/preferences'||path==='/profile') && method==='PATCH') {
        if(body.consent!==undefined) { requireValue(typeof body.consent==='boolean','INVALID_CONSENT','Consent must be a boolean.'); user.consent=body.consent; }
        for(const key of ['interests','mutedMerchants','mutedCategories','excludedTransactions','excludedTransactionIds','savedOfferIds','dismissedOfferIds']) if(body[key]!==undefined) {
          requireValue(Array.isArray(body[key]) && body[key].length<=100 && body[key].every(v=>typeof v==='string' && v.length<=120),'INVALID_PREFERENCE','Preferences must be a bounded list of text values.');
          user.preferences[key==='excludedTransactionIds'?'excludedTransactions':key]=[...new Set(body[key])];
        }
        for(const key of ['notificationsEnabled','quietHours']) if(body[key]!==undefined) user.preferences[key]=body[key];
        return send({user:cleanUser(user),profile:domain.getProfile(state,userId),preferences:user.preferences});
      }
      if(path==='/finance/summary' && method==='GET') return send(domain.financeSummary(state,userId));
      if(path==='/finance/spending-summary' && method==='POST') return send(domain.financeSummary(state,userId,body));
      if(path==='/finance/transactions' && method==='GET') return send(scoped('transactions',userId));
      if(path==='/finance/cards' && method==='GET') return send(scoped('cards',userId));
      if(path==='/finance/card-products' && method==='GET') return send(cardProducts());
      if(path==='/finance/cards' && method==='POST') {
        const product=cardProducts().find(p=>p.id===body.productId); requireValue(product,'INVALID_CARD','Choose a known card product.');
        requireValue(!scoped('cards',userId).some(c=>c.productId===product.id),'CARD_EXISTS','This card is already in your Wallet.',409);
        const card={...product,id:randomUUID(),userId,productId:product.id,selfReported:true,source:'self-reported',sourceLabel:'Self-reported · comparison only',provenance:'self_reported',paymentReference:null,verified:false}; state.cards.push(card); return send(card,201);
      }
      const cardDelete=path.match(/^\/finance\/cards\/([^/]+)$/);
      if(cardDelete && method==='DELETE') { owned(state.cards,cardDelete[1],userId); if(checkoutRuntime)await checkoutRuntime.beforeWalletRemove(req,cardDelete[1]); state.cards=state.cards.filter(c=>c.id!==cardDelete[1]); return send({ok:true}); }
      if(path==='/commerce/offers' && method==='GET') return send(feed(userId));
      const offerAction=path.match(/^\/commerce\/offers\/([^/]+)\/(activate|feedback)$/);
      if(offerAction && method==='POST') {
        if(offerAction[2]==='activate') return send(domain.activateOffer(state,userId,offerAction[1]));
        const offer=state.offers.find(o=>o.id===offerAction[1]); requireValue(offer,'NOT_FOUND','Offer not found.',404);
        requireValue(['save','dismiss','not-relevant'].includes(body.feedback),'INVALID_FEEDBACK','Choose save or dismiss.');
        const key=body.feedback==='save'?'savedOfferIds':'dismissedOfferIds'; user.preferences[key] ||= []; if(!user.preferences[key].includes(offer.id)) user.preferences[key].push(offer.id); return send({ok:true});
      }
      if(path==='/demo/offers/publish' && method==='POST') {
        requireValue(user.sample,'DEMO_ONLY','Publishing is available in sample profiles.',403);
        const offer=state.offers.find(o=>o.id===(body.offerId||'alo-sale')); requireValue(offer,'NOT_FOUND','Offer not found.',404); offer.published=true; offer.status='active';
        const notices=domain.evaluateNotifications(state,userId,{id:body.eventId || `publish:${offer.id}`,offerId:offer.id}); return send({offer,notifications:notices,...feed(userId)});
      }
      if(['/notifications','/commerce/notifications'].includes(path) && method==='GET') return send(scoped('notifications',userId));
      const notice=path.match(/^\/(?:commerce\/)?notifications\/([^/]+)$/);
      if(notice && method==='PATCH') { const record=owned(state.notifications,notice[1],userId); record.read=body.read===true; record.dismissed=body.dismissed===true; return send(record); }
      if(path==='/commerce/missions' && method==='GET') return send(scoped('missions',userId));
      if(path==='/commerce/missions' && method==='POST') { const interpreted=await interpretMission(body); return send({...domain.createMission(state,userId,interpreted),interpretationMode:interpreted.interpretationMode},201); }
      const mission=path.match(/^\/commerce\/missions\/([^/]+)(\/matches)?$/);
      if(mission) {
        const record=owned(state.missions,mission[1],userId);
        if(method==='DELETE') { state.missions=state.missions.filter(m=>m.id!==record.id); return send({ok:true}); }
        if(method==='PATCH') { const update=domain.createMission(state,userId,{...record,...body}); Object.assign(record,update,{id:record.id}); state.missions=state.missions.filter(m=>m.id!==update.id); return send(record); }
        if(method==='GET') return send(mission[2]?domain.missionMatches(state,userId,record):record);
      }
      if(path==='/research/sessions' && method==='POST') { const record=research.createResearchSession(state,userId,body); return send({session:record,candidates:record.candidates || research.searchProducts(state,userId,body).candidates},201); }
      const researchSession=path.match(/^\/research\/sessions\/([^/]+)(\/candidates)?$/);
      if(researchSession) {
        const record=owned(state.researchSessions,researchSession[1],userId);
        if(method==='PATCH') { const updated=research.createResearchSession(state,userId,{...record,...body}); Object.assign(record,updated,{id:record.id}); state.researchSessions=state.researchSessions.filter(r=>r.id!==updated.id); return send({session:record,candidates:record.candidates}); }
        if(method==='GET') return send(researchSession[2]?record.candidates:{session:record,candidates:record.candidates});
      }
      const brief=path.match(/^\/research\/products\/([^/]+)\/brief$/);
      if(brief && method==='GET') { const source=url.searchParams.get('sessionId'); const sessionRecord=source?owned(state.researchSessions,source,userId):null; return send(research.getResearchBrief(state,userId,brief[1],sessionRecord?.requirements || {})); }
      if(path==='/research/comparisons' && method==='POST') { if(body.sessionId) owned(state.researchSessions,body.sessionId,userId); return send(research.compareProducts(state,userId,body),201); }
      const comparison=path.match(/^\/research\/comparisons\/([^/]+)$/);
      if(comparison && method==='GET') return send(owned(state.comparisons,comparison[1],userId));
      if(['/research/watches','/research/watchlist'].includes(path)) {
        if(method==='GET') return send(scoped('watches',userId));
        if(method==='POST') return send(research.watchProduct(state,userId,body),201);
        if(method==='PATCH') { const record=owned(state.watches,body.id,userId); requireValue(money(body.targetPriceCents),'INVALID_AMOUNT','Target price must be cents.'); record.targetPriceCents=body.targetPriceCents; return send(record); }
      }
      const watch=path.match(/^\/research\/(?:watches|watchlist)\/([^/]+)$/);
      if(watch && method==='DELETE') { owned(state.watches,watch[1],userId); state.watches=state.watches.filter(w=>w.id!==watch[1]); return send({ok:true}); }
      if(path==='/demo/listings/price' && method==='POST') { requireValue(user.sample,'DEMO_ONLY','Use a sample profile.',403); return send(research.applyListingEvent(state,userId,body)); }
      if(path==='/commerce/quotes' && method==='POST') {
        const product=state.products.find(p=>p.id===body.productId); requireValue(product,'NOT_FOUND','Product not found.',404);
        const quantity=body.quantity ?? body.cart?.quantity ?? 1; requireValue(Number.isSafeInteger(quantity)&&quantity>=1&&quantity<=10,'INVALID_QUANTITY','Quantity must be 1–10.');
        const cart=body.cart;
        const cartId=body.cartId || cart?.cartId;
        const currentCart=cartId ? state.storeCarts.find(c=>c.id===cartId && c.expiresAt>Date.now()) : null;
        if(cartId) requireValue(currentCart && currentCart.productId===product.id && currentCart.quantity===quantity && (!cart || currentCart.revision===cart.cartRevision) && (body.cartRevision===undefined || currentCart.revision===body.cartRevision),'CART_CHANGED','Cart changed. Refresh the merchant page.',409);
        if(cart) {
          requireValue(cart.productId===product.id && cart.quantity===quantity && cart.currency==='USD','CART_CHANGED','Cart identity changed. Refresh the cart.',409);
          requireValue(cart.merchandiseCents===product.priceCents*quantity && cart.shippingCents===product.shippingCents && cart.taxCents===product.taxCents && String(cart.version)===String(product.version ?? 1),'CART_CHANGED','Cart totals changed. Refresh the merchant page.',409);
        }
        for(const key of ['merchandiseCents','referenceCents','merchantId']) requireValue(body[key]===undefined,'UNTRUSTED_AMOUNT','Prices come from the controlled merchant.');
        for(const key of ['taxCents','shippingCents']) requireValue(body[key]===undefined || body[key]===null || body[key]===product[key],'UNTRUSTED_AMOUNT','Tax and shipping must match the controlled cart.');
        const quote=domain.createQuote(state,userId,{productId:product.id,quantity,...(body.currency?{currency:body.currency}:{}),...(body.taxCents!==undefined?{taxCents:body.taxCents}:{}),...(body.shippingCents!==undefined?{shippingCents:body.shippingCents}:{})});
        quote.validUntil=Date.now()+5*60e3; quote.expiresAt=new Date(quote.validUntil).toISOString(); quote.productSnapshot=JSON.stringify(product); quote.activationSnapshot=JSON.stringify(user.activatedOfferIds || []);
        if(currentCart) { quote.sourceCartId=currentCart.id; quote.sourceCartRevision=currentCart.revision; }
        return send(quote);
      }
      const quoteRead=path.match(/^\/commerce\/quotes\/([^/]+)$/);
      if(quoteRead && method==='GET') return send(owned(state.quotes,quoteRead[1],userId));
      if(path==='/checkout/sessions' && method==='POST') {
        const quote=owned(state.quotes,body.quoteId,userId); validateCurrentQuote(quote,userId);
        const card=owned(state.cards,body.cardId,userId); requireValue(user.sample && !card.selfReported,'PAYMENT_UNAVAILABLE','Self-reported cards are for comparison only. No payment provider is connected.',409);
        requireValue(quote.plans.some(p=>p.cardId===card.id && p.ready!==false),'PLAN_UNAVAILABLE','This card plan is not ready.',409);
        const existing=state.checkoutSessions.find(s=>s.quoteId===quote.id && s.cardId===card.id && s.userId===userId);
        if(existing) return send(checkoutView(existing,req));
        const checkout={id:randomUUID(),userId,quoteId:quote.id,cardId:card.id,status:'review',createdAt:new Date().toISOString()};
        state.checkoutSessions.push(checkout); return send(checkoutView(checkout,req),201);
      }
      const checkout=path.match(/^\/checkout\/sessions\/([^/]+)(\/confirm)?$/);
      if(checkout) {
        const record=owned(state.checkoutSessions,checkout[1],userId);
        if(method==='GET') return send(checkoutView(record,req));
        if(method==='POST' && checkout[2]) {
          requireValue(body.approved===true,'APPROVAL_REQUIRED','Explicitly approve the displayed no-money demo charge.');
          if(record.purchaseId) return send({purchase:owned(state.purchases,record.purchaseId,userId),session:record});
          requireValue(record.status!=='declined','PAYMENT_DECLINED','This simulated attempt was declined. Create a fresh quote.',409);
          const quote=owned(state.quotes,record.quoteId,userId); validateCurrentQuote(quote,userId); const card=owned(state.cards,record.cardId,userId);
          requireValue(user.sample && !card.selfReported,'PAYMENT_UNAVAILABLE','Payment provider unavailable.',409);
          const outcome=body.outcome || 'approved'; requireValue(['approved','success','declined','processing'].includes(outcome),'INVALID_OUTCOME','Choose a supported demo outcome.');
          record.providerAttempts=1;
          if(outcome==='declined') { record.status='declined'; return send({session:record,error:{code:'PAYMENT_DECLINED',message:'Demo payment declined. No charge or purchase was made.'}},402); }
          const purchase={id:randomUUID(),userId,quoteId:quote.id,cardId:record.cardId,productId:quote.cart.productId,productName:quote.cart.productName,merchantId:quote.cart.merchantId,merchantName:quote.cart.merchantName,checkoutCents:quote.cart.checkoutCents,status:outcome==='processing'?'processing':'authorized',createdAt:state.now || state.clock,plan:quote.plans.find(p=>p.cardId===record.cardId),synthetic:true};
          state.purchases.push(purchase); record.purchaseId=purchase.id; record.status=purchase.status; return send({purchase,session:record});
        }
      }
      if(path==='/rewards/summary' && method==='GET') return send(summary(userId));
      if(path==='/rewards/purchases' && method==='GET') return send(scoped('purchases',userId));
      const purchase=path.match(/^\/rewards\/purchases\/([^/]+)$/);
      if(purchase && method==='GET') return send({...owned(state.purchases,purchase[1],userId),events:scoped('events',userId).filter(e=>e.purchaseId===purchase[1]),ledger:scoped('ledger',userId).filter(e=>e.purchaseId===purchase[1])});
      const event=path.match(/^\/demo\/purchases\/([^/]+)\/events$/);
      if(event && method==='POST') { requireValue(user.sample,'DEMO_ONLY','Use a sample profile.',403); owned(state.purchases,event[1],userId); return send(domain.applyPurchaseEvent(state,userId,event[1],body.type,body.eventId || `${event[1]}:${body.type}`)); }
      if(['/assistant','/assistant/messages'].includes(path) && method==='POST') { requireValue(typeof body.message==='string' && body.message.length>0 && body.message.length<=2000,'INVALID_MESSAGE','Enter a question up to 2,000 characters.'); return send(await assistantAnswer(state,userId,body.message)); }
      if(path==='/demo/reset' && method==='POST') { requireValue(user.sample,'DEMO_ONLY','Use a sample profile.',403); store.resetSamples(); return send({ok:true}); }
      fail('NOT_FOUND','Endpoint not found.',404);
    } catch(error) {
      const status=error.status || error.statusCode || (error.code==='NOT_FOUND'?404:400);
      if(status>=500) console.error('PerkPilot request failed:',error.code || error.name);
      if(!res.writableEnded) { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify({error:{code:error.code || 'INVALID_REQUEST',message:error.message || 'Request failed.'}})); }
    }
  }
  return {server:createServer(handler),createStoreServer:()=>createServer(handler),store,auth,handler,setCheckoutRuntime:runtime=>{checkoutRuntime=runtime;}};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createApplication(); const port=Number(process.env.PORT || 3000),storePort=Number(process.env.STORE_PORT || 3001);
  const merchant=app.createStoreServer();
  const onError=error=>{console.error(`Cannot start PerkPilot: ${error.code}. Check permissions and whether ports ${port}/${storePort} are available.`);process.exitCode=1;app.server.close();merchant.close();};
  app.server.on('error',onError);merchant.on('error',onError);
  app.server.listen(port,'127.0.0.1',()=>console.log(`PerkPilot portal: http://localhost:${port} (${process.env.PERKPILOT_MODE || 'demo'})`));
  merchant.listen(storePort,'127.0.0.1',()=>console.log(`Controlled storefront: http://localhost:${storePort}/store?product=alo-jacket`));
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{app.store.save();app.server.close();merchant.close();});
}
