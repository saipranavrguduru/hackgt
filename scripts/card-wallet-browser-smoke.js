// Real local browser coverage for published card products and wallet onboarding.
// The application state is isolated in memory; no financial providers are called.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createApplication } from '../src/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const port = Number(process.env.CARD_WALLET_BROWSER_TEST_PORT || 3314);
const origin = `http://localhost:${port}`;
const app = createApplication({ persist: false, mode: 'demo', port, storePort: port + 1, origin });
let browser;

try {
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], providerRequests = [], walletWrites = [];
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/stripe\.com|plaid\.com|generativelanguage\.googleapis\.com/.test(request.url())) providerRequests.push(request.url());
    if (new URL(request.url()).pathname === '/api/v1/finance/cards' && request.method() === 'POST') walletWrites.push(request.postDataJSON());
  });
  const screenshot = async name => {
    mkdirSync('test-results/card-wallet-browser', { recursive: true });
    await page.screenshot({ path: `test-results/card-wallet-browser/${name}.png`, fullPage: !(await page.locator('#sheet[open]').count()) });
  };
  const mutation = (path, method) => page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method);
  const closeSheet = async () => {
    await page.locator('#sheet[open] [data-action="close"]').click();
    await page.locator('#sheet[open]').waitFor({ state: 'hidden' });
  };
  const freshCardSheet = async () => {
    assert.equal(await page.locator('#sheet[open]').evaluate(element => element.scrollTop), 0,
      'New card picker and card details must open at the beginning, even after a previous sheet was scrolled.');
    assert.equal(await page.locator('#sheet[open] .bank-card[data-card-product]').evaluate(element =>
      element.getBoundingClientRect().top >= document.querySelector('#sheet .sheet-header').getBoundingClientRect().bottom - 1), true,
    'The newly opened card artwork must not be hidden behind the sticky sheet header.');
  };
  const noOverflow = async () => {
    assert.equal(await page.evaluate(() => {
      const sheet = document.querySelector('#sheet[open]');
      return document.documentElement.scrollWidth <= innerWidth + 1 &&
        (!sheet || (sheet.scrollWidth <= sheet.clientWidth + 1 && sheet.getBoundingClientRect().right <= innerWidth + 1));
    }), true,
      'Card wallet and card sheets must fit the mobile viewport.');
  };

  await page.goto(origin);
  await page.locator('[data-action="auth-tab"][data-mode="register"]').click();
  await page.locator('#auth-form [name="name"]').fill('Card catalog browser');
  await page.locator('#auth-form [name="email"]').fill('card-catalog-browser@example.test');
  await page.locator('#auth-form [name="password"]').fill('card-catalog-browser-password-2026');
  await page.locator('#auth-form [type="submit"]').click();
  await page.locator('.app-shell').waitFor();
  await page.locator('.nav-list a[href="#wallet"]').click();
  await page.locator('#main-content [data-action="add-card"]').first().click();

  const selector = page.locator('#add-card-form select[name="productId"]');
  await selector.waitFor();
  assert.ok(await selector.locator('option').count() >= 20, 'Wallet should offer at least 20 actual card products.');
  assert.ok(await selector.locator('optgroup').count() >= 5, 'Card products should be grouped by issuer.');

  const cases = [
    { id: 'savor', name: 'Capital One Savor', rate: '3%', fee: '$0 annual fee', condition: /grocery|groceries/i, source: /capitalone\.com/ },
    { id: 'blue-cash-preferred', name: 'American Express Blue Cash Preferred', rate: '6%', fee: '$95 annual fee', condition: /6,000/, source: /americanexpress\.com/ },
    { id: 'active-cash', name: 'Wells Fargo Active Cash', rate: '2%', fee: '$0 annual fee', condition: /unlimited|eligible purchases/i, source: /wellsfargo\.com/ },
  ];
  const backgrounds = new Map();
  const walletCard = id => page.locator(`.wallet-stack .bank-card[data-card-product="${id}"]`);
  const inspectRewards = async (scope, card) => {
    assert.equal(await scope.locator('.card-fee').innerText(), card.fee);
    assert.match(await scope.locator('.card-reward-highlights').innerText(), new RegExp(card.rate));
    assert.match(await scope.locator('.card-reward-details').innerText(), card.condition);
    await scope.locator('details.card-terms > summary').click();
    const link = scope.locator('.card-source-link a');
    const url = new URL(await link.getAttribute('href'));
    assert.equal(url.protocol, 'https:');
    assert.match(url.hostname, card.source);
    assert.equal(await link.getAttribute('target'), '_blank');
  };
  const addSelected = async card => {
    const added = mutation('/finance/cards', 'POST');
    await page.locator('#add-card-form [type="submit"]').click();
    assert.equal((await added).status(), 201);
    await page.locator('#sheet[open]').waitFor({ state: 'hidden' });
    await walletCard(card.id).waitFor();
    assert.match(await walletCard(card.id).getAttribute('class'), new RegExp(`card-skin-${card.id}`));
    assert.match(await walletCard(card.id).getAttribute('aria-label'), new RegExp(card.name));
  };

  for (const [index, card] of cases.entries()) {
    if (index) await page.locator('#main-content [data-action="add-card"]').first().click();
    await freshCardSheet();
    const before = walletWrites.length;
    await selector.selectOption(card.id);
    const preview = page.locator('#card-product-preview');
    await preview.locator(`[data-card-product="${card.id}"]`).waitFor();
    assert.match(await preview.locator('.bank-card[data-card-product]').getAttribute('aria-label'), new RegExp(card.name));
    await inspectRewards(preview, card);
    assert.equal(walletWrites.length, before, 'Changing the card preview must not add a wallet card before submission.');
    if (card.id === 'blue-cash-preferred') await screenshot('preferred-picker-desktop');
    await addSelected(card);
    backgrounds.set(card.id, await walletCard(card.id).evaluate(element => getComputedStyle(element).backgroundImage));
    await walletCard(card.id).click();
    await freshCardSheet();
    const sheet = page.locator('#sheet[open]');
    assert.equal(await sheet.locator('#sheet-title').innerText(), card.name);
    await inspectRewards(sheet, card);
    if (card.id === 'blue-cash-preferred') await screenshot('preferred-details-desktop');
    await closeSheet();
  }
  assert.equal(new Set(backgrounds.values()).size, cases.length, 'Copper, blue, and Active Cash artwork must have distinct product-specific backgrounds.');
  await screenshot('wallet-desktop');

  // Simulate older copied wallet metadata only in this isolated in-memory app.
  // Product identity must resolve the current issuer-sourced catalog on reload.
  const stale = app.store.data.cards.find(card => card.productId === 'active-cash' && !['alex', 'taylor'].includes(card.userId));
  assert.ok(stale);
  Object.assign(stale, {
    name: 'STALE COPIED PRODUCT NAME', shortName: 'STALE COPIED PRODUCT NAME', issuer: 'Stale issuer',
    rewardBps: 9900, annualFeeCents: 9900, rewardSummary: 'STALE COPIED REWARD SUMMARY',
    sourceUrl: 'https://example.invalid/stale-wallet-metadata', limitations: 'STALE COPIED TERMS',
    rewardHighlights: [{ rate: '99%', label: 'STALE COPIED REWARD', detail: 'Stale copied terms' }],
  });
  await page.reload();
  await walletCard('active-cash').waitFor();
  assert.doesNotMatch(await page.locator('#main-content').innerText(), /STALE COPIED|Stale issuer|99%/);
  await walletCard('active-cash').click();
  assert.equal(await page.locator('#sheet-title').innerText(), 'Wells Fargo Active Cash');
  await inspectRewards(page.locator('#sheet[open]'), cases[2]);
  assert.doesNotMatch(await page.locator('#sheet[open]').innerText(), /STALE COPIED|99%/);
  await closeSheet();

  await walletCard('savor').click();
  const savorId = await page.locator('#sheet[open] [data-action="remove-card"]').getAttribute('data-id');
  const removed = mutation(`/finance/cards/${savorId}`, 'DELETE');
  await page.locator('#sheet[open] [data-action="remove-card"]').click();
  assert.equal((await removed).ok(), true);
  await walletCard('savor').waitFor({ state: 'hidden' });
  assert.equal(await walletCard('blue-cash-preferred').evaluate(element => getComputedStyle(element).backgroundImage), backgrounds.get('blue-cash-preferred'),
    'Removing a preceding card must not change the next card artwork.');
  await page.locator('#main-content [data-action="add-card"]').first().click();
  await selector.selectOption('savor');
  await addSelected(cases[0]);
  assert.equal(await walletCard('savor').evaluate(element => getComputedStyle(element).backgroundImage), backgrounds.get('savor'),
    'Re-adding a card in a different position must keep its own visual identity.');

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await screenshot('wallet-mobile');
  await walletCard('blue-cash-preferred').click();
  await freshCardSheet();
  await noOverflow();
  await screenshot('preferred-details-mobile');
  await closeSheet();
  await page.locator('#main-content [data-action="add-card"]').first().click();
  await freshCardSheet();
  await selector.selectOption('savor');
  await page.locator('#card-product-preview [data-card-product="savor"]').waitFor();
  await noOverflow();
  await screenshot('savor-picker-mobile');

  console.log('PASS: real registration; 20+ issuer-grouped card products; live Savor, Blue Cash Preferred, and Active Cash artwork/reward/fee/source previews; explicit wallet adds; detailed rewards and issuer links; canonical metadata after stale-wallet reload; remove/re-add identity stability; 390px mobile wallet and sheets. No financial providers called.');
  assert.deepEqual(errors, []);
  assert.deepEqual(providerRequests, [], 'Wallet comparisons must not contact financial providers.');
} finally {
  await browser?.close();
  await new Promise(resolve => app.server.listening ? app.server.close(resolve) : resolve());
}
