import {randomUUID} from 'node:crypto';
import {requireValue} from './errors.js';

export const catalogReferenceValid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const principalValid=principal=>typeof principal?.subjectKey==='string' && /^portal:[0-9a-f-]{36}$/i.test(principal.subjectKey) && typeof principal.sessionDigest==='string' && principal.sessionDigest.length>0;
const text=(value,length)=>typeof value==='string' && value.trim().length>0 && value.length<=length;
export function catalogSourceUrl(value) {
 try {const url=new URL(value);return ['https:','http:'].includes(url.protocol) && !url.username && !url.password && url.href.length<=2000 ? url.href : null;}catch{return null;}
}
export function catalogCheckoutUnavailableReason(listing) {
 if(!listing || !text(listing.name,240) || !catalogSourceUrl(listing.url))return 'This listing does not have enough verified product information for sandbox checkout.';
 if(listing.currency!=='USD')return 'Sandbox checkout currently supports USD listings only.';
 if(!Number.isSafeInteger(listing.priceCents) || listing.priceCents<=0)return 'Sandbox checkout requires a positive observed merchandise price.';
 if(['unavailable','out_of_stock','sold_out'].includes(listing.availability))return 'This listing is unavailable for sandbox checkout.';
 const total=listing.priceCents+Math.round(listing.priceCents/10)+500;
 if(!Number.isSafeInteger(total) || total>50000)return 'Sandbox checkout supports totals up to $500, including 10% test tax and $5 test shipping.';
 return null;
}

// References select a trusted observed listing. They never authorize a payment.
// This intentionally lives in memory: after restart or expiry, search again.
export function createCheckoutCatalog({now=Date.now,ttlMs=15*60*1000,maxEntries=1000,maxPerOwner=40}={}) {
 const entries=new Map();
 function expire(){for(const [id,value] of entries)if(value.expiresAt<=now())entries.delete(id);}
 function issue(principal,products) {
  expire();
  return products.slice(0,20).map(product=>{
   const {checkoutReference:ignoredReference,checkoutUnavailableReason:ignoredReason,...listing}=product;
   const unavailable=catalogCheckoutUnavailableReason(listing);
   if(unavailable || !principalValid(principal))return {...listing,checkoutUnavailableReason:unavailable || 'Sign in through the PerkPilot portal to use sandbox checkout.'};
   const checkoutReference=randomUUID();
   const snapshot={id:typeof listing.id==='string'?listing.id.slice(0,300):'',name:listing.name,merchantName:typeof listing.merchantName==='string'?listing.merchantName.slice(0,120):'Observed retailer',priceCents:listing.priceCents,currency:listing.currency,availability:listing.availability,url:catalogSourceUrl(listing.url),observedAt:typeof listing.observedAt==='string'?listing.observedAt.slice(0,64):null,source:typeof listing.source==='string'?listing.source.slice(0,120):'Observed catalog'};
   entries.set(checkoutReference,{subjectKey:principal.subjectKey,sessionDigest:principal.sessionDigest,expiresAt:now()+ttlMs,snapshot});
   const owned=[...entries].filter(([,entry])=>entry.subjectKey===principal.subjectKey);
   for(const [id] of owned.slice(0,Math.max(0,owned.length-maxPerOwner)))entries.delete(id);
   while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
   return {...listing,checkoutReference};
  });
 }
 function resolve(principal,reference) {
  expire();const entry=entries.get(reference);
  requireValue(principalValid(principal) && entry && entry.subjectKey===principal.subjectKey && entry.sessionDigest===principal.sessionDigest,'CATALOG_REFERENCE_EXPIRED','This product selection expired. Search Explore again to prepare a new sandbox checkout.',409);
  return structuredClone(entry.snapshot);
 }
 return {issue,resolve};
}
