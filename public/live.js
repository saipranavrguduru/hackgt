'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const dollars = cents => Number.isSafeInteger(cents) ? new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents/100) : 'Unknown';
let register = false, dashboard = null, lastSearchQuery = null;
function notice(message) { const el = $('#notice'); el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 5000); }
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, { method, credentials:'same-origin', headers: body === undefined ? {} : { 'Content-Type':'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Request failed.');
  return data;
}
function authMode(value) { register = value; $('#name-field').hidden = !register; $('#registration-location-field').hidden = !register; $('#sign-in-tab').classList.toggle('selected', !register); $('#register-tab').classList.toggle('selected', register); $('#auth-form [name=password]').autocomplete = register ? 'new-password' : 'current-password'; }
async function refresh() {
  const session = await api('/auth/session');
  $('#auth').hidden = Boolean(session.user); $('#dashboard').hidden = !session.user; $('#logout').hidden = !session.user;
  if (!session.user) return;
  dashboard = await api('/dashboard');
  $('#greeting').textContent = `Hello, ${dashboard.user.name.split(' ')[0]}.`;
  $('#consent').checked = dashboard.user.consent;
  $('#shopping-location').value = dashboard.user.shoppingLocation || '';
  $('#location-status').innerHTML = dashboard.user.shoppingLocation
    ? `Searching near ${esc(dashboard.user.shoppingLocation)}. “Use my location” sends coordinates once to <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>; exact coordinates are not stored.`
    : `Using the catalog’s default location. Enter a city or use browser location. Exact coordinates are not stored. Geocoding by <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>.`;
  $('#coverage').textContent = dashboard.profile?.coverage || 'Spending insights are off. Enable them to create your profile.';
  const p = dashboard.profile;
  $('#profile').innerHTML = p ? `<p><strong>${p.transactionCount}</strong> posted purchases across connected accounts · synced ${p.asOf ? esc(new Date(p.asOf).toLocaleString()) : 'not yet'}</p><h3>Frequent merchants</h3>${p.merchants.length ? p.merchants.slice(0,5).map(m => `<div class="row"><span>${esc(m.name)} <small>${m.count} purchases</small></span><strong>${dollars(m.totalCents)}</strong></div>`).join('') : '<p class="muted">No posted purchases yet.</p>'}<h3>Categories</h3>${p.categories.slice(0,5).map(c => `<div class="row"><span>${esc(c.name)}</span><span>${c.count}</span></div>`).join('')}` : '<p>Spending insights are off.</p>';
  $('#transactions').innerHTML = dashboard.transactions.length ? dashboard.transactions.slice(0,12).map(t => `<div class="row"><span><strong>${esc(t.merchantName)}</strong><small>${esc(t.postedAt?.slice(0,10) || '')} · ${esc(t.status)}</small></span><strong>${dollars(t.amountCents)}</strong></div>`).join('') : '<p>No connected transactions yet.</p>';
  $('#connections').innerHTML = dashboard.connections.map(c => `<div class="row"><span>Connected account <small>Last synced ${c.lastSyncedAt ? esc(new Date(c.lastSyncedAt).toLocaleString()) : 'never'}</small></span><button class="quiet disconnect" data-id="${esc(c.id)}">Disconnect</button></div>`).join('');
  $('#connect').disabled = !dashboard.user.consent;
  $('#sync').disabled = !dashboard.connections.length;
  if (!dashboard.aiConfigured) $('#answer').textContent = 'AI is unavailable until a Gemini or OpenAI API key is configured.';
  if (!dashboard.catalogConfigured) $('#products').textContent = 'Live product search is unavailable until an authorized catalog provider is connected.';
}
$('#sign-in-tab').addEventListener('click', () => authMode(false));
$('#register-tab').addEventListener('click', () => authMode(true));
$('#auth-form').addEventListener('submit', async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); try { await api(register ? '/auth/register' : '/auth/login', 'POST', data); await refresh(); } catch (error) { notice(error.message); } });
$('#logout').addEventListener('click', async () => { try { await api('/auth/logout', 'POST', {}); await refresh(); } catch (error) { notice(error.message); } });
$('#consent').addEventListener('change', async event => { try { await api('/consent', 'POST', { consent: event.target.checked }); await refresh(); } catch (error) { notice(error.message); event.target.checked = !event.target.checked; } });
function openPlaid(linkToken, receivedRedirectUri) {
  if (!window.Plaid) throw new Error('Plaid Link could not load. Reload and try again.');
  const link = window.Plaid.create({ token: linkToken, ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
    onSuccess: async publicToken => { sessionStorage.removeItem('perkpilot_link_token'); history.replaceState(null, '', '/'); try { await api('/plaid/exchange', 'POST', { publicToken }); await refresh(); notice('Account connected. Initial transactions can take time to appear.'); } catch (error) { notice(error.message); } },
    onExit: error => { if (error) notice(error.display_message || 'Bank connection closed.'); }
  });
  link.open();
}
$('#connect').addEventListener('click', async () => {
  try { const token = await api('/plaid/link-token', 'POST', {}); sessionStorage.setItem('perkpilot_link_token', token.linkToken); openPlaid(token.linkToken); }
  catch (error) { notice(error.message); }
});
$('#sync').addEventListener('click', async () => { try { await api('/plaid/sync', 'POST', {}); await refresh(); notice('Transactions refreshed.'); } catch (error) { notice(error.message); } });
$('#connections').addEventListener('click', async event => { const button = event.target.closest('.disconnect'); if (!button) return; if (!confirm('Disconnect this bank and remove its imported data?')) return; try { await api(`/plaid/items/${encodeURIComponent(button.dataset.id)}`, 'DELETE', {}); await refresh(); } catch (error) { notice(error.message); } });
$('#location-form').addEventListener('submit', async event => {
  event.preventDefault();
  const location = new FormData(event.target).get('location');
  try {
    const result = await api('/profile/location', 'PATCH', { location });
    lastSearchQuery = null; $('#products').textContent = '';
    await refresh(); notice(result.location ? 'Shopping location updated.' : 'Shopping location cleared.');
  } catch (error) { notice(error.message); }
});
$('#locate-me').addEventListener('click', () => {
  const button = $('#locate-me');
  if (!navigator.geolocation) { notice('This browser does not support location lookup. Enter your city manually.'); return; }
  button.disabled = true; $('#location-status').textContent = 'Waiting for browser location permission…';
  navigator.geolocation.getCurrentPosition(async position => {
    try {
      const result = await api('/profile/location/locate', 'POST', { latitude:position.coords.latitude, longitude:position.coords.longitude, accuracyMeters:position.coords.accuracy, consent:true });
      lastSearchQuery = null; $('#products').textContent = '';
      await refresh(); notice(`Shopping location set to ${result.location}.`);
    } catch (error) { notice(error.message); await refresh().catch(() => {}); }
    finally { button.disabled = false; }
  }, error => {
    button.disabled = false;
    $('#location-status').textContent = dashboard?.user.shoppingLocation ? `Searching near ${dashboard.user.shoppingLocation}.` : 'Enter a city manually or allow location access and try again.';
    notice(error.code === 1 ? 'Location permission was not granted. You can enter a city manually.' : 'Your location could not be found. Enter a city manually.');
  }, { enableHighAccuracy:false, maximumAge:300000, timeout:10000 });
});
$('#search-form').addEventListener('submit', async event => { event.preventDefault(); const q = new FormData(event.target).get('query'); $('#products').textContent = 'Searching…'; try { const result = await api(`/products?q=${encodeURIComponent(q)}`); lastSearchQuery = q; $('#products').innerHTML = result.products.length ? result.products.map(p => `<div class="row"><span><strong>${esc(p.name)}</strong><small>${esc(p.merchantName)} · ${esc(p.source)} · ${esc(new Date(p.observedAt).toLocaleString())}</small><small>${esc(p.priceNote)}</small></span><span><strong>${dollars(p.priceCents)}</strong><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">View product options</a></span></div>`).join('') : '<p>No current listings found.</p>'; } catch (error) { lastSearchQuery = null; $('#products').textContent = ''; notice(error.message); } });
$('#ask-form').addEventListener('submit', async event => { event.preventDefault(); const message = new FormData(event.target).get('message'); $('#answer').textContent = 'Thinking…'; try { const result = await api('/assistant', 'POST', { message, ...(lastSearchQuery ? { catalogQuery: lastSearchQuery } : {}) }); $('#answer').textContent = `${result.answer}\n\nAI answer · ${result.model} · spending data as of ${result.factsAsOf ? new Date(result.factsAsOf).toLocaleString() : 'no bank sync yet'}`; } catch (error) { $('#answer').textContent = ''; notice(error.message); } });
$('#delete-account').addEventListener('click', async () => { if (!confirm('Delete your account and connected data permanently?')) return; try { await api('/account', 'DELETE', {}); await refresh(); notice('Account deleted.'); } catch (error) { notice(error.message); } });
refresh().then(() => {
  if (new URLSearchParams(location.search).has('oauth_state_id')) {
    const linkToken = sessionStorage.getItem('perkpilot_link_token');
    if (linkToken) { try { openPlaid(linkToken, location.href); } catch (error) { notice(error.message); } }
    else notice('Bank connection session expired. Start again.');
  }
}).catch(error => notice(error.message));
