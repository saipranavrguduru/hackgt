(() => {
  'use strict';
  const app=()=>window.App;
  const total=s=>Number.isSafeInteger(s.trackedTotalCents)?s.trackedTotalCents:s.totalCents??0;
  const hasEstimates=s=>Number.isSafeInteger(s.estimatedCashbackCents)&&s.estimatedCashbackCents>0;
  function home(s={}) {
    return `<button class="saved-quiet" data-action="navigate" data-page="saved"><p>Saved this year</p><strong class="money">${app().money(total(s))}</strong><small>${hasEstimates(s)?'Includes estimated cashback':'Confirmed benefits only'}</small></button>`;
  }
  function summary(s={}) {
    const {money,escapeHtml}=app();
    return `<section class="metric-hero"><span class="eyebrow">Saved this year · ${escapeHtml(s.year||new Date().getFullYear())}</span><div class="metric-value money">${money(total(s))}</div><p>${hasEstimates(s)?'Including estimated cashback':'Confirmed benefits. Every cent has a story.'}</p><div class="leaf-art" aria-hidden="true"></div></section>
      <div class="grid-two savings-summary-breakdown" aria-label="Savings breakdown"><div class="savings-category"><p>Confirmed benefits</p><strong>${money(s.confirmedCents??s.totalCents??0)}</strong><small class="fine-note">Recorded discounts, credits and posted rewards.</small></div><div class="savings-category"><p>Estimated cashback</p><strong>${money(s.estimatedCashbackCents??0)}</strong><small class="fine-note">Tracked estimates, not posted rewards.</small></div></div>
      ${hasEstimates(s)?`<div class="savings-sources"><p class="fine-note">Sandbox checkout · ${money(s.checkoutCashbackCents??0)} &nbsp; Self-reported purchases · ${money(s.reportedCashbackCents??0)} &nbsp; Sample purchases · ${money(s.sampleCashbackCents??0)}</p></div>`:''}
      ${s.checkoutRewardsUnavailable?'<p class="info-note amber" role="status">Checkout cashback is temporarily unavailable. The total currently excludes those checkout estimates. Refresh to try again.</p>':''}`;
  }
  function history(s={}) {
    const {money,escapeHtml,shortDate}=app(),purchases=Array.isArray(s.rewardPurchases)?s.rewardPurchases:[];
    const labels={sandbox:'Sandbox purchase · no real money moved',self_reported:'Self-reported purchase · not verified',sample:'Sample purchase · synthetic'};
    return `<section class="surface section savings-history" aria-label="Tracked cashback purchases"><div class="section-heading"><div><h2>Your cashback purchases</h2><p>Estimated cashback is included in your total. These are not posted rewards.</p></div></div>${purchases.length?purchases.map(p=>`<article class="savings-purchase"><div class="savings-purchase-description"><strong>${escapeHtml(p.name||'Tracked purchase')}</strong><p>${escapeHtml(p.merchantName||'Merchant not recorded')} · ${shortDate(p.occurredAt)}</p><p>${escapeHtml(p.cardName||'Card not recorded')}</p><span class="pill neutral">${labels[p.kind]||'Tracked purchase · unverified'}</span>${p.kind==='self_reported'?`<button class="text-button savings-remove" data-action="remove-card-purchase" data-id="${escapeHtml(p.id)}">Remove tracking</button>`:''}</div><dl class="savings-purchase-values"><div><dt>Purchase amount</dt><dd>${money(p.amountCents)}</dd></div><div><dt>Estimated cashback</dt><dd>${money(p.rewardCents)}</dd></div></dl></article>`).join(''):'<p class="fine-note">No tracked cashback purchases yet. Complete a sandbox checkout or mark a card recommendation as bought to track its estimate.</p>'}</section>`;
  }
  window.SavingsUI={home,summary,history};
})();
