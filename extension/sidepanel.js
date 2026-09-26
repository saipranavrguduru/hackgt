import { supportedStoreUrl, parseCartSnapshot, cartFingerprint, ContextGuard, expiryTime } from './core.js';

const API = 'http://localhost:3000/api/v1';
const PORTAL = 'http://localhost:3000';
const $ = (id) => document.getElementById(id);
const money = (cents) => Number.isSafeInteger(cents) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100) : 'Unknown';
const guard = new ContextGuard();
let session = null;
let pairing = null;
let allowedTabId = null;
let currentCart = null;
let currentQuote = null;
let selectedCardId = null;
let navigationRevision = 0;
let readRevision = 0;
let requestRevision = 0;
let readPending = false;
let pairPending = false;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function resetContext(message) {
  navigationRevision += 1;
  requestRevision += 1;
  guard.invalidate();
  currentCart = null;
  currentQuote = null;
  selectedCardId = null;
  $('cart-section').hidden = true;
  $('quote-section').hidden = true;
  $('research').disabled = true;
  if (message) status(message);
}

function connectionView() {
  const connected = session && expiryTime(session.expiresAt) > Date.now();
  $('connection-title').textContent = connected ? 'PerkPilot connected' : 'Connect PerkPilot';
  $('connection-description').textContent = connected
    ? `Connection expires at ${new Date(session.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. You approve any purchase in the portal.`
    : pairing ? 'Approve the connection in the portal, then return here to finish.' : 'Approve a 30-minute connection in your signed-in PerkPilot portal.';
  $('pair').hidden = Boolean(connected || pairing);
  $('pair-check').hidden = !pairing || Boolean(connected);
  $('disconnect').hidden = !connected;
  $('connection-dot').classList.toggle('connected', Boolean(connected));
}

async function disconnect(message = 'Disconnected. Connect again to compare cards.') {
  session = null;
  pairing = null;
  await chrome.storage.session.remove(['session', 'pairing']);
  resetContext(message);
  connectionView();
}

async function api(path, body, { authenticated = true, method = 'POST', key } = {}) {
  if (authenticated && (!session || expiryTime(session.expiresAt) <= Date.now())) {
    await disconnect('Your connection expired. Connect again to continue.');
    throw new Error('Your connection expired. Connect again to continue.');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated) headers.Authorization = `Bearer ${session.token}`;
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(`${API}${path}`, {
    method, headers, credentials: 'omit',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (authenticated && response.status === 401) await disconnect('Your connection expired or was revoked. Reconnect in the portal.');
    const error = new Error(result.error?.message || `Request failed (${response.status}).`);
    error.code = result.error?.code;
    throw error;
  }
  return result;
}

// This function is serialized by Chrome and runs in an isolated world.
// It accesses no inputs, page HTML, page scripts, or payment details.
function readControlledCart() {
  if (location.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(location.hostname)
    || location.port !== '3001' || !['/store', '/store.html'].includes(location.pathname)) return null;
  const cart = document.querySelector('[data-perkpilot-cart]');
  if (!cart) return null;
  const { merchantId, productId, quantity, merchandiseCents, shippingCents, taxCents, currency, version, cartRevision, cartId } = cart.dataset;
  return { merchantId, productId, quantity, merchandiseCents, shippingCents, taxCents, currency, version, cartRevision, cartId };
}

async function readCart() {
  const revision = navigationRevision;
  const read = ++readRevision;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id !== allowedTabId) throw new Error('Select Analyze this cart to read this tab.');
  if (!supportedStoreUrl(tab.url)) throw new Error('Site not supported. Use the controlled Alo or Nike demo store.');
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readControlledCart });
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (read !== readRevision || revision !== navigationRevision || active?.id !== tab.id || allowedTabId !== tab.id) return null;
  const cart = parseCartSnapshot(tab.url, result?.result);
  const changed = !currentCart || cartFingerprint(cart) !== cartFingerprint(currentCart);
  guard.update(tab.id, cart);
  currentCart = cart;
  $('merchant').textContent = `${cart.merchantId === 'alo' ? 'ALO' : 'NIKE'} · CONTROLLED DEMO`;
  $('product').textContent = cart.productId === 'alo-jacket' ? 'Alo Running Jacket' : 'Nike Pegasus Running Shoes';
  $('cart-total').textContent = money(cart.merchandiseCents + cart.shippingCents + cart.taxCents);
  $('cart-detail').textContent = `${cart.quantity} ${cart.quantity === 1 ? 'item' : 'items'} · ${money(cart.shippingCents)} shipping · ${money(cart.taxCents)} tax`;
  $('cart-section').hidden = false;
  $('research').disabled = false;
  if (changed) {
    currentQuote = null;
    $('quote-section').hidden = true;
  }
  return { cart, changed };
}

function quoteBody(cart) {
  return {
    productId: cart.productId, quantity: cart.quantity,
    cart: {
      productId: cart.productId, quantity: cart.quantity,
      merchandiseCents: cart.merchandiseCents, shippingCents: cart.shippingCents,
      taxCents: cart.taxCents, currency: cart.currency, version: cart.version,
      ...(cart.cartId ? { cartId: cart.cartId, cartRevision: cart.cartRevision } : {}),
    },
  };
}

