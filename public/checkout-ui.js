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
  function mount({root,api,onWalletChanged=()=>{},walletCards=[],cardProducts=[],identity=null,sample=false,selection=null}) {
    if(!root || typeof api!=='function')throw new Error('Checkout needs a root and portal API.');
    current?.dispose({clearRecovery:false});
    const selected=selection==null?null:{sku:selection.sku,variantId:selection.variantId};
    let alive=true,busy=false,loading=true,storeReady=false,setupNotice='',poll=null,capabilities=null,products=[],destinations=[],methods=[],preview=null,intent=null,error='',enrollment=null,authorizationUnknown=pendingApprovals.has(identity);
    const request=(path,method='GET',body)=>api(BASE+path,method,body);
    const productName=id=>cardProducts.find(c=>c.id===id)?.name || walletCards.find(c=>c.productId===id)?.name || String(id||'Wallet card').replaceAll('-',' ');
    const configured=()=>capabilities?.enabled===true && capabilities.ready===true && /^pk_test_/.test(capabilities.publishableKey||'');
    const selectedProduct=()=>selected && products.find(p=>p.sku===selected.sku && p.variantId===selected.variantId);
    const selectionAvailable=()=>!selected || Boolean(selected.sku && selected.variantId && selectedProduct() && selectedProduct().stock!==0 && selectedProduct().active!==false);
    const selectionUnavailable='The selected product is unavailable. Return to Explore and reopen the product to try again.';
    const canBuy=()=>!sample && configured() && storeReady && selectionAvailable() && products.length>0 && destinations.length>0;
    const canEnroll=()=>!sample && capabilities?.enabled===true && storeReady && /^pk_test_/.test(capabilities?.publishableKey||'');
    const active=()=>authorizationUnknown || intent && !terminal.has(intent.state);
    const remember=id=>{try{window.localStorage?.setItem(RECOVERY,id);}catch{}};
    const forget=()=>{try{window.localStorage?.removeItem(RECOVERY);}catch{}};
    const recalled=()=>{try{return window.localStorage?.getItem(RECOVERY);}catch{return null;}};
    const disabled=condition=>busy||condition?' disabled':'';
    const matchesSelection=view=>!selected || view?.cart?.sku===selected.sku && view?.cart?.variantId===selected.variantId;
    const previousPurchase=()=>intent && !matchesSelection(intent);
    const status=()=>error || intent?.error?.message || (intent?`${previousPurchase()?'Previous purchase · ':''}${names[intent.state]||'Checking payment status'}`:'');
    function acceptIntent(view,cart=null) {
      intent={...view,cart:view.cart || (preview && view.previewId===preview.id?preview.cart:null) || cart || (intent?.id===view.id?intent.cart:null)};
    }
    function render() {
      if(!alive)return;
      // Preserve Stripe's live iframe while confirming or reporting field errors.
      if(enrollment && root.querySelector('[data-checkout-payment]')){
        const message=root.querySelector('[data-checkout-status]');if(message)message.textContent=status();
        root.querySelectorAll?.('[data-checkout-action]').forEach(button=>{button.disabled=busy;});return;
      }
      const missing=arr(capabilities?.missing).join(', ');
      const readiness=sample?'Test checkout requires a registered account':loading?'Checking test checkout availability…':configured()?'Stripe test checkout · Limits enforced by PerkPilot':`Test checkout is not ready${missing?`: ${missing}`:'. Complete the setup below to enable purchases.'}`;
      const retry=`<button class="button secondary" type="button" data-checkout-action="retry"${disabled(loading)}>Check setup again</button>`;
      const addCard=`<button class="button secondary" type="button" data-action="add-card"${disabled(active())}>Add a wallet card</button>`;
      const setupDetails=`<details class="checkout-setup-details"><summary data-checkout-action="setup-details">How to enable test checkout</summary><div><p>In the project’s local <code>.env</code>, set <code>PERKPILOT_CHECKOUT_ENABLED=1</code> and configure <code>CHECKOUT_ORIGIN</code>, <code>DATABASE_URL</code>, <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_PUBLISHABLE_KEY</code>, <code>STRIPE_EXPECTED_ACCOUNT_ID</code>, <code>STRIPE_WEBHOOK_SECRET</code>, and <code>GEMINI_API_KEY</code>. Use Stripe test keys.</p><p>Stop the current development server, then run:</p><pre><code>npm run migrate:checkout\nnpm run seed:checkout\nnpm run preflight:checkout\nnpm run dev:checkout</code></pre><p>Full setup and webhook instructions are in <code>CHECKOUT.md</code> in the repository. After restarting, reload this page or check setup again.</p></div></details>`;
      const publicCard=c=>`${escape(productName(c.productId))} · ${escape(c.brand||'test card')} •••• ${escape(c.last4||'—')}`;
      const methodList=methods.length?methods.map(c=>`<div class="list-row"><span class="grow"><strong>${publicCard(c)}</strong><p>Test card · reward product selected by you</p></span><button class="text-button" data-checkout-action="remove-method" data-id="${escape(c.id||c.cardId)}"${disabled(active())}>Remove</button></div>`).join(''):`<p class="fine-note">${walletCards.length?'Enroll a wallet card below to save a test payment method.':'Start by adding a wallet card product. Then enroll its test payment method.'}</p>`;
      const choices=walletCards.filter(c=>!methods.some(m=>m.cardId===c.id));
      const rankedCards=arr(preview?.cards||preview?.eligibleCards),bestCard=rankedCards[0],alternatives=rankedCards.slice(1);
      const rewardRate=card=>Number.isSafeInteger(card.rateBps) && card.rateBps>=0?`${card.rateBps/100}% base reward`:'Base reward rate unavailable';
      const tiedCards=bestCard && Number.isSafeInteger(bestCard.estimatedRewardCents)?alternatives.filter(card=>card.estimatedRewardCents===bestCard.estimatedRewardCents).length:0;
      const cardRecommendation=bestCard?`<aside class="checkout-best-card" data-checkout-best-card aria-label="Best enrolled card for this test purchase"><span class="eyebrow">Best enrolled card for this test purchase</span><h4>${publicCard(bestCard)}</h4><p class="checkout-best-card-reward">${rewardRate(bestCard)} · Estimated reward <strong>${money(bestCard.estimatedRewardCents)}</strong></p><p class="fine-note">Highest estimated base reward among the enrolled methods in your purchase permission.</p>${tiedCards?`<p class="fine-note">Tied with ${tiedCards} other enrolled ${tiedCards===1?'card':'cards'} at the same estimated reward.</p>`:''}<p class="fine-note">Rewards are estimates, not an immediate discount. PerkPilot checks the final cart before payment.</p></aside>${alternatives.length?`<p class="fine-note checkout-alternatives-label">Other enrolled test cards</p><ul class="checkout-card-set">${alternatives.map(card=>`<li>${publicCard(card)} <span>${rewardRate(card)} · Estimated reward ${money(card.estimatedRewardCents)}</span></li>`).join('')}</ul>`:''}`:'<p class="fine-note">No enrolled card recommendation is available. Check your saved test methods and review your purchase again.</p>';
      const summary=preview?`<section class="checkout-permission" aria-label="Purchase permission"><h3>${escape(preview.cart.name||'Test purchase')}</h3><p>${escape(preview.cart.merchantName||'PerkPilot Test Store')} · ${escape(preview.cart.variantId)} · Quantity ${preview.cart.quantity}</p><p>${escape(preview.cart.destinationLabel||'Saved test destination')} · ${escape(preview.cart.shippingOptionId||'standard')} shipping</p><dl class="checkout-amounts"><div><dt>Items</dt><dd>${money(preview.cart.merchandiseCents)}</dd></div><div><dt>Test tax</dt><dd>${money(preview.cart.taxCents)}</dd></div><div><dt>Shipping</dt><dd>${money(preview.cart.shippingCents)}</dd></div><div class="checkout-total"><dt>Current total</dt><dd>${money(preview.cart.totalCents)}</dd></div></dl>${cardRecommendation}<p class="fine-note">One purchase. Permission expires in 5 minutes. Item, merchant, destination, shipping service, currency and this card set are fixed.</p>${!intent && !authorizationUnknown?`<form data-checkout-form="buy"><label class="field"><span>Maximum authorized total (USD)</span><input name="maximum" type="text" inputmode="decimal" value="${(preview.cart.totalCents/100).toFixed(2)}" required pattern="[0-9]+([.][0-9]{1,2})?" aria-describedby="checkout-cap-help"${disabled(!canBuy())}></label><p id="checkout-cap-help" class="fine-note">The default is the current total. Enter a larger allowance only if you want to authorize it.</p><button class="button checkout-buy" data-checkout-action="buy"${disabled(!canBuy())}>Buy with PerkPilot — up to ${money(preview.cart.totalCents)}</button></form>`:''}</section>`:'';
      const receipt=intent?.state==='confirmed' && intent.order?.confirmedAt!=null && matchesSelection(intent)?`<section class="checkout-receipt" data-checkout-receipt><span class="pill">Provider-confirmed test payment</span><h3>Order confirmed</h3>${intent.cart?.name?`<p><strong>${escape(intent.cart.name)}</strong> · ${escape(intent.cart.variantId)} · Quantity ${escape(intent.cart.quantity)}</p>`:''}<p>${escape(intent.order.merchantName)} · ${money(intent.order.totalCents)}</p><dl class="checkout-amounts"><div><dt>Order</dt><dd>${escape(intent.order.orderId)}</dd></div><div><dt>Payment</dt><dd>${escape(intent.order.paymentId)}</dd></div><div><dt>Selected card</dt><dd>${publicCard(intent.order.card||{})}</dd></div><div><dt>Estimated reward</dt><dd>${money(intent.order.estimatedRewardCents)}</dd></div><div><dt>Permission maximum</dt><dd>${money(intent.maxAmountCents)}</dd></div></dl><p class="fine-note">${escape(intent.order.selectionReason)} Rewards are estimates, not posted benefits or an immediate discount.</p>${arr(intent.order.checks).length?`<p class="fine-note">${escape(intent.order.checks.join(', '))}</p>`:''}</section>`:'';
      const progress=intent?`<section class="checkout-progress" aria-label="Order progress"><h3>${previousPurchase()?'Previous purchase · ':''}${escape(names[intent.state]||'Checking payment status')}</h3>${previousPurchase()?`<p>${intent.cart?.name?`<strong>${escape(intent.cart.name)}</strong> · ${escape(intent.cart.variantId)}`:'This is an earlier purchase whose product details are unavailable.'} ${!terminal.has(intent.state)?'Finish or cancel this purchase before starting the selected product.':'You can now review the selected product.'}</p>`:''}<p class="fine-note">Purchase permission maximum ${money(intent.maxAmountCents)}.</p>${arr(intent.events).length?`<ol>${arr(intent.events).map(e=>`<li>${escape(e.tool?({'read_cart':'Checking final cart','rank_cards':'Comparing eligible cards','execute_purchase':'Verifying your limits','get_order_status':'Checking order status'}[e.tool]||e.tool):names[e.state]||e.code||'Checking order status')}</li>`).join('')}</ol>`:''}${['queued','running'].includes(intent.state)?`<button class="button secondary" data-checkout-action="cancel"${disabled(false)}>Cancel before payment</button>`:''}${intent.state==='requires_action'?`<p>Complete your bank’s authentication for this existing test payment.</p><button class="button" data-checkout-action="authenticate"${disabled(false)}>Continue authentication</button>`:''}${['payment_pending','requires_action'].includes(intent.state)?`<p class="fine-note">The payment is still being reconciled. This view cannot establish success until the provider confirms it.</p><button class="text-button" data-checkout-action="reconcile"${disabled(false)}>Check payment status</button>`:''}</section>`:authorizationUnknown?'<section class="checkout-progress"><h3>Checking your existing approval</h3><p>The approval response was interrupted. We’re checking your saved purchase before another purchase can start.</p><button class="button secondary" data-checkout-action="reconcile">Check payment status</button></section>':'';
      const enrollmentForm=enrollment?'<div class="checkout-enrollment"><p>Enter a Stripe test card. Stripe receives the card number and CVC.</p><div data-checkout-payment></div><div class="checkout-buttons"><button class="button" data-checkout-action="confirm-enrollment">Save test method</button><button class="button secondary" data-checkout-action="close-enrollment">Cancel enrollment</button></div></div>':choices.length?`
        <form data-checkout-form="enroll">
          <label class="field"><span>Wallet reward product</span><select name="walletCardId"${disabled(!canEnroll()||active())}>${choices.map(c=>`<option value="${escape(c.id)}">${escape(c.name||productName(c.productId))}</option>`).join('')}</select></label>
          <label class="checkout-consent"><input name="consent" type="checkbox" required${disabled(!canEnroll()||active())}><span>I agree to save this test payment method for future user-present purchases.</span></label>
          <button class="button secondary" data-checkout-action="enroll"${disabled(!canEnroll()||active())}>Enroll a test card</button>
        </form>`:'';
      const purchaseForm=!selectionAvailable()?`<p role="alert">${selectionUnavailable}</p>${retry}`:products.length && destinations.length?`
        <form data-checkout-form="preview">
          ${selected?`<div class="checkout-selected-product" data-checkout-selected-product><span class="eyebrow">Selected item</span><strong>${escape(selectedProduct().name)}</strong><span>${escape(selectedProduct().variantId)} · ${money(selectedProduct().merchandiseCents)} per item</span><p class="fine-note">Your review includes test tax and shipping.</p></div>`:`<label class="field"><span>Item</span><select name="sku"${disabled(active())}>${products.map(p=>`<option value="${escape(p.sku)}">${escape(p.name)} · ${escape(p.variantId)}</option>`).join('')}</select></label>`}
          <div class="checkout-form-row"><label class="field"><span>Quantity</span><input name="quantity" type="number" min="1" max="10" value="1" required${disabled(active())}></label><label class="field"><span>Saved test destination</span><select name="destinationId"${disabled(active())}>${destinations.map(d=>`<option value="${escape(d.id)}">${escape(d.label)}</option>`).join('')}</select></label></div>
          ${!methods.length?'<p class="fine-note">Enroll a test card to review and authorize your purchase.</p>':''}
          <button class="button secondary" data-checkout-action="preview"${disabled(!canBuy()||!methods.length||active())}>Review purchase permission</button>
        </form>`:`<p>No test products or destinations are available yet. Run <code>npm run seed:checkout</code> in the project, then check setup again.</p>${retry}`;
      let content;
      if(sample)content='<p>Create a registered PerkPilot account to enroll a test card and authorize a purchase.</p>';
      else if(loading)content='<p>Loading your test store…</p>';
      else if(!configured())content=`<section class="checkout-setup" data-checkout-setup aria-label="Test checkout setup"><h3>Test checkout needs setup</h3><p>The payment service is not connected yet. You can add wallet card products now; enrollment and purchases become available after setup.</p>${setupDetails}<div class="checkout-buttons">${addCard}${retry}</div></section>${progress}${receipt}`;
      else if(!storeReady)content=`<section class="checkout-setup"><h3>Could not load your test store</h3><p>Check the error above and try again to load your products and saved payment methods.</p>${retry}</section>${progress}${receipt}`;
      else content=`<div class="checkout-columns"><div><h3>Saved test payment methods</h3>${methodList}${enrollmentForm}${!enrollment?`<div class="checkout-buttons">${addCard}</div>`:''}</div><div><h3>Review your test purchase</h3>${purchaseForm}${summary}${progress}${receipt}</div></div>`;
      root.innerHTML=`<section class="checkout-panel surface section${selected?' checkout-panel-selected':''}" aria-labelledby="checkout-title">
        <div class="section-heading"><div><span class="eyebrow">PerkPilot Test Store</span><h2 id="checkout-title">Buy with PerkPilot</h2><p>A bounded purchase, with your best enrolled test card.</p></div><span class="pill neutral">Test mode</span></div>
        <p class="checkout-readiness fine-note">${escape(readiness)}</p>
        <div class="checkout-message" data-checkout-status role="status" aria-live="polite" tabindex="-1">${escape(status()||setupNotice)}</div>
        ${content}
        <p class="checkout-footnote fine-note">This places a controlled test-store order. No external merchant order or real-money purchase is made.</p>
      </section>`;
    }
    function schedule() {
      clearTimeout(poll);if(!alive || !active())return;
      if(authorizationUnknown && !intent){poll=setTimeout(async()=>{try{await discoverIntent({onlyUnknown:true});}catch{/* Keep the original approval unresolved. */}if(alive){render();schedule();}},5000);return;}
      poll=setTimeout(async()=>{try{await refreshStatus();}catch(err){if(alive){error=err.message;render();schedule();}}},['payment_pending','requires_action'].includes(intent.state)?5000:1000);
    }
    async function discoverIntent({preferredId=null,onlyUnknown=false}={}) {
      const listed=await request('/intents');if(!alive)return null;const owned=arr(listed.intents||listed);
      const pending=pendingApprovals.get(identity);
      const candidate=pending?owned.find(view=>view.previewId===pending.previewId):onlyUnknown?null:owned.find(view=>!terminal.has(view.state)) || owned.find(matchesSelection);
      const id=candidate?.id || (!pending && !onlyUnknown?preferredId:null);
      if(!id)return null;
      const view=await request(`/intents/${encodeURIComponent(id)}`);if(!alive)return null;
      if(pending && view.previewId!==pending.previewId)return null;
      if(!pending && terminal.has(view.state) && !matchesSelection(view))return null;
      acceptIntent(view,pending?.cart);authorizationUnknown=false;if(pendingApprovals.get(identity)===pending)pendingApprovals.delete(identity);remember(view.id);return view;
    }
    async function refreshStatus() {
      if(!intent?.id)return;
      const id=intent.id;const view=await request(`/intents/${encodeURIComponent(id)}`);
      if(!alive)return;acceptIntent(view);render();schedule();return view;
    }
    async function action(fn) {
      if(!alive || busy)return null;
      busy=true;error='';clearTimeout(poll);render();
      try{return await fn();}catch(err){if(alive){error=err.message;render();root.querySelector('[data-checkout-status]')?.focus();}throw err;}
      finally{if(alive){busy=false;render();schedule();}}
    }
    async function loadSetup() {
      if(sample){loading=false;render();return;}
      loading=true;storeReady=false;setupNotice='';capabilities=null;render();
      try{
        const value=await request('/capabilities');if(!alive)return;capabilities=value;
        // Ordinary development mode has no checkout routes beyond capabilities.
        // Do not request products or methods until that runtime is enabled.
        if(capabilities.enabled!==true)return;
        const loaded=await Promise.allSettled([request('/products'),request('/methods')]);if(!alive)return;
        products=[];destinations=[];methods=[];
        const failures=[];
        if(loaded[0].status==='fulfilled'){products=arr(loaded[0].value.products);destinations=arr(loaded[0].value.destinations);}
        else failures.push(`Could not load test products: ${loaded[0].reason?.message||'Please try again.'}`);
        if(loaded[1].status==='fulfilled')methods=arr(loaded[1].value.methods||loaded[1].value);
        else failures.push(`Could not load saved test methods: ${loaded[1].reason?.message||'Please try again.'}`);
        storeReady=failures.length===0;error=failures.join(' ');
        const id=recalled();
        try{await discoverIntent({preferredId:id && /^[A-Za-z0-9_:-]{1,200}$/.test(id)?id:null});}
        catch(err){if([401,403,404].includes(err.status))forget();else{storeReady=false;error=[error,`Could not check existing purchases: ${err.message}`].filter(Boolean).join(' ');}}
      }catch(err){if(alive){error=err.code==='NOT_FOUND'?'Test checkout is not enabled. Complete the setup below to start.':err.message;capabilities={ready:false,enabled:false};}}
      finally{if(alive){loading=false;render();schedule();}}
    }
    function clearEnrollment() {enrollment?.element?.destroy();enrollment=null;}
    const controller={
      identity,
      async refreshSetup(){return action(async()=>{await loadSetup();if(alive && !error)setupNotice=configured()?'Test store is up to date.':'Checked again. Test checkout still needs setup.';});},
      async preparePreview(input){return action(async()=>{
        if(!selectionAvailable())throw new Error(selectionUnavailable);
        if(!canBuy())throw new Error('Test checkout is not ready.');
        if(active())throw new Error('Finish or cancel your current purchase first.');
        if(selected && (input.sku!=null && input.sku!==selected.sku || input.variantId!=null && input.variantId!==selected.variantId))throw new Error('Review the selected product and variant. Return to Explore to choose a different product.');
        const value=await request('/previews','POST',{sku:selected?.sku||input.sku,variantId:selected?.variantId||input.variantId,quantity:input.quantity,destinationId:input.destinationId});
        if(selected && !matchesSelection(value))throw new Error('The selected product changed. Return to Explore and reopen the product.');
        if(!alive)return;preview=value;intent=null;forget();render();return value;
      });},
      async buy(maxAmountCents){return action(async()=>{
        if(!preview || !canBuy() || active())throw new Error('Review an available test purchase first.');
        if(Date.now()>=preview.expiresAt)throw new Error('This preview expired. Review a fresh purchase permission.');
        if(!Number.isSafeInteger(maxAmountCents)||maxAmountCents<preview.cart.totalCents||maxAmountCents>50000)throw new Error('The maximum must cover the current total and be at most $500.00.');
        const pending={previewId:preview.id,maxAmountCents,cart:preview.cart};pendingApprovals.set(identity,pending);authorizationUnknown=true;
        let view;
        try{view=await request('/intents','POST',{previewId:preview.id,maxAmountCents,approved:true});}
        catch(err){if(!alive)return;if(err.status && err.status<500){if(pendingApprovals.get(identity)===pending)pendingApprovals.delete(identity);authorizationUnknown=false;throw err;}try{view=await discoverIntent({onlyUnknown:true});}catch{/* Poll only for the exact original saved approval. */}if(!view){error='The approval response was interrupted. Checking the existing purchase before another can start.';return null;}}
        if(!alive){if(current?.identity===identity && pendingApprovals.get(identity)===pending)await current.reconcile().catch(()=>{});return;}
        if(view.previewId!==pending.previewId){error='The approval response could not be matched. Checking the existing purchase.';return null;}
        if(pendingApprovals.get(identity)===pending)pendingApprovals.delete(identity);authorizationUnknown=false;acceptIntent(view,pending.cart);remember(view.id);render();root.querySelector('[data-checkout-status]')?.focus();return view;
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
        const view=await request(`/intents/${encodeURIComponent(id)}/reconcile`,'POST',{});if(alive)acceptIntent(view);
      });},
      async cancel(){return action(async()=>{if(!intent)return;const view=await request(`/intents/${encodeURIComponent(intent.id)}/cancel`,'POST',{});if(alive)acceptIntent(view);});},
      async reconcile(){return action(async()=>{if(authorizationUnknown || !intent){await discoverIntent({onlyUnknown:authorizationUnknown});return;}const view=await request(`/intents/${encodeURIComponent(intent.id)}/reconcile`,'POST',{});if(alive)acceptIntent(view);});},
      async removeMethod(id){return action(async()=>{await request(`/methods/${encodeURIComponent(id)}`,'DELETE',{});if(!alive)return;methods=arr(await request('/methods'));preview=null;await onWalletChanged();});},
      openProduct(sku){if(selected && selected.sku!==sku)return;const product=products.find(p=>p.sku===sku);if(!product)return;const select=root.querySelector('[name="sku"]');if(select)select.value=sku;root.querySelector('[data-checkout-form="preview"]')?.scrollIntoView({behavior:'smooth',block:'center'});},
      dispose({clearRecovery=true}={}){if(!alive)return;alive=false;clearTimeout(poll);clearEnrollment();root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('input',input);root.innerHTML='';preview=null;intent=null;capabilities=null;methods=[];if(clearRecovery){forget();pendingApprovals.delete(identity);}if(current===controller)current=null;}
    };
    function formValues(form){return Object.fromEntries(new FormData(form));}
    function submit(event){const form=event.target.closest?.('[data-checkout-form]');if(!form)return;event.preventDefault();event.stopPropagation();const fields=formValues(form);let promise;
      if(form.dataset.checkoutForm==='preview'){const product=selected?selectedProduct():products.find(p=>p.sku===fields.sku);promise=controller.preparePreview({sku:product?.sku,variantId:product?.variantId,quantity:Number(fields.quantity),destinationId:fields.destinationId});}
      else if(form.dataset.checkoutForm==='buy'){try{promise=controller.buy(cents(fields.maximum));}catch(err){error=err.message;render();}}
      else if(form.dataset.checkoutForm==='enroll')promise=controller.startEnrollment(fields.walletCardId,fields.consent==='on');
      promise?.catch(()=>{});
    }
    function click(event){const button=event.target.closest?.('[data-checkout-action]');if(!button)return;const name=button.dataset.checkoutAction;
      if(['buy','preview','enroll','setup-details'].includes(name))return;
      event.preventDefault();event.stopPropagation();let result;
      if(name==='close-enrollment'){clearEnrollment();render();}
      else if(name==='confirm-enrollment')result=controller.confirmEnrollment();else if(name==='authenticate')result=controller.authenticatePayment();
      else if(name==='cancel')result=controller.cancel();else if(name==='reconcile')result=controller.reconcile();else if(name==='remove-method')result=controller.removeMethod(button.dataset.id);else if(name==='retry')result=controller.refreshSetup();
      result?.catch(()=>{});
    }
    function input(event){if(event.target.name!=='maximum')return;const button=root.querySelector('[data-checkout-action="buy"]');if(!button)return;try{const max=cents(event.target.value);button.textContent=`Buy with PerkPilot — up to ${money(max)}`;button.disabled=busy||max<preview.cart.totalCents||max>50000;}catch{button.disabled=true;}}
    root.addEventListener('click',click);root.addEventListener('submit',submit);root.addEventListener('input',input);render();current=controller;
    controller.ready=loadSetup();
    return controller;
  }
  window.CheckoutUI={mount,openProduct:sku=>current?.openProduct(sku),dispose:options=>current?.dispose(options)};
})();
