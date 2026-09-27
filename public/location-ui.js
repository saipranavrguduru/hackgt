'use strict';

window.LocationUI = (() => {
  const categories = [['dining','Dining'],['groceries','Groceries'],['gas','Gas'],['drugstores','Drugstores'],['other','Other / unsure']];
  const state = { generation:0, active:false, userId:null, fields:{category:'other',placeName:'',amount:''}, pending:null, places:[], selectedPlaceId:null, source:null, accuracyMeters:null, status:'', error:false, result:null, purchase:null };
  const app = () => window.App;
  const esc = value => app().escapeHtml(value);
  const icon = name => app().icon(name);
  const money = value => app().money(value);
  const list = value => Array.isArray(value) ? value : [];
  const categoryLabel = category => categories.find(([value])=>value===category)?.[1] || 'Other / unsure';
  const safeUrl = value => { try { const parsed = new URL(value); return parsed.protocol === 'https:' ? parsed.href : ''; } catch { return ''; } };
  const rate = value => Number.isFinite(value) ? `${new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value/100)}%` : 'Unknown';

  function reset() {
    state.generation++;
    state.active=false; state.userId=null; state.pending=null; state.places=[]; state.selectedPlaceId=null;
    state.source=null; state.accuracyMeters=null; state.status=''; state.error=false; state.result=null; state.purchase=null;
    state.fields={category:'other',placeName:'',amount:''};
  }

  function current(operation) {
    const sheet=document.querySelector('#sheet');
    return state.active && state.generation===operation.generation && state.userId===operation.userId && app().state.data?.user?.id===operation.userId && sheet?.open && sheet.dataset.owner==='location' && Boolean(document.querySelector('#location-form'));
  }

  function readFields() {
    const form=document.querySelector('#location-form');
    if(!form)return;
    state.fields={category:form.elements.category.value,placeName:form.elements.placeName.value,amount:form.elements.amount.value};
  }

  function begin(pending) {
    state.generation++; state.pending=pending; state.error=false; state.result=null; state.purchase=null;
    return {generation:state.generation,userId:state.userId};
  }

  function open() {
    reset(); state.active=true; state.userId=app().state.data?.user?.id;
    if(!state.userId)return;
    render();
  }

  function entry(compact=false) {
    if(compact)return `<button class="button secondary" data-action="location-open">${icon('pin')} I’m at…</button>`;
    return `<section class="location-entry" aria-label="Choose a card for where you are"><div class="row"><span class="location-entry-icon">${icon('pin')}</span><div><h2>A good card for right here.</h2><p>Tell us where you are. We’ll compare the cards in your wallet.</p></div></div><button class="button secondary" data-action="location-open">I’m at… ${icon('arrow')}</button></section>`;
  }

  function sourceLink(card) {
    const url=safeUrl(card.sourceUrl);
    return `<p class="location-source">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Issuer reward rules ${icon('external')}</a>`:'Issuer source unavailable'}${card.checkedAt?` · checked ${esc(card.checkedAt)}`:''}</p>`;
  }

  function cardResult(card, primary=false) {
    const ownership=card.ownership==='synthetic'?'Synthetic sample holding':'Self-reported · unverified';
    const hasAmount=Number.isSafeInteger(state.result?.amountCents);
    const categoryBasis=card.basis==='category';
    return `<article class="location-card-result ${primary?'primary':''}">${primary?'<span class="eyebrow">Best estimated return in your wallet</span>':''}<div class="row between"><div><h3>${esc(card.cardName)}</h3><p class="fine-note">${esc(ownership)}${card.last4?` · •••• ${esc(card.last4)}`:''}</p></div><strong class="location-rate">${rate(card.rewardBps)}</strong></div><p class="location-basis">${categoryBasis?`If coded as ${esc(state.result.categoryLabel || categoryLabel(state.result.category))}`:'Published base purchase rate'}${categoryBasis?` · base ${rate(card.baseRewardBps)}`:''}</p>${hasAmount?`<div class="location-reward"><span>Estimated cash reward</span><strong>${money(card.rewardCents)}</strong>${categoryBasis?`<small>Base-rate fallback: ${money(card.baseRewardCents)}</small>`:''}</div>`:''}${sourceLink(card)}<details class="location-terms"><summary>Terms & limitations</summary><p>${esc(card.limitations || 'Rewards depend on issuer eligibility, merchant coding, and applicable terms.')}</p></details></article>`;
  }

  function canTrack(result=state.result) {
    return Number.isSafeInteger(result?.amountCents) && result.amountCents>0 && result.amountCents<=100000000 && list(result.cards).some(card=>card.cardId===result.bestCardId);
  }

  function purchaseMarker(best) {
    if(!best)return '';
    if(!canTrack())return '<p class="fine-note">Enter a purchase amount and show your best card to track estimated cashback in Saved.</p>';
    const purchase=state.purchase,removed=purchase?.saved?.status==='removed';
    const message=removed?'This purchase was previously removed from Saved.':purchase?.saved?`Added ${money(purchase.saved.rewardCents)} estimated cashback to Saved.`:purchase?.error||'';
    return `<div class="location-card-result" data-location-purchase><p class="fine-note">Self-reported purchase · Estimated cashback, not issuer-confirmed rewards.</p><p class="location-explanation">Already paid with ${esc(best.cardName)}? Mark this purchase to track its estimated cashback.</p><button class="button full" type="button" data-action="location-track-purchase"${purchase?.pending||purchase?.saved?' disabled':''}>${removed?'Previously removed':purchase?.saved?'Added to Saved':purchase?.pending?'Adding to Saved…':'I bought this'}</button>${message?`<p class="fine-note${purchase?.error?' error-message':''}" data-location-purchase-status role="status" aria-live="polite">${esc(message)}</p>`:''}</div>`;
  }

  function results() {
    const result=state.result;
    if(!result)return '';
    const cards=list(result.cards);const best=cards.find(card=>card.cardId===result.bestCardId);
    const label=result.placeName || result.categoryLabel || categoryLabel(result.category);
    if(!cards.length)return `<section class="location-results" id="location-results">${app().empty('Your wallet needs a card first.','Add a card product you own to compare its rewards here. Self-reported cards stay unverified.',app().button('Add an owned card','location-add-card'),'wallet')}</section>`;
    return `<section class="location-results" id="location-results" aria-label="Recommended cards"><div class="section-heading"><div><h3>${esc(label)}</h3><p>${Number.isSafeInteger(result.amountCents)?`For a ${money(result.amountCents)} purchase`:'Comparing reward rates · no purchase amount entered'}</p></div><span class="pill neutral">Your wallet only</span></div>${best?cardResult(best,true):''}${purchaseMarker(best)}<p class="location-explanation">${esc(result.explanation)}</p>${cards.filter(c=>c.cardId!==best?.cardId).map(c=>cardResult(c)).join('')}<div class="info-note amber">${icon('info')}<span>${esc(result.disclaimer || 'A place category does not verify its merchant code. Rewards are estimates, not guaranteed issuer postings.')}</span></div></section>`;
  }

  function nearbyPlaces() {
    if(!state.places.length)return '';
    const attribution=safeUrl(state.source?.url)||'https://www.openstreetmap.org/copyright';
    return `<section class="location-nearby" aria-label="Nearby places"><h3>Which place are you at?</h3><p class="fine-note">Choose a place, check the category, then select Show best card. Place types are inferred; they are not verified merchant codes.</p>${Number.isFinite(state.accuracyMeters)?`<p class="fine-note">Reported location accuracy: about ${Math.round(state.accuracyMeters)} m. Results are within 500 m of the reported position.</p>`:''}<div class="location-place-list">${state.places.map((place,index)=>`<button class="location-place ${place.id===state.selectedPlaceId?'selected':''}" data-action="location-select-place" data-index="${index}" aria-pressed="${place.id===state.selectedPlaceId}"><span class="location-entry-icon">${icon('pin')}</span><span class="grow"><strong>${esc(place.name)}</strong><small>${esc(place.categoryLabel || categoryLabel(place.category))}${Number.isFinite(place.distanceMeters)?` · about ${Math.round(place.distanceMeters)} m away`:''}</small></span>${icon(place.id===state.selectedPlaceId?'check':'chevron')}</button>`).join('')}</div><p class="location-source">Places from <a href="${esc(attribution)}" target="_blank" rel="noopener noreferrer">${esc(state.source?.name || 'OpenStreetMap')}</a>. Confirm the place and category yourself.</p></section>`;
  }

  function render() {
    if(!state.active || app().state.data?.user?.id!==state.userId)return;
    app().showSheet('I’m at…',`<p>Choose the kind of place you’re at. We’ll compare only cards already in your wallet.</p>${results()}<form id="location-form" class="location-form"><label class="field"><span>Place category</span><select name="category" id="location-category" required>${categories.map(([value,label])=>`<option value="${value}" ${state.fields.category===value?'selected':''}>${label}</option>`).join('')}</select></label><div class="grid-two"><label class="field"><span>Place name <span class="muted">(optional)</span></span><input name="placeName" id="location-place-name" maxlength="120" autocomplete="off" placeholder="A restaurant or store" value="${esc(state.fields.placeName)}"></label><label class="field"><span>Purchase amount in USD <span class="muted">(optional)</span></span><input name="amount" id="location-amount" type="number" inputmode="decimal" min="0.01" max="1000000" step="0.01" placeholder="45.00" value="${esc(state.fields.amount)}"></label></div><p class="fine-note location-coding-note">A name or nearby place type does not verify merchant coding. Category rewards apply only if the issuer recognizes that category.</p><button class="button full" type="submit" ${state.pending==='recommendation'?'disabled':''}>${state.pending==='recommendation'?'Comparing your cards…':'Show best card'} ${icon('card')}</button></form><div id="location-status" class="location-status ${state.error?'error-message':''}" role="status" aria-live="polite">${esc(state.status)}</div><section class="location-lookup" aria-label="Optional nearby lookup"><div class="row between"><h3>Or find a nearby place</h3><span class="pill neutral">Optional</span></div><p id="location-privacy" class="fine-note">Selecting Locate me asks for your current location. Your coordinates are sent once through this server to OpenStreetMap for this lookup. Coordinates aren’t saved. Recording a purchase saves the place name you confirm.</p><button class="button secondary" type="button" data-action="location-locate" aria-describedby="location-privacy" ${state.pending==='lookup'?'disabled':''}>${icon('pin')} ${state.pending==='lookup'?'Finding nearby places…':'Locate me'}</button></section>${nearbyPlaces()}`,{owner:'location'});
  }

  function fail(operation,message) {
    if(!current(operation))return;
    state.pending=null;state.status=message;state.error=true;render();
  }

  function locate() {
    readFields();const operation=begin('lookup');state.places=[];state.selectedPlaceId=null;state.source=null;state.accuracyMeters=null;
    state.status='Waiting for your location permission. You can still choose a category manually.';render();
    if(!navigator.geolocation){fail(operation,'Location is unavailable in this browser. Choose a category manually to compare your cards.');return;}
    try { navigator.geolocation.getCurrentPosition(async position=>{
      if(!current(operation))return;
      state.status='Looking for nearby places. Please confirm your place when the results arrive.';render();
      try {
        // Coordinates exist only in this one request payload, never in module state or storage.
        const response=await app().api('/location/nearby','POST',{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyMeters:position.coords.accuracy,consent:true});
        if(!current(operation))return;
        state.places=list(response.places).map(place=>({id:place.id,name:String(place.name || 'Unnamed place'),category:categories.some(([value])=>value===place.category)?place.category:'other',categoryLabel:place.categoryLabel,distanceMeters:place.distanceMeters}));
        state.source={name:response.source?.name,url:response.source?.url};state.accuracyMeters=response.accuracyMeters;state.pending=null;
        state.status=state.places.length?`${state.places.length} nearby place${state.places.length===1?'':'s'} found. Select one below, confirm its category, then choose Show best card.`:'No nearby places were found. Select the category and optional place name manually.';render();
      } catch(error) {fail(operation,`${error.message || 'Nearby lookup is unavailable.'} You can still choose a category manually.`);}
    },error=>{
      const message=error.code===1?'Location permission was not granted.':error.code===3?'The location request timed out.':'Your location could not be determined.';
      fail(operation,`${message} Choose a category manually to compare your cards.`);
    },{enableHighAccuracy:true,timeout:10000,maximumAge:0});
    } catch { fail(operation,'Location could not be requested. Choose a category manually to compare your cards.'); }
  }

  async function submit(form,fields) {
    if(form.id!=='location-form' || !state.active)return;
    state.fields={category:fields.category,placeName:fields.placeName || '',amount:fields.amount || ''};
    const operation=begin('recommendation');state.status='Comparing published reward rules for your owned cards.';render();
    try {
      if(!categories.some(([value])=>value===fields.category))throw new Error('Choose a place category.');
      const placeName=String(fields.placeName || '').trim();if(placeName.length>120)throw new Error('Keep the place name within 120 characters.');
      const payload={category:fields.category,...(placeName?{placeName}:{})};const entered=String(fields.amount || '').trim();
      if(entered){if(!/^(?:\d+|\d*\.\d{1,2})$/.test(entered))throw new Error('Enter a USD amount with up to two decimal places.');const [whole,fraction='']=entered.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents<1||cents>100000000)throw new Error('Enter an amount from $0.01 to $1,000,000.00.');payload.amountCents=cents;}
      const response=await app().api('/location/recommendations','POST',payload);
      if(!current(operation))return;
      state.result=response;state.purchase=canTrack(response)?{requestId:crypto.randomUUID(),pending:false,saved:null,error:''}:null;state.pending=null;state.status=list(response.cards).length?'Your card comparison is ready. Merchant coding and issuer terms still apply.':'Add a card you own to get a recommendation.';render();
      document.querySelector('#sheet').scrollTop=0;
    } catch(error){fail(operation,error.message || 'The recommendation could not be loaded. Please try again.');}
  }

  function change(event) {
    if(!state.active || !event.target.closest('#location-form'))return;
    readFields();state.generation++;state.pending=null;state.result=null;state.purchase=null;state.error=false;
    state.status='Details changed. Choose Show best card to compare this purchase.';
    document.querySelector('#location-results')?.remove();
    const status=document.querySelector('#location-status');if(status){status.textContent=state.status;status.classList.remove('error-message');}
    const submitButton=document.querySelector('#location-form [type="submit"]');if(submitButton){submitButton.disabled=false;submitButton.innerHTML=`Show best card ${icon('card')}`;}
    const locateButton=document.querySelector('[data-action="location-locate"]');if(locateButton){locateButton.disabled=false;locateButton.innerHTML=`${icon('pin')} Locate me`;}
  }

  async function trackPurchase() {
    const operation={generation:state.generation,userId:state.userId},purchase=state.purchase,result=state.result;
    if(!current(operation)||!canTrack(result)||!purchase||purchase.pending||purchase.saved)return;
    purchase.pending=true;purchase.error='';state.error=false;render();
    let response;
    try {
      response=await app().api('/rewards/card-purchases','POST',{requestId:purchase.requestId,cardId:result.bestCardId,category:result.category,placeName:result.placeName||'',amountCents:result.amountCents});
      if(!response?.purchase?.id||!Number.isSafeInteger(response.purchase.rewardCents)||response.purchase.rewardCents<0)throw new Error('The saved purchase could not be verified. Try again.');
    } catch(error) {
      if(!current(operation)||state.purchase!==purchase)return;
      purchase.pending=false;purchase.error=error.message||'The purchase could not be added. Try again.';render();return;
    }
    if(!current(operation)||state.purchase!==purchase)return;
    purchase.pending=false;purchase.saved=response.purchase;render();
    try {await app().refresh();}
    catch {
      if(!current(operation)||state.purchase!==purchase)return;
      state.status=purchase.saved.status==='removed'?'This purchase was previously removed. Refresh Saved to update the displayed total.':'Your purchase was saved. Refresh Saved to update the displayed total.';state.error=false;render();
    }
  }

  async function action(name,target) {
    if(name==='location-open'){open();return;}
    if(!state.active)return;
    if(name==='location-track-purchase'){await trackPurchase();return;}
    if(name==='location-locate'){locate();return;}
    if(name==='location-select-place'){
      readFields();const place=state.places[Number(target.dataset.index)];if(!place)return;
      state.generation++;state.pending=null;state.result=null;state.purchase=null;state.error=false;state.selectedPlaceId=place.id;
      state.fields.category=place.category;state.fields.placeName=place.name.slice(0,120);
      state.status=`Selected ${place.name}. Confirm the place category, then choose Show best card.`;render();document.querySelector('#location-category')?.focus();return;
    }
    if(name==='location-add-card'){reset();app().closeSheet();app().state.page='wallet';location.hash='wallet';app().renderShell();document.querySelector('[data-action="add-card"]')?.click();}
  }

  return {entry,open,reset,action,submit,change};
})();
