'use strict';

(() => {
  const state = { initialized:false, loading:false, authMode:'login', session:null, dashboard:null, products:null, answer:null, lastSearchQuery:null };
  let plaidLoader;
  const app = () => window.App;
  const esc = value => app().escapeHtml(value ?? '');
  const money = value => app().money(value);
  const icon = name => app().icon(name);

  async function api(path, method = 'GET', body) {
    const response = await fetch(`/api${path}`, { method, credentials:'same-origin', headers:body === undefined ? {} : {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body) });
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(result.error?.message || `Request failed (${response.status})`); error.code=result.error?.code; error.status=response.status; throw error; }
    return result;
  }

  function update() {
    if (app()?.state.page !== 'connected') return;
    const target = document.querySelector('#main-content');
    if (target) target.innerHTML = render();
  }

  async function load(shouldUpdate = true) {
    if (state.loading) return;
    state.loading = true;
    try {
      state.session = await api('/auth/session');
      state.dashboard = state.session.user ? await api('/dashboard') : null;
      state.initialized = true;
      if (state.session.user && new URLSearchParams(location.search).has('oauth_state_id')) {
        const token = sessionStorage.getItem('perkpilot_link_token');
        if (token) await openPlaid(token, location.href); else app().toast('Bank connection session expired. Start again.');
      }
    } finally { state.loading = false; }
    if (shouldUpdate) update();
  }

  async function refresh() { state.initialized=false; await load(); }

  async function authenticate(mode, fields) {
    try { await api(`/auth/${mode}`, 'POST', fields); }
    catch (error) {
      if (mode !== 'register' || error.code !== 'ACCOUNT_EXISTS') throw error;
      await api('/auth/login', 'POST', {email:fields.email,password:fields.password});
    }
    await load(false);
    return state.session;
  }

  async function logout() {
    await api('/auth/logout', 'POST', {});
    Object.assign(state,{initialized:true,session:{user:null},dashboard:null,products:null,answer:null,lastSearchQuery:null});
    update();
  }

  function authPanel() {
    const register = state.authMode === 'register';
    return `${app().pageHeading('Bring your real data into PerkPilot.', 'Connect accounts, current product listings, and model-backed guidance without leaving the full app.', '<span class="pill neutral">Connected services</span>')}
      <section class="surface connected-auth-surface"><div><span class="eyebrow green">Optional live workspace</span><h2>${register?'Create your connected profile.':'Sign in to connected services.'}</h2><p>Your demo journeys remain available. Connected records stay in PostgreSQL and use a separate secure session.</p><div class="connected-provider-row"><span class="pill">Plaid</span><span class="pill">Gemini</span><span class="pill">Google Shopping</span></div></div><div class="connected-auth-box"><div class="tabs" role="tablist"><button class="${!register?'active':''}" data-action="connected-auth-mode" data-mode="login">Sign in</button><button class="${register?'active':''}" data-action="connected-auth-mode" data-mode="register">Create account</button></div><form id="connected-auth-form">${register?'<label class="field"><span>Your name</span><input name="name" autocomplete="name" maxlength="80" required></label><label class="field"><span>Shopping location <small>(optional)</small></span><input name="shoppingLocation" autocomplete="address-level2" maxlength="120" placeholder="City, state, country"></label>':''}<label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" minlength="12" maxlength="128" required></label><button class="button full" type="submit">${register?'Create connected profile':'Sign in'} ${icon('arrow')}</button></form></div></section>`;
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
    if (!result) return '<div class="connected-empty compact"><strong>Search current products.</strong><p>Results come from Google Shopping through SerpApi and use your saved shopping location.</p></div>';
    if (!result.products?.length) return '<div class="connected-empty compact"><strong>No current listings found.</strong><p>Try a broader product name or another location.</p></div>';
    return `<p class="fine-note connected-result-meta">${result.products.length} listings near ${esc(result.location)} · observed ${esc(new Date(result.observedAt).toLocaleString())}</p>${result.products.map(product=>`<article class="product-card connected-product"><div class="product-art">${product.imageUrl?`<img src="${esc(product.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span>${icon('bag')}</span>`}</div><div><h3>${esc(product.name)}</h3><p>${esc(product.merchantName)} · ${esc(product.source)}</p><div class="product-actions"><a class="text-button" href="${esc(product.url)}" target="_blank" rel="noopener noreferrer">View product options ${icon('external')}</a></div><small class="fine-note">${esc(product.priceNote)}</small></div><strong class="product-price">${money(product.priceCents)}</strong></article>`).join('')}`;
  }

  function dashboardPanel() {
    const d=state.dashboard, user=d.user, profile=d.profile;
    const locationCopy=user.shoppingLocation?`Searching near ${esc(user.shoppingLocation)}.`:'Using the United States fallback until you choose a city.';
    return `${app().pageHeading('Your connected everyday.', 'Real account data and current products, inside the original PerkPilot experience.', '<span class="pill">Live providers ready</span>', `Hello, ${esc(user.name.split(' ')[0])}.`)}
      <section class="connected-location location-entry"><span class="location-entry-icon">${icon('pin')}</span><div class="grow"><h2>Shopping location</h2><p id="connected-location-status">${locationCopy} Exact coordinates are not stored.</p><form id="connected-location-form"><input name="location" value="${esc(user.shoppingLocation || '')}" maxlength="120" placeholder="City, state, country" aria-label="Shopping location"><button class="button secondary" type="submit">Save</button></form></div><button class="button white" data-action="connected-locate">${icon('pin')} Use my location</button></section>
      <section class="dna-visual connected-dna">${profileMarkup(profile)}</section>
      <div class="grid-two section connected-grid"><section class="surface"><div class="section-heading"><div><h2>Bank connection</h2><p>Plaid Sandbox and transaction controls</p></div><span class="pill ${d.connections.length?'':'neutral'}">${d.connections.length?`${d.connections.length} connected`:'Not connected'}</span></div><div class="switch-row"><div><h3>Use transactions for insights</h3><p>Controls connected Spend DNA and model context.</p></div><button class="toggle" role="switch" aria-checked="${user.consent}" data-action="connected-consent" aria-label="Use connected transactions for insights"></button></div><div class="connected-actions"><button class="button" data-action="connected-link" ${user.consent?'':'disabled'}>${icon('plus')} Connect account</button><button class="button secondary" data-action="connected-sync" ${d.connections.length?'':'disabled'}>${icon('refresh')} Refresh</button></div><div id="connected-connections">${connectionsMarkup(d.connections)}</div><p class="fine-note">Plaid handles bank credentials. PerkPilot stores encrypted access tokens and imported records.</p></section>
      <section class="surface"><div class="section-heading"><div><h2>Recent connected activity</h2><p>Posted and pending records from Plaid</p></div></div><div id="connected-transactions">${transactionsMarkup(d.transactions)}</div></section></div>
      <section class="section"><div class="section-heading"><div><h2>Explore current products</h2><p>Live Google Shopping listings through SerpApi</p></div></div><form id="connected-search-form" class="search-composer">${icon('explore')}<input name="query" minlength="2" maxlength="120" placeholder="Search headphones, running shoes, luggage…" required><button class="icon-button" type="submit" aria-label="Search current products">${icon('arrow')}</button></form><div id="connected-products">${productsMarkup(state.products)}</div></section>
      <section id="connected-assistant" class="surface section connected-assistant"><div class="section-heading"><div><h2>Ask PerkPilot</h2><p>Gemini receives aggregates and up to five current listings, never bank credentials or raw transactions.</p></div><span class="pill ${d.aiConfigured?'':'neutral'}">${d.aiConfigured?'Gemini ready':'AI unavailable'}</span></div>${state.answer?`<div class="assistant-answer">${esc(state.answer.answer)}\n\n${esc(state.answer.source)} · ${esc(state.answer.model)}</div>`:''}<form id="connected-assistant-form" class="assistant-form"><input name="message" maxlength="1000" placeholder="What patterns do you see in my spending?" required><button class="button" type="submit" aria-label="Ask connected assistant">${icon('arrow')}</button></form></section>
      <details class="surface section connected-controls"><summary>Connected data controls</summary><p class="fine-note">Disconnecting removes imported data for that Plaid connection. Deleting the connected profile removes its stored PerkPilot records.</p><div class="connected-actions"><button class="button ghost" data-action="connected-logout">Sign out of connected services</button><button class="button danger" data-action="connected-delete">Delete connected profile</button></div></details>`;
  }

  function render() {
    if (!state.initialized) {
      queueMicrotask(()=>load().catch(error=>{ state.initialized=true; state.session={user:null}; app().toast(error.message); update(); }));
      return `${app().pageHeading('Connected PerkPilot.', 'Loading your live providers and account data…', '<span class="pill neutral">Connecting</span>')}<div class="initial-loading connected-loading"><span><i class="loading-dot"></i><i class="loading-dot"></i><i class="loading-dot"></i></span></div>`;
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
    await loadPlaid();
    const link=window.Plaid.create({token:linkToken,...(receivedRedirectUri?{receivedRedirectUri}:{}),onSuccess:async publicToken=>{sessionStorage.removeItem('perkpilot_link_token');history.replaceState(null,'',location.pathname+location.hash);await api('/plaid/exchange','POST',{publicToken});await refresh();app().toast('Account connected.');},onExit:error=>{if(error)app().toast(error.display_message||'Bank connection closed.');}});
    link.open();
  }

  async function action(name, target) {
    switch(name) {
      case 'connected-auth-mode':state.authMode=target.dataset.mode;update();break;
      case 'connected-consent':await api('/consent','POST',{consent:!state.dashboard.user.consent});await refresh();app().toast('Connected insight preference saved.');break;
      case 'connected-link':{const result=await api('/plaid/link-token','POST',{});sessionStorage.setItem('perkpilot_link_token',result.linkToken);await openPlaid(result.linkToken);break;}
      case 'connected-sync':await api('/plaid/sync','POST',{});await refresh();app().toast('Connected transactions refreshed.');break;
      case 'connected-disconnect':if(confirm('Disconnect this bank and remove its imported data?')){await api(`/plaid/items/${encodeURIComponent(target.dataset.id)}`,'DELETE',{});await refresh();app().toast('Bank disconnected.');}break;
      case 'connected-locate':await locate(target);break;
      case 'connected-assistant-focus':document.querySelector('#connected-assistant')?.scrollIntoView({behavior:'smooth'});document.querySelector('#connected-assistant-form input')?.focus();break;
      case 'connected-logout':await logout();app().toast('Signed out of connected services.');break;
      case 'connected-delete':if(confirm('Delete your connected profile and all imported data permanently?')){await api('/account','DELETE',{});Object.assign(state,{session:{user:null},dashboard:null,products:null,answer:null});update();app().toast('Connected profile deleted.');}break;
    }
  }

  async function locate(button) {
    if (!navigator.geolocation) throw new Error('This browser does not support location lookup. Enter a city manually.');
    const status=document.querySelector('#connected-location-status'); if(status)status.textContent='Waiting for browser location permission…';
    await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,maximumAge:300000,timeout:10000})).then(async position=>{
      await api('/profile/location/locate','POST',{latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyMeters:position.coords.accuracy,consent:true});
      state.products=null;state.lastSearchQuery=null;await refresh();app().toast('Shopping location updated.');
    }).catch(error=>{if(error?.code===1)throw new Error('Location permission was not granted. Enter a city manually.');throw error;});
  }

  async function submit(form, fields) {
    switch(form.id) {
      case 'connected-auth-form':await authenticate(state.authMode,fields);update();app().toast('Connected services are ready.');break;
      case 'connected-location-form':await api('/profile/location','PATCH',{location:fields.location});state.products=null;state.lastSearchQuery=null;await refresh();app().toast(fields.location?'Shopping location saved.':'Shopping location cleared.');break;
      case 'connected-search-form':state.products=await api(`/products?q=${encodeURIComponent(fields.query)}`);state.lastSearchQuery=fields.query;update();break;
      case 'connected-assistant-form':state.answer=await api('/assistant','POST',{message:fields.message,...(state.lastSearchQuery?{catalogQuery:state.lastSearchQuery}:{})});update();break;
    }
  }

  window.ConnectedUI={render,action,submit,authenticate,logout,refresh};
})();