async function requestQuote() {
  if (!currentCart || !session) return;
  const context = guard.capture();
  const revision = ++requestRevision;
  const body = quoteBody(currentCart);
  status('Comparing your cards with the current cart…');
  try {
    const result = await api('/commerce/quotes', body);
    const fresh = await readCart();
    if (!fresh || revision !== requestRevision || !guard.isCurrent(context)) {
      if (fresh?.changed) void requestQuote();
      return;
    }
    currentQuote = result.quote || result;
    selectedCardId = currentQuote.bestAvailableNowCardId || currentQuote.plans?.[0]?.cardId;
    renderQuote();
    status('Updated for this cart. No purchase has been made.');
  } catch (error) {
    if (revision === requestRevision && guard.isCurrent(context)) {
      currentQuote = null;
      $('quote-section').hidden = true;
      status(error.message, true);
    }
  }
}

function renderQuote() {
  const quote = currentQuote;
  if (!quote) return;
  const plans = quote.plans || [];
  $('plans').replaceChildren();
  $('quote-actions').replaceChildren();
  $('quote-section').hidden = false;
  if (!plans.length) {
    $('plans').append(element('p', 'No cards to compare yet. Add a card in your PerkPilot Wallet.', 'small'));
    return;
  }
  for (const plan of plans) {
    const button = element('button', undefined, `plan${selectedCardId === plan.cardId ? ' selected' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selectedCardId === plan.cardId));
    if (plan.cardId === quote.bestAvailableNowCardId) button.append(element('span', 'BEST AVAILABLE NOW', 'label'));
    button.append(element('span', `${plan.cardName || plan.cardId}${plan.last4 ? ` · ${plan.last4}` : ''}`, 'card-name'));
    const effective = element('span', undefined, 'effective');
    effective.append(element('span', 'Estimated effective cost'), element('strong', money(plan.effectiveCostCents)));
    button.append(effective, element('span', `${money(plan.statementCreditCents)} later credit · ${money(plan.rewardCents)} estimated reward`, 'breakdown'));
    button.addEventListener('click', () => { selectedCardId = plan.cardId; renderQuote(); });
    $('plans').append(button);
  }
  const after = plans.find((plan) => plan.cardId === quote.bestAfterActionsCardId);
  if (after?.prerequisites?.length) {
    const conditional = element('div', undefined, 'conditional');
    conditional.append(element('span', `After activation · ${after.cardName}`), element('strong', money(after.conditionalEffectiveCostCents)));
    conditional.append(element('p', 'Synthetic assigned offer. Activation is required before this credit can enter a ready quote.', 'small'));
    for (const requirement of after.prerequisites.filter((item) => item.type === 'activation')) {
      const activate = element('button', 'Activate offer & re-quote', 'primary');
      activate.addEventListener('click', () => void activateOffer(requirement.offerId, activate));
      conditional.append(activate);
    }
    $('quote-actions').append(conditional);
  }
  const selected = plans.find((plan) => plan.cardId === selectedCardId);
  if (selected) {
    const terms = element('details', undefined, 'terms');
    terms.append(element('summary', 'How this estimate works'));
    for (const note of selected.calculationNotes || []) terms.append(element('p', note, 'small'));
    for (const benefit of selected.disallowedBenefits || []) terms.append(element('p', `Excluded benefit: ${benefit.reason}`, 'small'));
    terms.append(element('p', selected.provenance === 'synthetic' ? 'Sample card holding and offer eligibility are synthetic.' : 'Self-reported card. Ownership and eligibility are unverified.', 'small'));
    $('quote-actions').append(terms);
  }
  const checkout = element('button', 'Review demo checkout ↗', 'primary');
  checkout.disabled = quote.provisional || !quote.executable || !selected?.ready || !selected?.checkoutEligible;
  checkout.addEventListener('click', () => void startCheckout(checkout));
  $('quote-actions').append(checkout);
  if (checkout.disabled) $('quote-actions').append(element('p', 'Checkout needs a current final quote and a sample payment-enabled card. Self-reported cards are comparison only.', 'small'));
  $('quote-freshness').textContent = `Quote expires ${new Date(quote.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Charge today stays ${money(quote.cart?.checkoutCents)}. Credits and rewards may arrive later.`;
}

async function activateOffer(offerId, button) {
  const context = guard.capture();
  button.disabled = true;
  try {
    await api(`/commerce/offers/${encodeURIComponent(offerId)}/activate`, {});
    const fresh = await readCart();
    if (fresh && guard.isCurrent(context)) await requestQuote();
  } catch (error) { if (guard.isCurrent(context)) status(error.message, true); }
  finally { button.disabled = false; }
}

async function startCheckout(button) {
  const context = guard.capture();
  const quote = currentQuote;
  const cardId = selectedCardId;
  button.disabled = true;
  try {
    const fresh = await readCart();
    if (!fresh || !guard.isCurrent(context) || !quote || expiryTime(quote.expiresAt) <= Date.now()) {
      status('The cart or quote changed. Review a fresh comparison first.');
      if (fresh) await requestQuote();
      return;
    }
    const checkout = await api('/checkout/sessions', { quoteId: quote.id, cardId }, { key: crypto.randomUUID() });
    const checked = await readCart();
    if (!checked || !guard.isCurrent(context)) {
      status('The cart changed. Review a fresh quote before checkout.');
      if (checked) await requestQuote();
      return;
    }
    const id = checkout.id || checkout.session?.id;
    if (!id) throw new Error('The checkout could not be prepared. Refresh and try again.');
    await chrome.tabs.create({ url: `${PORTAL}/?checkout=${encodeURIComponent(id)}` });
  } catch (error) { if (guard.isCurrent(context)) status(error.message, true); }
  finally { button.disabled = false; }
}

async function analyze(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || (tabId !== undefined && tabId !== tab.id)) return;
  allowedTabId = tab.id;
  resetContext();
  try {
    const fresh = await readCart();
    if (!fresh) return;
    if (session) await requestQuote();
    else status('Cart ready. Connect PerkPilot to compare your cards.');
  } catch (error) { allowedTabId = null; resetContext(); status(error.message, true); }
}

async function checkPairing() {
  if (!pairing || pairPending) return;
  if (expiryTime(pairing.expiresAt) <= Date.now()) {
    pairing = null;
    await chrome.storage.session.remove('pairing');
    connectionView();
    status('Connection request expired. Start a new connection.', true);
    return;
  }
  pairPending = true;
  $('pair-check').disabled = true;
  try {
    const result = await api(`/extension/pairings/${encodeURIComponent(pairing.id)}/exchange`, { secret: pairing.secret }, { authenticated: false });
    if (!result.token || !result.expiresAt) throw new Error('The portal did not return a connection. Try again.');
    session = { token: result.token, expiresAt: result.expiresAt };
    pairing = null;
    await chrome.storage.session.set({ session });
    await chrome.storage.session.remove('pairing');
    connectionView();
    status('Connected. Return to the store and analyze its cart.');
    if (currentCart) await requestQuote();
  } catch (error) {
    status(error.code === 'PAIRING_PENDING' ? 'Approval is still pending. Approve in the portal, then finish connecting.' : error.message, error.code !== 'PAIRING_PENDING');
  } finally { pairPending = false; $('pair-check').disabled = false; }
}

$('pair').addEventListener('click', async () => {
  $('pair').disabled = true;
  try {
    pairing = await api('/extension/pairings', { extensionId: chrome.runtime.id }, { authenticated: false });
    await chrome.storage.session.set({ pairing });
    connectionView();
    await chrome.tabs.create({ url: `${PORTAL}/?pairing=${encodeURIComponent(pairing.id)}` });
  } catch (error) { status(error.message, true); }
  finally { $('pair').disabled = false; }
});
$('pair-check').addEventListener('click', () => void checkPairing());
$('disconnect').addEventListener('click', async () => {
  try { await api('/extension/session', undefined, { method: 'DELETE' }); }
  catch (error) { status(error.message, true); }
  await disconnect();
});
$('analyze').addEventListener('click', () => void analyze());
$('refresh').addEventListener('click', () => void analyze());
$('research').addEventListener('click', async () => {
  const fresh = await readCart().catch(() => null);
  if (fresh) await chrome.tabs.create({ url: `${PORTAL}/?research=${encodeURIComponent(fresh.cart.productId)}` });
});

chrome.tabs.onActivated.addListener(() => {
  allowedTabId = null;
  resetContext('Tab changed. Select Analyze this cart to read this tab.');
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === allowedTabId && (change.status === 'loading' || change.url)) {
    allowedTabId = null;
    resetContext('Page changed. Select Analyze this cart when the store is ready.');
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.invocation?.newValue) void analyze(changes.invocation.newValue.tabId);
});

const stored = await chrome.storage.session.get(['session', 'pairing', 'invocation']);
session = stored.session || null;
pairing = stored.pairing || null;
connectionView();
if (session && expiryTime(session.expiresAt) <= Date.now()) await disconnect('Your connection expired. Reconnect in the portal.');
if (stored.invocation) await analyze(stored.invocation.tabId);

// Poll only the clicked, currently active controlled tab while this panel is open.
// Every response also re-reads the cart before rendering or opening checkout.
setInterval(async () => {
  if (session && expiryTime(session.expiresAt) <= Date.now()) await disconnect('Your connection expired. Reconnect in the portal.');
  if (document.hidden || allowedTabId === null || readPending) return;
  readPending = true;
  try {
    const fresh = await readCart();
    if (fresh?.changed && session) void requestQuote();
    if (currentQuote && expiryTime(currentQuote.expiresAt) <= Date.now()) {
      currentQuote = null;
      $('quote-section').hidden = true;
      status('Quote expired. Select Analyze this cart for a fresh comparison.');
    }
  } catch (error) { resetContext(); status(error.message, true); }
  finally { readPending = false; }
}, 1200);
