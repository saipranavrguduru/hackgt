import {randomUUID} from 'node:crypto';
import {recommendLocationCards,savingsSummary} from './domain.js';
import {getCardProduct} from './card-catalog.js';
import {requireValue} from './errors.js';

const cents=value=>Number.isSafeInteger(value)&&value>=0;
const owner=(state,userId)=>{const user=state.users.find(row=>row.id===userId);requireValue(user,'NOT_FOUND','Profile not found.',404);return user;};
const timestamp=(state,user,now)=>user.sample?(state.clock || new Date(now).toISOString()):new Date(now).toISOString();

// Recording a purchase is an explicit user report, never proof of a payment or posted reward.
export function recordCardPurchase(state,userId,input,{now=Date.now()}={}) {
 const user=owner(state,userId);
 requireValue(input && typeof input==='object' && !Array.isArray(input),'INVALID_PURCHASE','Enter purchase details.');
 const fields=['requestId','cardId','category','placeName','amountCents'];
 requireValue(Object.keys(input).every(key=>fields.includes(key)),'INVALID_PURCHASE','Only purchase details may be submitted.');
 requireValue(typeof input.requestId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId),'INVALID_PURCHASE','A valid purchase request ID is required.');
 requireValue(typeof input.cardId==='string' && input.cardId.length>0 && input.cardId.length<=200,'INVALID_PURCHASE','Choose a card from your wallet.');
 requireValue(Number.isSafeInteger(input.amountCents)&&input.amountCents>0&&input.amountCents<=100000000,'INVALID_AMOUNT','Enter a purchase amount between $0.01 and $1,000,000.');
 requireValue(input.placeName===undefined || typeof input.placeName==='string'&&input.placeName.length<=120,'INVALID_PLACE_NAME','Enter a place name up to 120 characters.');
 const details={cardId:input.cardId,category:input.category,placeName:(input.placeName || '').replace(/[\u0000-\u001f\u007f]/g,'').trim(),amountCents:input.amountCents};
 const fingerprint=JSON.stringify(details);
 state.cardRewardPurchases ||= [];
 const prior=state.cardRewardPurchases.find(row=>row.userId===userId&&row.requestId===input.requestId);
 if(prior){requireValue(prior.fingerprint===fingerprint,'PURCHASE_REQUEST_REUSED','This purchase request already has different details.',409);return{purchase:purchaseView(prior),duplicate:true};}
 const comparison=recommendLocationCards(state,userId,details),card=comparison.cards.find(row=>row.cardId===details.cardId);
 requireValue(card,'CARD_NOT_OWNED','Choose a supported card you own.',403);
 const purchase={id:randomUUID(),userId,requestId:input.requestId,fingerprint,...details,cardName:card.cardName,rewardCents:card.rewardCents,rewardBps:card.rewardBps,baseRewardCents:card.baseRewardCents,basis:card.basis,sourceUrl:card.sourceUrl,kind:'self_reported',status:'recorded',occurredAt:timestamp(state,user,now),currency:'USD'};
 state.cardRewardPurchases.push(purchase);
 return{purchase:purchaseView(purchase),duplicate:false};
}

function purchaseView({userId,requestId,fingerprint,...purchase}){return purchase;}
export function removeCardPurchase(state,userId,id) {
 const purchase=(state.cardRewardPurchases || []).find(row=>row.id===id&&row.userId===userId);
 requireValue(purchase,'NOT_FOUND','Tracked purchase not found.',404);
 // Retain the idempotency key so a delayed retry cannot restore a removed estimate.
 purchase.status='removed';return{ok:true};
}

export function trackedSavings(state,userId,{checkoutPurchases=[],checkoutRewardsUnavailable=false,now=Date.now()}={}) {
 const user=owner(state,userId),clock=timestamp(state,user,now);
 const summary=savingsSummary({...state,clock},userId);
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:user.timezone || 'America/New_York',year:'numeric'});
 const inYear=value=>{const date=new Date(value);return Number.isFinite(date.getTime())&&Number(formatter.format(date))===summary.year;};
 const rewardPurchases=[],seen=new Set();
 const add=purchase=>{const key=purchase.kind+':'+purchase.id;if(!seen.has(key)&&inYear(purchase.occurredAt)&&cents(purchase.rewardCents)&&cents(purchase.amountCents)){seen.add(key);rewardPurchases.push(purchase);}};
 for(const order of checkoutPurchases){
  if(order.currency!=='USD' || !Number.isSafeInteger(order.confirmedAt))continue;
  add({id:order.id,kind:'sandbox',intentId:order.intentId,name:order.name || 'Test purchase',merchantName:order.merchantName || 'PerkPilot Test Store',sourceMerchantName:order.sourceMerchantName,cardName:getCardProduct(order.card?.productId)?.name || 'Saved test card',amountCents:order.amountCents,rewardCents:order.estimatedRewardCents,occurredAt:new Date(order.confirmedAt).toISOString(),status:'estimated'});
 }
 for(const purchase of state.cardRewardPurchases || []){
  if(purchase.userId!==userId || purchase.status!=='recorded' || purchase.currency!=='USD')continue;
  add({...purchaseView(purchase),name:purchase.placeName || 'Reported card purchase',merchantName:purchase.placeName || 'Reported merchant',status:'estimated'});
 }
 for(const purchase of state.purchases || []){
  if(purchase.userId!==userId || !['authorized','settled'].includes(purchase.status) || purchase.benefitStatus?.reward==='posted' || state.ledger.some(entry=>entry.userId===userId&&entry.purchaseId===purchase.id&&entry.kind==='cash_reward'&&entry.amountCents>0))continue;
  const plan=purchase.plan || state.quotes.find(quote=>quote.id===purchase.quoteId&&quote.userId===userId)?.plans.find(plan=>plan.cardId===purchase.cardId);
  if(!plan)continue;
  add({id:purchase.id,kind:'sample',name:purchase.productName || 'Sample purchase',merchantName:purchase.merchantName || 'Sample merchant',cardName:plan.cardName || 'Sample card',amountCents:purchase.checkoutCents ?? plan.checkoutCents,rewardCents:plan.rewardCents,occurredAt:purchase.createdAt,status:'estimated'});
 }
 rewardPurchases.sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)||a.id.localeCompare(b.id));
 const sum=kind=>rewardPurchases.filter(row=>row.kind===kind).reduce((total,row)=>total+row.rewardCents,0);
 const checkoutCashbackCents=sum('sandbox'),reportedCashbackCents=sum('self_reported'),sampleCashbackCents=sum('sample');
 const estimatedCashbackCents=checkoutCashbackCents+reportedCashbackCents+sampleCashbackCents;
 return{...summary,confirmedCents:summary.totalCents,trackedTotalCents:summary.totalCents+estimatedCashbackCents,estimatedCashbackCents,checkoutCashbackCents,reportedCashbackCents,sampleCashbackCents,rewardPurchases,checkoutRewardsUnavailable};
}
