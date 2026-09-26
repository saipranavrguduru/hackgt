const $ = (id) => document.getElementById(id);
const money = (cents) => Number.isSafeInteger(cents) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100) : 'Unknown';
let portal = 'http://localhost:3000';
let product;
let quantity = 1;
let cartState;
let cartSecret;
let updating = false;

function updateCart() {
  quantity = cartState.cart.quantity;
  const { merchandiseCents, shippingCents, taxCents } = cartState.cart;
  const final = Number.isSafeInteger(shippingCents) && Number.isSafeInteger(taxCents);
  const cart = $('store-cart');
  // Stable, narrowly scoped adapter contract. The update secret stays in this
  // module closure. Catalog version and server cart revision are distinct.
  cart.dataset.perkpilotCart = 'true';
  Object.assign(cart.dataset, {
    merchantId: product.merchantId, productId: product.id, quantity,
    merchandiseCents, shippingCents: shippingCents ?? 'unknown', taxCents: taxCents ?? 'unknown',
    currency: cartState.cart.currency, version: cartState.cart.version,
    cartRevision: cartState.revision, cartId: cartState.id,
  });
  $('quantity').value = String(quantity);
  $('quantity').textContent = String(quantity);
  $('bag-quantity').textContent = String(quantity);
  $('decrease').disabled = updating || quantity <= 1;
  $('increase').disabled = updating || quantity >= 10;
  $('merchandise-total').textContent = money(merchandiseCents);
  $('shipping-total').textContent = money(shippingCents);
  $('tax-total').textContent = money(taxCents);
  $('charge-total').textContent = final ? money(merchandiseCents + shippingCents + taxCents) : 'Provisional';
  $('checkout-link').href = `${portal}/?product=${encodeURIComponent(product.id)}&quantity=${quantity}&cartId=${encodeURIComponent(cartState.id)}&cartRevision=${cartState.revision}`;
}

async function mutateCart(nextQuantity, selectedSize) {
  if (updating) return;
  updating = true;
  $('store-status').hidden = false;
  $('store-status').classList.remove('error');
  $('store-status').textContent = 'Updating your demo cart…';
  $('checkout-link').setAttribute('aria-disabled', 'true');
  for (const control of [$('decrease'), $('increase'), ...$('sizes').children]) control.disabled = true;
  try {
    const response = await fetch(`/api/v1/store/carts/${encodeURIComponent(cartState.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: cartSecret, quantity: nextQuantity }), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'The cart could not be updated. Try again.');
    cartState = result;
    if (selectedSize) for (const option of $('sizes').children) option.setAttribute('aria-pressed', String(option === selectedSize));
    $('store-status').hidden = true;
  } catch (error) {
    $('store-status').textContent = error.message;
    $('store-status').classList.add('error');
  } finally {
    updating = false;
    $('checkout-link').removeAttribute('aria-disabled');
    for (const control of $('sizes').children) control.disabled = false;
    updateCart();
  }
}

function renderProduct() {
  const nike = product.merchantId === 'nike';
  const merchant = product.merchantName || (nike ? 'Nike' : 'Alo');
  const name = product.name || product.title;
  document.title = `${name} · ${merchant} Demo Store`;
  $('merchant-wordmark').textContent = nike ? 'NIKE' : 'alo';
  $('merchant-wordmark').classList.toggle('nike', nike);
  $('merchant-wordmark').href = `/store?product=${encodeURIComponent(product.id)}`;
  $('merchant-wordmark').setAttribute('aria-label', `${merchant} demo store`);
  $(nike ? 'nike-link' : 'alo-link').setAttribute('aria-current', 'page');
  $('breadcrumb-merchant').textContent = merchant;
  $('breadcrumb-name').textContent = name;
  $('product-name').textContent = name;
  $('product-description').textContent = product.description || 'Explore this controlled sample product and compare the cards you already have.';
  $('product-price').textContent = money(product.priceCents);
  $('product-reference').textContent = money(product.referencePriceCents);
  const discount = product.referencePriceCents > product.priceCents;
  $('product-reference').hidden = !discount;
  $('product-discount').hidden = !discount;
  if (discount) $('product-discount').textContent = `${Math.round((1 - product.priceCents / product.referencePriceCents) * 100)}% off`;
  $('jacket-art').hidden = nike;
  $('shoe-art').hidden = !nike;
  $('product-visual').classList.toggle('nike', nike);
  $('collection-label').textContent = nike ? 'MADE FOR YOUR NEXT MILE' : 'THE EVERYDAY COLLECTION';
  $('product-category').textContent = nike ? 'RUNNING · EVERYDAY COMFORT' : 'OUTERWEAR · EVERYDAY MOVEMENT';
  $('visual-caption').replaceChildren(...(nike ? ['Find your rhythm.', 'One mile at a time.'] : ['Considered design.', 'Everyday movement.']).flatMap((line, i) => i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
  const color = product.attributes?.color || (nike ? 'white' : 'sand');
  $('color-name').textContent = color[0].toUpperCase() + color.slice(1);
  $('color-swatch').style.background = nike ? '#e8eeee' : '#cbbda6';
  $('color-swatch').setAttribute('aria-label', `Selected color: ${color}`);
  for (const [index, label] of (product.attributes?.sizes || (nike ? ['8', '9', '10', '11'] : ['S', 'M', 'L'])).entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(index === 2));
    button.addEventListener('click', () => void mutateCart(quantity, button));
    $('sizes').append(button);
  }
  $('research-link').href = `${portal}/?research=${encodeURIComponent(product.id)}`;
  updateCart();
  $('product-layout').hidden = false;
  $('store-status').hidden = true;
}

$('decrease').addEventListener('click', () => { if (quantity > 1) void mutateCart(quantity - 1); });
$('increase').addEventListener('click', () => { if (quantity < 10) void mutateCart(quantity + 1); });
$('checkout-link').addEventListener('click', (event) => { if (updating) event.preventDefault(); });

try {
  const response = await fetch('/api/v1/store/products', { signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'The demo catalog is unavailable.');
  if (result.portalUrl) {
    const destination = new URL(result.portalUrl);
    if (destination.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(destination.hostname) && !destination.username && !destination.password) portal = destination.origin;
  }
  for (const link of document.querySelectorAll('a[href="http://localhost:3000"]')) link.href = portal;
  const productId = new URLSearchParams(location.search).get('product') || 'alo-jacket';
  product = result.products.find((item) => item.id === productId && ['alo-jacket', 'nike-pegasus'].includes(item.id));
  if (!product) throw new Error('This product is not in the controlled demo catalog. Choose Alo or Nike above.');
  const created = await fetch('/api/v1/store/carts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: product.id, quantity: 1 }), signal: AbortSignal.timeout(10000),
  });
  cartState = await created.json();
  if (!created.ok) throw new Error(cartState.error?.message || 'The demo cart could not be created.');
  cartSecret = cartState.secret;
  delete cartState.secret;
  renderProduct();
} catch (error) {
  $('store-status').textContent = error.message;
  $('store-status').classList.add('error');
}
