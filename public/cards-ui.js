'use strict';

// Card artwork is a local illustration. Reward information comes from the issuer-sourced catalog.
(() => {
  const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const skins = new Set(['discover-it','active-cash','quicksilver','freedom-unlimited','savor','freedom-flex','blue-cash-everyday','blue-cash-preferred','citi-double-cash','citi-custom-cash','costco-anywhere','attune','bofa-customized-cash','bofa-unlimited-cash','us-bank-cash-plus','us-bank-smartly','apple-card','paypal-cashback','fidelity-rewards','prime-visa','amazon-visa']);
  const baseRate = product => Number.isFinite(product?.rewardBps) ? `${product.rewardBps / 100}%` : '—';
  const annualFee = product => Number.isSafeInteger(product?.annualFeeCents) ? `${new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(product.annualFeeCents / 100)} annual fee` : 'See issuer for annual fee';
  const chip = '<svg class="card-emv" viewBox="0 0 40 30" fill="none" aria-hidden="true"><rect x=".5" y=".5" width="39" height="29" rx="6" fill="currentColor" fill-opacity=".3"/><g stroke="currentColor" stroke-opacity=".55"><rect x=".5" y=".5" width="39" height="29" rx="6"/><rect x="13" y="7" width="14" height="16" rx="3"/><path d="M13 11H1m12 8H1m26-8h12M27 19h12M17 7V1m6 6V1m-6 22v6m6-6v6"/></g></svg>';
  const contactless = '<svg class="card-contactless" viewBox="0 0 24 30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 12a6 6 0 0 1 0 6m4-10a12 12 0 0 1 0 14m4-18a18 18 0 0 1 0 22"/></svg>';

  function networkMark(network) {
    const value = String(network || '');
    if (/^mastercard$/i.test(value)) return '<span class="card-network card-network-mastercard" aria-label="Mastercard"><i></i><i></i><span>mastercard</span></span>';
    if (/american express|amex/i.test(value)) return '<span class="card-network card-network-amex" aria-label="American Express">AMERICAN<br>EXPRESS</span>';
    return `<span class="card-network ${/^visa$/i.test(value)?'card-network-visa':/^discover$/i.test(value)?'card-network-discover':'card-network-other'}">${esc(value)}</span>`;
  }

  function art(card = {}, product, {interactive = false} = {}) {
    const identity = product?.id || card.productId;
    const skin = skins.has(identity) ? identity : 'neutral';
    const name = product?.name || card.name || card.nickname || 'Your card';
    const shortName = product?.shortName || name;
    const tag = interactive ? 'button' : 'div';
    const attributes = interactive ? ` type="button" data-action="card-detail" data-id="${esc(card.id)}" aria-label="${esc(name)} — view rewards and details"` : ` role="img" aria-label="Illustration of ${esc(name)}"`;
    return `<${tag} class="bank-card wallet-card-art card-skin-${skin}" data-card-product="${esc(identity || 'unknown')}"${attributes}>
      <span class="card-art-lines" aria-hidden="true"></span>
      <span class="product-card-top"><span class="card-issuer">${esc(product?.issuer || 'PerkPilot wallet')}</span><span class="card-illustration-label">ILLUSTRATION</span></span>
      <span class="product-card-title">${esc(shortName)}</span>
      <span class="product-card-hardware">${chip}${contactless}</span>
      <span class="product-card-bottom"><span class="card-holder-label">${card.last4 && identity!=='apple-card'?`•••• ${esc(card.last4)}`:'REWARDS WALLET'}</span>${networkMark(product?.network || card.network)}</span>
    </${tag}>`;
  }

  function highlights(product) {
    const entries = Array.isArray(product?.rewardHighlights) ? product.rewardHighlights : [];
    return entries.length ? `<dl class="card-reward-highlights">${entries.map(entry => `<div><dt><strong>${esc(entry.rate)}</strong><span>${esc(entry.label)}</span></dt><dd>${esc(entry.detail || 'Issuer terms apply.')}</dd></div>`).join('')}</dl>` : '<p class="fine-note">Published reward details are unavailable for this card product.</p>';
  }

  function source(product, {full = true} = {}) {
    if (!product) return '<p class="card-source">No supported reward rule is available for this card.</p>';
    let url = '';
    try { const candidate = new URL(product.sourceUrl); if(candidate.protocol === 'https:') url = candidate.href; } catch {}
    return `<div class="card-source">${full?`<p>${esc(product.limitations || 'Issuer eligibility and merchant coding determine category bonuses.')}</p>`:''}<p class="card-source-link">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Issuer reward details <span aria-hidden="true">↗</span></a>`:''}${product.checkedAt?`<span>Checked ${esc(product.checkedAt)}</span>`:''}</p></div>`;
  }

  function comparison(product) {
    const categories = Object.entries(product?.categoryRewards || {});
    const detail = categories.length ? `Supported category rates: ${categories.map(([label, bps]) => `${Number(bps) / 100}% ${label.replace(/_/g,' ')}`).join('; ')}. Applied only when a supported purchase category matches.` : 'The comparison uses the base rate; conditional bonuses are not automatically applied.';
    return `<div class="card-comparison"><span class="card-comparison-rate"><strong>${baseRate(product)}</strong><span>Comparison base rate</span></span><p>${product?.comparisonNote?`${esc(product.comparisonNote)} `:''}${esc(detail)} Activation, spending caps, payment or redemption requirements, memberships, and promotional offers are not inferred.</p></div>`;
  }

  function rewardDetails(product) {
    return `<div class="card-reward-details"><div class="card-reward-heading"><h3>Published cash back</h3><span class="card-fee">${esc(annualFee(product))}</span></div>${product?.rewardSummary?`<p class="card-reward-summary">${esc(product.rewardSummary)}</p>`:''}${highlights(product)}${comparison(product)}<details class="card-terms"><summary>Reward conditions &amp; issuer source</summary>${source(product)}</details></div>`;
  }

  function rewardRow(card, product) {
    const entries = (Array.isArray(product?.rewardHighlights) ? product.rewardHighlights : []).slice(0, 3);
    return `<button class="list-row product-reward-row" data-action="card-detail" data-id="${esc(card.id)}"><span class="grow"><strong>${esc(product?.name || card.name)}</strong><span class="product-reward-summary">${esc(product?.rewardSummary || 'Select a supported card product to see its reward rules.')}</span><span class="product-reward-tags">${entries.map(entry => `<span><b>${esc(entry.rate)}</b> ${esc(entry.label)}</span>`).join('')}</span><span class="product-reward-fee">${esc(annualFee(product))} · Bonus conditions apply</span></span><span class="product-reward-base"><b>${baseRate(product)}</b><small>Comparison<br>base</small></span></button>`;
  }

  function pickerOptions(products) {
    const groups = new Map();
    products.forEach(product => {
      const issuer = product.issuer || 'Card products';
      if (!groups.has(issuer)) groups.set(issuer, []);
      groups.get(issuer).push(product);
    });
    return [...groups].map(([issuer, entries]) => `<optgroup label="${esc(issuer)}">${entries.map(product => `<option value="${esc(product.id)}">${esc(product.name)}</option>`).join('')}</optgroup>`).join('');
  }

  function preview(product) {
    return product ? `<div class="card-picker-art">${art({},product)}</div>${rewardDetails(product)}` : '<p class="fine-note">No card products are available. Try reloading your wallet.</p>';
  }

  function change(event) {
    if (!event.target.matches?.('#add-card-form [name="productId"]')) return;
    const target = event.target.form?.querySelector('[data-card-preview]');
    const product = (window.App?.state?.data?.cardProducts || []).find(item => item.id === event.target.value);
    if (target) target.innerHTML = preview(product);
  }

  window.CardsUI = {art, highlights, source, comparison, rewardDetails, rewardRow, pickerOptions, preview, change};
})();
