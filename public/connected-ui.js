'use strict';

(() => {
  const state = { initialized:false, loading:null, identity:null, generation:0, session:null, dashboard:null, products:null, answer:null, lastSearchQuery:null, query:'', error:null, searchError:null, answerError:null };
  let plaidLoader;
  let productSequence=0, openedProductId=null, productController=null;
  const app = () => window.App;
  const esc = value => app().escapeHtml(value ?? '');
  const money = value => app().money(value);
  const icon = name => app().icon(name);
  const accountMoney = account => Number.isSafeInteger(account.balanceCents) && /^[A-Z]{3}$/.test(account.currency || '') ? new Intl.NumberFormat('en-US',{style:'currency',currency:account.currency}).format(account.balanceCents/100) : 'Unknown';

  function reset() {
    closeProduct();
    Object.assign(state,{initialized:false,loading:null,identity:app()?.state.data?.user?.id || null,generation:state.generation+1,session:null,dashboard:null,products:null,answer:null,lastSearchQuery:null,query:'',error:null,searchError:null,answerError:null});
  }
  function ensureIdentity() {
    if(state.identity !== (app()?.state.data?.user?.id || null)) reset();
  }
  const isSample = () => !!app()?.state.data?.user?.sample;

  async function api(path, method = 'GET', body) {
    const response = await fetch(`/api${path}`, { method, credentials:'same-origin', headers:body === undefined ? {} : {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body) });
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(result.error?.message || `Request failed (${response.status})`); error.code=result.error?.code; error.status=response.status; throw error; }
    return result;
  }

  function update() {
    ensureIdentity();
    if (!['connected','explore'].includes(app()?.state.page)) return;
    const target = document.querySelector('#main-content');
    if (target) target.innerHTML = app().state.page==='explore' ? renderExplore() : render();
  }

  async function load(shouldUpdate = true) {
    ensureIdentity();
    if(isSample()) return;
    if (state.loading) return state.loading;
    const generation=state.generation;
    const pending=(async()=>{
      try {
        const session=await api('/auth/session');
        const dashboard=session.user ? await api('/dashboard') : null;
        ensureIdentity();
        if(generation!==state.generation)return;
        Object.assign(state,{session,dashboard,initialized:true,error:null});
        if (session.user && new URLSearchParams(location.search).has('oauth_state_id')) {
          let stored;try{stored=JSON.parse(sessionStorage.getItem('perkpilot_link_token'));}catch{}
          if (stored?.identity===state.identity && stored?.token) await openPlaid(stored.token, location.href);
          else {sessionStorage.removeItem('perkpilot_link_token');app().toast('Bank connection session expired. Start again.');}
        }
      } catch(error) {
        ensureIdentity();
        if(generation!==state.generation)return;
        Object.assign(state,{initialized:true,session:null,dashboard:null,error:error.message});
      } finally {
        if(generation===state.generation){state.loading=null;if(shouldUpdate)update();}
      }
    })();
    state.loading=pending;
    return pending;
  }

  async function refresh() { state.initialized=false; await load(); }

  async function authenticate(mode, fields) {
    await api(`/auth/${mode}`, 'POST', fields);
    state.products=null;state.answer=null;state.lastSearchQuery=null;
    await load(false);
    return state.session;
  }

  async function logout() {
    reset();
    await api('/auth/logout', 'POST', {});
  }

  function authPanel() {
    return `${app().pageHeading('Your bank connections.', 'Your accounts, consent, and imported data in one place.')}<section class="surface"><h2>${isSample()?'Sample profile · bank connections are off':'Connected services are unavailable.'}</h2><p>${isSample()?'Sample profiles never access real bank accounts. Sign out and create or sign in to your own PerkPilot account to connect a bank.':esc(state.error || 'Your PerkPilot session could not be verified. Refresh your session and try again.')}</p>${isSample()?'':'<button class="button secondary" data-action="connected-refresh">Try again</button>'}</section>`;
  }

  const merchantMark = name => esc(String(name || 'P').slice(0,2).toUpperCase());
  function profileMarkup(profile) {
    if (!profile) return '<div class="connected-empty"><strong>Spending insights are off.</strong><p>Enable consent to build this view from your connected transactions.</p></div>';
    const categories = (profile.categories || []).slice(0,4);
    return `<div class="connected-dna-copy"><h2>Your connected Spend DNA.</h2><p>${profile.transactionCount} posted purchase${profile.transactionCount===1?'':'s'} · ${profile.asOf?`synced ${esc(new Date(profile.asOf).toLocaleString())}`:'waiting for the first sync'}</p></div><div class="dna-orbit" aria-hidden="true"></div><div class="dna-legend">${categories.length?categories.map(category=>`<span>${esc(category.name)}<b>${category.count}</b></span>`).join(''):'<span>Your pattern starts here.<b>No purchases yet</b></span>'}</div>`;
  }

  function connectionsMarkup(rows) {
    if (!rows.length) return '<p class="fine-note">No bank account is connected yet.</p>';
    return rows.map(row=>`<div class="list-row"><span class="merchant-tile">${icon('card')}</span><span class="grow"><strong>Connected account</strong><p>${row.lastSyncedAt?`Last synced ${esc(new Date(row.lastSyncedAt).toLocaleString())}`:'Ready for its first sync'}</p></span><button class="text-button" data-action="connected-disconnect" data-id="${esc(row.id)}">Disconnect</button></div>`).join('');
  }

  function transactionsMarkup(rows) {
    if (!rows.length) return '<div class="connected-empty"><strong>No connected transactions yet.</strong><p>After linking through Plaid, refresh transactions to populate this activity.</p></div>';
    return rows.slice(0,10).map(row=>`<div class="list-row"><span class="merchant-tile">${merchantMark(row.merchantName)}</span><span class="grow"><strong>${esc(row.merchantName)}</strong><p>${esc(row.postedAt?.slice(0,10) || '')} · ${esc(row.status)} · Plaid</p></span><span class="right"><strong>${money(row.amountCents)}</strong></span></div>`).join('');
  }

  function productsMarkup(result) {
    if (!result) return '<div class="connected-empty compact"><strong>Search current products.</strong><p>Search listings from the configured catalog using your saved shopping location.</p></div>';
    if (!result.products?.length) return '<div class="connected-empty compact"><strong>No current listings found.</strong><p>Try a broader product name or another location.</p></div>';
    return `<p class="fine-note connected-result-meta">${result.products.length} listings${result.location?` near ${esc(result.location)}`:''} · observed ${esc(new Date(result.observedAt).toLocaleString())}</p>${result.products.map(product=>`<article class="product-card connected-product"><button type="button" class="product-art connected-product-open" data-action="connected-product" data-id="${esc(product.id)}" aria-label="View ${esc(product.name)}">${safeLink(product.imageUrl)?`<img src="${esc(safeLink(product.imageUrl))}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span>${icon('bag')}</span>`}</button><div><h3><button type="button" class="connected-product-title" data-action="connected-product" data-id="${esc(product.id)}">${esc(product.name)}</button></h3><p>${esc(product.merchantName)} · ${esc(product.source)}</p><div class="product-actions"><button type="button" class="button secondary" data-action="connected-product" data-id="${esc(product.id)}">${product.checkoutReference?'Buy with PerkPilot':'View product'} ${icon('arrow')}</button>${safeLink(product.url)?`<a class="text-button" href="${esc(safeLink(product.url))}" target="_blank" rel="noopener noreferrer">Retailer listing ${icon('external')}</a>`:''}</div><small class="fine-note">${esc(product.priceNote)}${product.checkoutReference?' · PerkPilot checkout is in test mode.':''}</small></div><strong class="product-price">${productPrice(product)}</strong></article>`).join('')}`;
  }

  function productPrice(product) {
    if(!Number.isSafeInteger(product.priceCents))return 'Price unavailable';
    if(/^[A-Z]{3}$/.test(product.currency || ''))return new Intl.NumberFormat('en-US',{style:'currency',currency:product.currency}).format(product.priceCents/100);
    return money(product.priceCents);
  }
  function safeLink(value) { try{const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password?url.href:null;}catch{return null;} }
  function closeProduct() {
    productSequence++;openedProductId=null;
    productController?.dispose?.({clearRecovery:false});productController=null;
  }
  async function openProduct(id) {
    ensureIdentity();
    const product=state.products?.products?.find(value=>value.id===id);
    if(!product || isSample())throw new Error('Search again to open this product.');
    const image=safeLink(product.imageUrl),url=safeLink(product.url);
    const hero=`<div class="explore-product-summary">${image?`<div class="explore-product-image"><img src="${esc(image)}" alt="${esc(product.name)}" referrerpolicy="no-referrer"></div>`:`<div class="explore-product-image">${icon('bag')}</div>`}<div><span class="eyebrow">Your Explore find</span><p class="explore-product-price">${productPrice(product)}</p><p class="fine-note">Observed merchandise price · ${esc(product.merchantName)}<br>${esc(product.source)}${product.observedAt?` · ${esc(new Date(product.observedAt).toLocaleDateString())}`:''}</p>${url?`<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open retailer listing ${icon('external')}</a>`:''}</div></div><div class="explore-sandbox-note"><span class="pill neutral">Sandbox checkout</span><p>Try this product through PerkPilot Test Store with your best enrolled test card. Test totals include 10% test tax and $5 test shipping. No real money moves and no order is sent to ${esc(product.merchantName || 'the retailer')}.</p></div>`;
    const unavailable=product.checkoutUnavailableReason || 'Sandbox checkout is unavailable for this listing. Refresh your search for eligible products priced within the $500 total limit.';
    app().showSheet(product.name,hero+(product.checkoutReference?'<div data-explore-checkout aria-live="polite"><p class="fine-note">Preparing your selected product…</p></div>':`<div class="explore-checkout-unavailable" role="status"><h3>Checkout unavailable</h3><p>${esc(unavailable)}</p><button type="button" class="button secondary" data-action="connected-product-search">Refresh search</button></div>`),{owner:'explore-checkout'});
    openedProductId=id;
    const request=++productSequence,generation=state.generation,root=document.querySelector('[data-explore-checkout]');
    if(!product.checkoutReference)return;
    const current=()=>{
      ensureIdentity();const sheet=document.querySelector('#sheet');
      return request===productSequence && generation===state.generation && app().state.page==='explore' && sheet?.open && sheet.dataset.owner==='explore-checkout' && root?.isConnected;
    };
    try {
      const result=await app().api('/agent-checkout/catalog-products','POST',{checkoutReference:product.checkoutReference});
      if(!current())return;
      if(!result.product?.sku || !result.product?.variantId || !window.CheckoutUI)throw new Error('The selected product could not be prepared. Refresh your search and try again.');
      productController=window.CheckoutUI.mount({root,api:app().api,selection:{sku:result.product.sku,variantId:result.product.variantId},walletCards:app().dataArray(app().state.data.cards),cardProducts:app().dataArray(app().state.data.cardProducts),identity:state.identity,sample:false,onWalletChanged:()=>app().refresh()});
    } catch(error) {
      if(!current())return;
      const message=error.code==='NOT_FOUND'?'Sandbox checkout is not enabled. Start the project with checkout enabled, then try again.':error.message;
      root.innerHTML=`<div class="explore-checkout-unavailable" role="alert"><h3>Could not prepare checkout</h3><p>${esc(message)}</p><div class="product-actions"><button type="button" class="button secondary" data-action="connected-product" data-id="${esc(id)}">Try again</button><button type="button" class="text-button" data-action="connected-product-search">Refresh search</button></div></div>`;
    }
  }

  function dashboardPanel() {
    const d=state.dashboard, user=d.user, profile=d.profile;
    return `${app().pageHeading('Your bank connections.', 'Manage your accounts, transaction insights, and connected data.', '', `Hello, ${esc(user.name.split(' ')[0])}.`)}
      <section class="dna-visual connected-dna">${profileMarkup(profile)}</section>
      <div class="grid-two section connected-grid"><section class="surface"><div class="section-heading"><div><h2>Bank connection</h2><p>Plaid and transaction controls</p></div><span class="pill ${d.connections.length?'':'neutral'}">${d.connections.length?`${d.connections.length} connected`:'Not connected'}</span></div><div class="switch-row"><div><h3>Use transactions for insights</h3><p>Controls connected Spend DNA and model context.</p></div><button class="toggle" role="switch" aria-checked="${user.consent}" data-action="connected-consent" aria-label="Use connected transactions for insights"></button></div><div class="connected-actions"><button class="button" data-action="connected-link" ${user.consent?'':'disabled'}>${icon('plus')} Connect account</button><button class="button secondary" data-action="connected-sync" ${d.connections.length?'':'disabled'}>${icon('refresh')} Refresh</button></div><div id="connected-connections">${connectionsMarkup(d.connections)}</div><p class="fine-note">Plaid handles bank credentials. PerkPilot stores encrypted access tokens and imported records.</p></section>
      <section class="surface"><div class="section-heading"><div><h2>Recent connected activity</h2><p>Posted and pending records from Plaid</p></div></div><div id="connected-transactions">${transactionsMarkup(d.transactions)}</div></section></div>
      <section class="surface section"><div class="section-heading"><div><h2>Connected accounts</h2><p>Balances reported by your financial provider.</p></div></div>${d.accounts?.length?d.accounts.map(account=>`<div class="list-row"><span class="merchant-tile">${icon('card')}</span><span class="grow"><strong>${esc(account.name || 'Bank account')}</strong><p>${esc(account.type)}${account.last4?` · •••• ${esc(account.last4)}`:''}</p></span><strong>${accountMoney(account)}</strong></div>`).join(''):'<p class="fine-note">Connect a bank to see its accounts here.</p>'}</section>
      ${state.session.authMode==='portal'?'<details class="surface section"><summary>Use an existing connected profile</summary><p class="fine-note">If you previously created a separate connected profile, enter its credentials to link it to this PerkPilot account. Matching email addresses alone never link accounts.</p><form id="connected-auth-form"><label class="field"><span>Existing connected email</span><input name="email" type="email" autocomplete="email" required></label><label class="field"><span>Existing connected password</span><input name="password" type="password" autocomplete="current-password" maxlength="128" required></label><button class="button secondary" type="submit">Link existing profile</button></form></details>':''}
      <details class="surface section connected-controls"><summary>Connected data controls</summary><p class="fine-note">Disconnecting removes imported data for that Plaid connection. Deleting connected data removes its stored accounts, transactions, and consent. Your PerkPilot account remains available.</p><div class="connected-actions">${state.session.authMode==='portal'?'':'<button class="button ghost" data-action="connected-logout">Sign out of connected services</button>'}<button class="button danger" data-action="connected-delete">Delete connected data</button></div></details>`;
  }

  function manualSearch() {
    return `<p class="fine-note">You can search manually and review prices at the retailer.</p><a class="button secondary" href="https://www.google.com/search?tbm=shop&amp;q=${encodeURIComponent(state.query || 'headphones')}" target="_blank" rel="noopener noreferrer">Search on Google Shopping ${icon('external')}</a>`;
  }

  function renderExplore() {
    ensureIdentity();
    const heading=app().pageHeading('A good fit starts with a question.', 'Find a product, compare your options, and try checkout with your best card.');
    if(!state.initialized && !isSample()) { queueMicrotask(()=>load());return heading+loadingMarkup(); }
    const d=state.dashboard,user=d?.user;
    const locationCopy=user?.shoppingLocation?`Searching near ${esc(user.shoppingLocation)}.`:'Using the catalog default location until you choose a city.';
    return heading+`${user?`<section class="connected-location location-entry"><span class="location-entry-icon">${icon('pin')}</span><div class="grow"><h2>Shopping location</h2><p id="connected-location-status">${locationCopy} Exact coordinates are not stored.</p><form id="connected-location-form"><input name="location" value="${esc(user.shoppingLocation || '')}" maxlength="120" placeholder="City, state, country" aria-label="Shopping location"><button class="button secondary" type="submit">Save</button></form></div><button class="button white" data-action="connected-locate">${icon('pin')} Use my location</button></section>`:''}
      <section class="section"><form id="connected-search-form" class="search-composer">${icon('explore')}<input name="query" value="${esc(state.query)}" minlength="2" maxlength="120" aria-label="Search current products" placeholder="Search headphones, running shoes, luggage…" required><button class="icon-button" type="submit" aria-label="Search current products">${icon('arrow')}</button></form>
      ${state.error || !d?.catalogConfigured?`<div class="surface"><h2>Current product search is unavailable.</h2><p>${esc(state.error || 'A live product catalog has not been configured.')} No sample listings are substituted.</p>${manualSearch()}<button class="text-button" data-action="connected-refresh">Try again</button></div>`:state.searchError?`<div class="surface" role="alert"><p>${esc(state.searchError)}</p>${manualSearch()}</div>`:`<div id="connected-products">${productsMarkup(state.products)}</div>`}</section>
      <section id="connected-assistant" class="surface section connected-assistant"><div class="section-heading"><div><h2>Ask PerkPilot</h2><p>The assistant uses observed listings and spending aggregates when you enable insights in Connected.</p></div><span class="pill ${d?.aiConfigured?'':'neutral'}">${d?.aiConfigured?'Assistant ready':'AI unavailable'}</span></div>${state.answer?`<div class="assistant-answer">${esc(state.answer.answer)}\n\n${esc(state.answer.source)} · ${esc(state.answer.model)}</div>`:''}${state.answerError?`<p class="error-message" role="alert">${esc(state.answerError)}</p>`:''}${d?.aiConfigured?'':'<p class="fine-note">The assistant is unavailable. You can still search products manually.</p>'}<form id="connected-assistant-form" class="assistant-form"><input name="message" maxlength="1000" placeholder="Help me compare these products…" aria-label="Ask PerkPilot about products" required><button class="button" type="submit" ${d?.aiConfigured?'':'disabled'} aria-label="Ask connected assistant">${icon('arrow')}</button></form><p class="fine-note">Prices are observed listings. Tax, shipping, and availability are confirmed at merchant checkout.</p></section>`;
  }

  function loadingMarkup() { return '<div class="initial-loading connected-loading"><span><i class="loading-dot"></i><i class="loading-dot"></i><i class="loading-dot"></i></span></div>'; }

  function render() {
    ensureIdentity();
    if(isSample())return authPanel();
    if (!state.initialized) {
      queueMicrotask(()=>load());
      return app().pageHeading('Your bank connections.', 'Loading your account data…')+loadingMarkup();
    }
    return state.session?.user && state.dashboard ? dashboardPanel() : authPanel();
  }

  async function loadPlaid() {
    if (window.Plaid) return;
    if (!plaidLoader) plaidLoader = new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';script.async=true;
      script.onload=resolve;script.onerror=()=>reject(new Error('Plaid Link could not load. Check your connection and try again.'));
      document.head.append(script);
    });
    await plaidLoader;
    if (!window.Plaid) throw new Error('Plaid Link could not initialize. Reload and try again.');
  }

  async function openPlaid(linkToken, receivedRedirectUri) {
    ensureIdentity();const generation=state.generation;
    await loadPlaid();
    ensureIdentity();if(generation!==state.generation)return;
    const link=window.Plaid.create({token:linkToken,...(receivedRedirectUri?{receivedRedirectUri}:{}),onSuccess:async publicToken=>{ensureIdentity();if(generation!==state.generation)return;sessionStorage.removeItem('perkpilot_link_token');history.replaceState(null,'',location.pathname+location.hash);await api('/plaid/exchange','POST',{publicToken});ensureIdentity();if(generation!==state.generation)return;await refresh();app().toast('Account connected.');},onExit:error=>{ensureIdentity();if(error&&generation===state.generation)app().toast(error.display_message||'Bank connection closed.');}});
    link.open();
  }

  async function action(name, target) {
    switch(name) {
      case 'connected-product':await openProduct(target.dataset.id);break;
      case 'connected-product-search':app().closeSheet();await search(state.query);break;
      case 'connected-refresh':await refresh();break;
      case 'connected-consent':await api('/consent','POST',{consent:!state.dashboard.user.consent});await refresh();app().toast('Connected insight preference saved.');break;
      case 'connected-link':{ensureIdentity();const generation=state.generation;const result=await api('/plaid/link-token','POST',{});ensureIdentity();if(generation!==state.generation)break;sessionStorage.setItem('perkpilot_link_token',JSON.stringify({identity:state.identity,token:result.linkToken}));await openPlaid(result.linkToken);break;}
      case 'connected-sync':await api('/plaid/sync','POST',{});await refresh();app().toast('Connected transactions refreshed.');break;
      case 'connected-disconnect':if(confirm('Disconnect this bank and remove its imported data?')){await api(`/plaid/items/${encodeURIComponent(target.dataset.id)}`,'DELETE',{});await refresh();app().toast('Bank disconnected.');}break;
      case 'connected-locate':await locate(target);break;
      case 'connected-assistant-focus':app().state.page='explore';if(location.hash!=='#explore')location.hash='explore';app().renderShell();if(!state.initialized)await load();document.querySelector('#connected-assistant')?.scrollIntoView({behavior:'smooth'});document.querySelector('#connected-assistant-form input')?.focus();break;
      case 'connected-logout':await logout();app().toast('Signed out of connected services.');break;
      case 'connected-delete':if(confirm('Delete your connected accounts, imported transactions, and insight consent permanently?')){await api('/account','DELETE',{});reset();await refresh();app().toast('Connected data deleted.');}break;
    }
  }

  async function locate(button) {
    ensureIdentity();const generation=state.generation,page=app().state.page;
    if (!navigator.geolocation) throw new Error('This browser does not support location lookup. Enter a city manually.');
    const status=document.querySelector('#connected-location-status'); if(status)status.textContent='Waiting for browser location permission…';
    await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,maximumAge:300000,timeout:10000})).then(async position=>{
      ensureIdentity();if(generation!==state.generation || page!==app().state.page)return;
      await api('/profile/location/locate','POST',{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyMeters:position.coords.accuracy,consent:true});
      ensureIdentity();if(generation!==state.generation)return;
      state.products=null;state.lastSearchQuery=null;await refresh();app().toast('Shopping location updated.');
    }).catch(error=>{ensureIdentity();if(generation!==state.generation)return;if(error?.code===1)throw new Error('Location permission was not granted. Enter a city manually.');throw error;});
  }

  async function submit(form, fields) {
    switch(form.id) {
      case 'connected-auth-form':await authenticate('login',fields);update();app().toast('Existing connected profile linked.');break;
      case 'connected-location-form':await api('/profile/location','PATCH',{location:fields.location});state.products=null;state.lastSearchQuery=null;await refresh();app().toast(fields.location?'Shopping location saved.':'Shopping location cleared.');break;
      case 'connected-search-form':await search(fields.query);break;
      case 'connected-assistant-form':{
        ensureIdentity();const generation=state.generation;state.answer=null;state.answerError=null;
        try{const answer=await api('/assistant','POST',{message:fields.message,...(state.lastSearchQuery?{catalogQuery:state.lastSearchQuery}:{})});ensureIdentity();if(generation===state.generation)state.answer=answer;}
        catch(error){ensureIdentity();if(generation===state.generation)state.answerError=error.message;}
        update();break;
      }
    }
  }

  async function search(query) {
    ensureIdentity();
    if(!state.initialized)await load(false);
    const generation=state.generation;
    Object.assign(state,{query,products:null,answer:null,lastSearchQuery:null,searchError:null,answerError:null});
    app().state.page='explore';if(location.hash!=='#explore')location.hash='explore';
    if(state.dashboard?.catalogConfigured){
      try{const products=await api(`/products?q=${encodeURIComponent(query)}`);ensureIdentity();if(generation===state.generation){state.products=products;state.lastSearchQuery=query;}}
      catch(error){ensureIdentity();if(generation===state.generation)state.searchError=error.message;}
    }
    update();
  }

  window.ConnectedUI={render,renderExplore,action,submit,search,authenticate,logout,refresh,reset,openProduct,closeProduct,currentProductId:()=>openedProductId,productById:id=>state.products?.products?.find(product=>product.id===id)};
})();
