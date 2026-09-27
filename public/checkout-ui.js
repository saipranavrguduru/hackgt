(() => {
  'use strict';
  const BASE='/agent-checkout',RECOVERY='perkpilot-checkout-intent';
  const terminal=new Set(['confirmed','payment_failed','blocked','cancelled','expired','agent_failed']);
  const names={queued:'Checking final cart',running:'Comparing eligible cards',payment_pending:'Processing test payment',requires_action:'Bank authentication required',confirmed:'Order confirmed',payment_failed:'Test payment failed',blocked:'Purchase blocked',cancelled:'Purchase cancelled',expired:'Permission expired',agent_failed:'Agent preparation failed'};
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const arr=value=>Array.isArray(value)?value:[];
  const money=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100):'Unknown';
  const cents=value=>{if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(String(value)))throw new Error('Enter a maximum from $0.01 to $500.00, with at most two decimal places.');const [whole,fraction='']=String(value).split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));};
  let current=null,stripeLoading=null;
  // Transient approval correlation survives same-user navigation only. Nothing
  // here is persisted to storage, and logout/profile changes clear this entry.
  const pendingApprovals=new Map();
  async function loadStripe(key) {
    if(!/^pk_test_/.test(key||''))throw new Error('Stripe test enrollment is not configured.');
    if(!window.Stripe){
      if(!stripeLoading)stripeLoading=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='https://js.stripe.com/dahlia/stripe.js';script.async=true;
        script.onload=resolve;script.onerror=()=>{stripeLoading=null;reject(new Error('Stripe could not load. Try enrollment again.'));};document.head.appendChild(script);
      });
      await stripeLoading;
    }
    return window.Stripe(key);
  }
  function mount({root,api,onWalletChanged=()=>{},walletCards=[],cardProducts=[],identity=null,sample=false}) {
    if(!root || typeof api!=='function')throw new Error('Checkout needs a root and portal API.');
    current?.dispose({clearRecovery:false});
    let alive=true,busy=false,poll=null,capabilities=null,products=[],destinations=[],methods=[],preview=null,intent=null,error='',enrollment=null,authorizationUnknown=pendingApprovals.has(identity);
    const request=(path,method='GET',body)=>api(BASE+path,method,body);
    const productName=id=>cardProducts.find(c=>c.id===id)?.name || walletCards.find(c=>c.productId===id)?.name || String(id||'Wallet card').replaceAll('-',' ');
    const canBuy=()=>capabilities?.ready===true;
    const canEnroll=()=>capabilities?.enabled!==false && /^pk_test_/.test(capabilities?.publishableKey||'');
    const active=()=>authorizationUnknown || intent && !terminal.has(intent.state);
    const remember=id=>{try{window.localStorage?.setItem(RECOVERY,id);}catch{}};
    const forget=()=>{try{window.localStorage?.removeItem(RECOVERY);}catch{}};
    const recalled=()=>{try{return window.localStorage?.getItem(RECOVERY);}catch{return null;}};
    const disabled=condition=>busy||condition?' disabled':'';
    const status=()=>error || intent?.error?.message || (intent?names[intent.state]||'Checking payment status':'');
    function render() {
      if(!alive)return;
      // Preserve Stripe's live iframe while confirming or reporting field errors.
      if(enrollment && root.querySelector('[data-checkout-payment]')){
        const message=root.querySelector('[data-checkout-status]');if(message)message.textContent=status();
        root.querySelectorAll?.('[data-checkout-action]').forEach(button=>{button.disabled=busy;});return;
      }
      const missing=arr(capabilities?.missing).join(', ');
      const readiness=capabilities===null?'Checking test checkout availability…':canBuy()?'Stripe test checkout · Limits enforced by PerkPilot':`Test checkout is not ready${missing?`: ${missing}`:'. Add the provider configuration to enable purchases.'}`;
      const publicCard=c=>`${escape(productName(c.productId))} · ${escape(c.brand||'test card')} •••• ${escape(c.last4||'—')}`;
      const methodList=methods.length?methods.map(c=>`<div class="list-row"><span class="grow"><strong>${publicCard(c)}</strong><p>Test card · reward product selected by you</p></span><button class="text-button" data-checkout-action="remove-method" data-id="${escape(c.id||c.cardId)}"${disabled(active())}>Remove</button></div>`).join(''):'<p class="fine-note">No saved test payment methods. Add a wallet card product, then enroll it below.</p>';
      const choices=walletCards.filter(c=>!methods.some(m=>m.cardId===c.id));
      const summary=preview?`<section class="checkout-permission" aria-label="Purchase permission"><h3>${escape(preview.cart.name||'Test purchase')}</h3><p>${escape(preview.cart.merchantName||'PerkPilot Test Store')} · ${escape(preview.cart.variantId)} · Quantity ${preview.cart.quantity}</p><p>${escape(preview.cart.destinationLabel||'Saved test destination')} · ${escape(preview.cart.shippingOptionId||'standard')} shipping</p><dl class="checkout-amounts"><div><dt>Items</dt><dd>${money(preview.cart.merchandiseCents)}</dd></div><div><dt>Test tax</dt><dd>${money(preview.cart.taxCents)}</dd></div><div><dt>Shipping</dt><dd>${money(preview.cart.shippingCents)}</dd></div><div class="checkout-total"><dt>Current total</dt><dd>${money(preview.cart.totalCents)}</dd></div></dl><p class="fine-note">Choose the best estimated base reward from these enrolled test cards:</p><ul class="checkout-card-set">${arr(preview.cards||preview.eligibleCards).map(c=>`<li>${publicCard(c)} <span>Estimated reward ${money(c.estimatedRewardCents)}</span></li>`).join('')}</ul><p class="fine-note">One purchase. Permission expires in 5 minutes. Item, merchant, destination, shipping service, currency and this card set are fixed.</p>${!intent && !authorizationUnknown?`<form data-checkout-form="buy"><label class="field"><span>Maximum authorized total (USD)</span><input name="maximum" type="text" inputmode="decimal" value="${(preview.cart.totalCents/100).toFixed(2)}" required pattern="[0-9]+([.][0-9]{1,2})?" aria-describedby="checkout-cap-help"${disabled(!canBuy())}></label><p id="checkout-cap-help" class="fine-note">The default is the current total. Enter a larger allowance only if you want to authorize it.</p><button class="button checkout-buy" data-checkout-action="buy"${disabled(!canBuy())}>Buy with PerkPilot — up to ${money(preview.cart.totalCents)}</button></form>`:''}</section>`:'';
      const receipt=intent?.state==='confirmed' && intent.order?.confirmedAt!=null?`<section class="checkout-receipt" data-checkout-receipt><span class="pill">Provider-confirmed test payment</span><h3>Order confirmed</h3><p>${escape(intent.order.merchantName)} · ${money(intent.order.totalCents)}</p><dl class="checkout-amounts"><div><dt>Order</dt><dd>${escape(intent.order.orderId)}</dd></div><div><dt>Payment</dt><dd>${escape(intent.order.paymentId)}</dd></div><div><dt>Selected card</dt><dd>${publicCard(intent.order.card||{})}</dd></div><div><dt>Estimated reward</dt><dd>${money(intent.order.estimatedRewardCents)}</dd></div><div><dt>Permission maximum</dt><dd>${money(intent.maxAmountCents)}</dd></div></dl><p class="fine-note">${escape(intent.order.selectionReason)} Rewards are estimates, not posted benefits or an immediate discount.</p>${arr(intent.order.checks).length?`<p class="fine-note">${escape(intent.order.checks.join(', '))}</p>`:''}</section>`:'';
      const progress=intent?`<section class="checkout-progress" aria-label="Order progress"><h3>${escape(names[intent.state]||'Checking payment status')}</h3><p class="fine-note">Purchase permission maximum ${money(intent.maxAmountCents)}.</p>${arr(intent.events).length?`<ol>${arr(intent.events).map(e=>`<li>${escape(e.tool?({'read_cart':'Checking final cart','rank_cards':'Comparing eligible cards','execute_purchase':'Verifying your limits','get_order_status':'Checking order status'}[e.tool]||e.tool):names[e.state]||e.code||'Checking order status')}</li>`).join('')}</ol>`:''}${['queued','running'].includes(intent.state)?`<button class="button secondary" data-checkout-action="cancel"${disabled(false)}>Cancel before payment</button>`:''}${intent.state==='requires_action'?`<p>Complete your bank’s authentication for this existing test payment.</p><button class="button" data-checkout-action="authenticate"${disabled(false)}>Continue authentication</button>`:''}${['payment_pending','requires_action'].includes(intent.state)?`<p class="fine-note">The payment is still being reconciled. This view cannot establish success until the provider confirms it.</p><button class="text-button" data-checkout-action="reconcile"${disabled(false)}>Check payment status</button>`:''}</section>`:authorizationUnknown?'<section class="checkout-progress"><h3>Checking your existing approval</h3><p>The approval response was interrupted. We’re checking your saved purchase before another purchase can start.</p><button class="button secondary" data-checkout-action="reconcile">Check payment status</button></section>':'';
      root.innerHTML=`<section class="checkout-panel surface section" aria-labelledby="checkout-title"><div class="section-heading"><div><span class="eyebrow">PerkPilot Test Store</span><h2 id="checkout-title">Buy with PerkPilot</h2><p>A bounded purchase, with your best enrolled test card.</p></div><span class="pill neutral">Test mode</span></div><p class="checkout-readiness fine-note">${escape(readiness)}</p><div class="checkout-message" data-checkout-status role="status" aria-live="polite" tabindex="-1">${escape(status())}</div>${sample?'<p>Create a registered PerkPilot account to enroll a test card and authorize a purchase.</p>':`<div class="checkout-columns"><div><h3>Saved test payment methods</h3>${methodList}${enrollment?'<div class="checkout-enrollment"><p>Enter a Stripe test card. Stripe receives the card number and CVC.</p><div data-checkout-payment></div><div class="checkout-buttons"><button class="button" data-checkout-action="confirm-enrollment">Save test method</button><button class="button secondary" data-checkout-action="close-enrollment">Cancel enrollment</button></div></div>':`<form data-checkout-form="enroll"><label class="field"><span>Wallet reward product</span><select name="walletCardId"${disabled(!canEnroll()||!choices.length||active())}>${choices.map(c=>`<option value="${escape(c.id)}">${escape(c.name||productName(c.productId))}</option>`).join('')}</select></label><label class="checkout-consent"><input name="consent" type="checkbox" required${disabled(!canEnroll()||active())}><span>I agree to save this test payment method for future user-present purchases.</span></label><button class="button secondary" data-checkout-action="enroll"${disabled(!canEnroll()||!choices.length||active())}>Enroll a test card</button></form>`}</div><div><h3>Review your test purchase</h3><form data-checkout-form="preview"><label class="field"><span>Item</span><select name="sku"${disabled(active()||!products.length)}>${products.map(p=>`<option value="${escape(p.sku)}">${escape(p.name)} · ${escape(p.variantId)}</option>`).join('')}</select></label><div class="checkout-form-row"><label class="field"><span>Quantity</span><input name="quantity" type="number" min="1" max="10" value="1" required${disabled(active())}></label><label class="field"><span>Saved test destination</span><select name="destinationId"${disabled(active())}>${destinations.map(d=>`<option value="${escape(d.id)}">${escape(d.label)}</option>`).join('')}</select></label></div><button class="button secondary" data-checkout-action="preview"${disabled(!canBuy()||!methods.length||active())}>Review purchase permission</button></form>${summary}${progress}${receipt}</div></div><p class="checkout-footnote fine-note">This places a controlled test-store order. No external merchant order or real-money purchase is made.</p>`}</section>`;
    }
    function schedule() {
      clearTimeout(poll);if(!alive || !active())return;
      if(authorizationUnknown && !intent){poll=setTimeout(async()=>{try{await discoverIntent({onlyUnknown:true});}catch{/* Keep the original approval unresolved. */}if(alive){render();schedule();}},5000);return;}
      poll=setTimeout(async()=>{try{await refreshStatus();}catch(err){if(alive){error=err.message;render();schedule();}}},['payment_pending','requires_action'].includes(intent.state)?5000:1000);
    }
    async function discoverIntent({preferredId=null,onlyUnknown=false}={}) {
      const listed=await request('/intents');if(!alive)return null;const owned=arr(listed.intents||listed);
      const pending=pendingApprovals.get(identity);
      const candidate=pending?owned.find(view=>view.previewId===pending.previewId):onlyUnknown?null:owned.find(view=>!terminal.has(view.state)) || owned[0];
      const id=candidate?.id || (!pending && !onlyUnknown?preferredId:null);
      if(!id)return null;
      const view=await request(`/intents/${encodeURIComponent(id)}`);if(!alive)return null;
      if(pending && view.previewId!==pending.previewId)return null;
      intent=view;authorizationUnknown=false;if(pendingApprovals.get(identity)===pending)pendingApprovals.delete(identity);remember(view.id);return view;
    }
    async function refreshStatus() {
      if(!intent?.id)return;
      const id=intent.id;const view=await request(`/intents/${encodeURIComponent(id)}`);
      if(!alive)return;intent=view;render();schedule();return view;
    }
    async function action(fn) {
      if(!alive || busy)return null;
      busy=true;error='';clearTimeout(poll);render();
      try{return await fn();}catch(err){if(alive){error=err.message;render();root.querySelector('[data-checkout-status]')?.focus();}throw err;}
      finally{if(alive){busy=false;render();schedule();}}
    }
    function clearEnrollment() {enrollment?.element?.destroy();enrollment=null;}
    const controller={
      identity,
      async preparePreview(input){return action(async()=>{
        if(!canBuy())throw new Error('Test checkout is not ready.');
        if(active())throw new Error('Finish or cancel your current purchase first.');
        const value=await request('/previews','POST',{sku:input.sku,variantId:input.variantId,quantity:input.quantity,destinationId:input.destinationId});
        if(!alive)return;preview=value;intent=null;forget();render();return value;
      });},
      async buy(maxAmountCents){return action(async()=>{
        if(!preview || !canBuy() || active())throw new Error('Review an available test purchase first.');
        if(Date.now()>=preview.expiresAt)throw new Error('This preview expired. Review a fresh purchase permission.');
        if(!Number.isSafeInteger(maxAmountCents)||maxAmountCents<preview.cart.totalCents||maxAmountCents>50000)throw new Error('The maximum must cover the current total and be at most $500.00.');
        const pending={previewId:preview.id,maxAmountCents};pendingApprovals.set(identity,pending);authorizationUnknown=true;
        let view;
        try{view=await request('/intents','POST',{previewId:preview.id,maxAmountCents,approved:true});}
        catch(err){if(!alive)return;if(err.status && err.status<500){if(pendingApprovals.get(identity)===pending)pendingApprovals.delete(identity);authorizationUnknown=false;throw err;}try{view=await discoverIntent({onlyUnknown:true});}catch{/* Poll only for the exact original saved approval. */}if(!view){error='The approval response was interrupted. Checking the existing purchase before another can start.';return null;}}
        if(!alive){if(current?.identity===identity && pendingApprovals.get(identity)===pending)await current.reconcile().catch(()=>{});return;}
        if(view.previewId!==pending.previewId){error='The approval response could not be matched. Checking the existing purchase.';return null;}
        if(pendingApprovals.get(identity)===pending)pendingApprovals.delete(identity);authorizationUnknown=false;intent=view;remember(view.id);render();root.querySelector('[data-checkout-status]')?.focus();return view;
      });},
      async startEnrollment(walletCardId,consent){return action(async()=>{
        if(consent!==true)throw new Error('Explicit consent is required to save a test payment method.');
        if(!canEnroll())throw new Error('Stripe test enrollment is not configured.');
        const stripe=await loadStripe(capabilities.publishableKey);if(!alive)return;
        const setup=await request('/enrollments','POST',{walletCardId,saveConsent:true});if(!alive)return;
        const elements=stripe.elements({clientSecret:setup.clientSecret,appearance:{theme:'stripe'}});
        const element=elements.create('payment',{wallets:{applePay:'never',googlePay:'never'}});
        enrollment={id:setup.id||setup.setupId,stripe,elements,element};render();element.mount(root.querySelector('[data-checkout-payment]')||'[data-checkout-payment]');
      });},
      async confirmEnrollment(){return action(async()=>{
        if(!enrollment)throw new Error('Start enrollment first.');const saved=enrollment;
        const result=await saved.stripe.confirmSetup({elements:saved.elements,confirmParams:{return_url:window.location.href.split('?')[0]},redirect:'if_required'});
        if(!alive)return;if(result.error)throw new Error(result.error.message||'Stripe could not save this test card.');
        await request(`/enrollments/${encodeURIComponent(saved.id)}/complete`,'POST',{});if(!alive)return;
        clearEnrollment();methods=arr(await request('/methods'));preview=null;await onWalletChanged();
      });},
      async authenticatePayment(){return action(async()=>{
        if(!intent?.id)throw new Error('No payment requires authentication.');const id=intent.id;
        const stripe=await loadStripe(capabilities.publishableKey);if(!alive)return;
        const payment=await request(`/intents/${encodeURIComponent(id)}/payment-action`);if(!alive)return;
        const result=await stripe.handleNextAction({clientSecret:payment.clientSecret});if(!alive)return;
        if(result.error)throw new Error(result.error.message||'Authentication did not finish.');
        const view=await request(`/intents/${encodeURIComponent(id)}/reconcile`,'POST',{});if(alive)intent=view;
      });},
      async cancel(){return action(async()=>{if(!intent)return;const view=await request(`/intents/${encodeURIComponent(intent.id)}/cancel`,'POST',{});if(alive)intent=view;});},
      async reconcile(){return action(async()=>{if(authorizationUnknown || !intent){await discoverIntent({onlyUnknown:authorizationUnknown});return;}const view=await request(`/intents/${encodeURIComponent(intent.id)}/reconcile`,'POST',{});if(alive)intent=view;});},
      async removeMethod(id){return action(async()=>{await request(`/methods/${encodeURIComponent(id)}`,'DELETE',{});if(!alive)return;methods=arr(await request('/methods'));preview=null;await onWalletChanged();});},
      openProduct(sku){const product=products.find(p=>p.sku===sku);if(!product)return;const select=root.querySelector('[name="sku"]');if(select)select.value=sku;root.querySelector('[data-checkout-form="preview"]')?.scrollIntoView({behavior:'smooth',block:'center'});},
      dispose({clearRecovery=true}={}){if(!alive)return;alive=false;clearTimeout(poll);clearEnrollment();root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('input',input);root.innerHTML='';preview=null;intent=null;capabilities=null;methods=[];if(clearRecovery){forget();pendingApprovals.delete(identity);}if(current===controller)current=null;}
    };
    function formValues(form){return Object.fromEntries(new FormData(form));}
    function submit(event){const form=event.target.closest?.('[data-checkout-form]');if(!form)return;event.preventDefault();event.stopPropagation();const fields=formValues(form);let promise;
      if(form.dataset.checkoutForm==='preview'){const product=products.find(p=>p.sku===fields.sku);promise=controller.preparePreview({sku:fields.sku,variantId:product?.variantId,quantity:Number(fields.quantity),destinationId:fields.destinationId});}
      else if(form.dataset.checkoutForm==='buy'){try{promise=controller.buy(cents(fields.maximum));}catch(err){error=err.message;render();}}
      else if(form.dataset.checkoutForm==='enroll')promise=controller.startEnrollment(fields.walletCardId,fields.consent==='on');
      promise?.catch(()=>{});
    }
    function click(event){const button=event.target.closest?.('[data-checkout-action]');if(!button)return;const name=button.dataset.checkoutAction;
      if(['buy','preview','enroll'].includes(name))return;
      event.preventDefault();event.stopPropagation();let result;
      if(name==='close-enrollment'){clearEnrollment();render();}
      else if(name==='confirm-enrollment')result=controller.confirmEnrollment();else if(name==='authenticate')result=controller.authenticatePayment();
      else if(name==='cancel')result=controller.cancel();else if(name==='reconcile')result=controller.reconcile();else if(name==='remove-method')result=controller.removeMethod(button.dataset.id);
      result?.catch(()=>{});
    }
    function input(event){if(event.target.name!=='maximum')return;const button=root.querySelector('[data-checkout-action="buy"]');if(!button)return;try{const max=cents(event.target.value);button.textContent=`Buy with PerkPilot — up to ${money(max)}`;button.disabled=busy||max<preview.cart.totalCents||max>50000;}catch{button.disabled=true;}}
    root.addEventListener('click',click);root.addEventListener('submit',submit);root.addEventListener('input',input);render();current=controller;
    controller.ready=(async()=>{
      if(sample)return;
      try{
        const value=await request('/capabilities');if(!alive)return;capabilities=value;
        const loaded=await Promise.allSettled([request('/products'),request('/methods')]);if(!alive)return;
        if(loaded[0].status==='fulfilled'){products=arr(loaded[0].value.products);destinations=arr(loaded[0].value.destinations);}
        if(loaded[1].status==='fulfilled')methods=arr(loaded[1].value.methods||loaded[1].value);
        const id=recalled();if(capabilities.enabled!==false){try{await discoverIntent({preferredId:id && /^[A-Za-z0-9_:-]{1,200}$/.test(id)?id:null});}catch(err){if([401,403,404].includes(err.status))forget();else throw err;}}
      }catch(err){if(alive){error=err.code==='NOT_FOUND'?'Test checkout is not enabled. Add the provider configuration to start.':err.message;capabilities={ready:false,enabled:false};}}
      finally{if(alive){render();schedule();}}
    })();
    return controller;
  }
  window.CheckoutUI={mount,openProduct:sku=>current?.openProduct(sku),dispose:options=>current?.dispose(options)};
})();
