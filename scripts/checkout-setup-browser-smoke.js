// Exercise the ordinary integrated portal with checkout left unconfigured.
// The connected database is in memory; no payment/model providers are called.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {newDb} from 'pg-mem';
import {createDatabase} from '../src/connected-db.js';
import {createIntegratedApplication} from '../src/integrated-server.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const {Pool}=newDb().adapters.createPg();
const db=createDatabase(null,new Pool());
const port=Number(process.env.CHECKOUT_SETUP_BROWSER_TEST_PORT||3310),origin=`http://localhost:${port}`;
const app=createIntegratedApplication({port,storePort:port+1,demoOptions:{persist:false},connectedOptions:{db}});
let browser;
try {
  await app.migrate();
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],checkoutRequests=[];
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/v1/agent-checkout/'))checkoutRequests.push({path,method:request.method()});});
  const checkout=page.locator('#checkout-root');
  const screenshot=async name=>{mkdirSync('test-results/checkout-setup-browser',{recursive:true});await page.screenshot({path:`test-results/checkout-setup-browser/${name}.png`,fullPage:true});};

  await page.goto(origin);
  await page.locator('[data-action="auth-tab"][data-mode="register"]').click();
  await page.locator('#auth-form [name="name"]').fill('Checkout setup browser');
  await page.locator('#auth-form [name="email"]').fill('checkout-setup-browser@example.test');
  await page.locator('#auth-form [name="password"]').fill('checkout-setup-password-2026');
  await page.locator('#auth-form [type="submit"]').click();
  await page.locator('.app-shell').waitFor();
  await page.locator('.nav-list a[href="#checkout"]').click();
  await checkout.locator('.checkout-readiness').filter({hasText:/not ready|setup|not configured/i}).waitFor();

  // Broken behavior: an unconfigured server exposes inert payment forms with
  // no setup/retry action. The ready payment journey has separate coverage.
  assert.equal(await checkout.locator('[data-checkout-form="enroll"], [data-checkout-form="preview"]').count(),0,'Unconfigured checkout must show actionable setup instead of disabled payment forms.');
  await checkout.locator('[data-checkout-action="setup-details"]').click();
  await checkout.locator('details[open]').waitFor();
  await checkout.locator('[data-checkout-setup]').waitFor({state:'visible'});
  assert.match(await checkout.locator('[data-checkout-setup]').innerText(),/dev:checkout/);
  const capabilities=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/agent-checkout/capabilities');
  await checkout.locator('[data-checkout-action="retry"]').click();
  assert.equal((await capabilities).ok(),true);
  await checkout.locator('[data-checkout-action="retry"]:not([disabled])').waitFor();
  assert.equal(checkoutRequests.some(request=>request.path.endsWith('/products')||request.path.endsWith('/methods')),false,'Unconfigured checkout must not request unavailable payment resources.');
  await screenshot('setup-desktop');

  // Onboarding stays usable even before provider setup, and the parent app's
  // delegated click/submit handlers must still work inside CheckoutUI's root.
  await checkout.locator('[data-action="add-card"]').click();
  await page.locator('#sheet[open] #add-card-form').waitFor();
  await page.locator('#add-card-form [name="productId"]').selectOption('active-cash');
  const added=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/finance/cards'&&response.request().method()==='POST');
  await page.locator('#add-card-form [type="submit"]').click();
  assert.equal((await added).ok(),true);
  await page.locator('#sheet[open]').waitFor({state:'hidden'});
  await checkout.locator('[data-checkout-action="retry"]:not([disabled])').waitFor();
  const state=await page.request.get(origin+'/api/v1/bootstrap');
  assert.equal(state.ok(),true);
  assert.equal((await state.json()).cards.some(card=>card.productId==='active-cash'),true,'Adding a reward product from Test Store must update the signed-in wallet.');
  await page.locator('.nav-list a[href="#wallet"]').click();
  await page.locator('.wallet-stack [data-action="card-detail"]').filter({hasText:'Active Cash'}).waitFor();
  await page.locator('.nav-list a[href="#checkout"]').click();
  await checkout.locator('[data-checkout-action="retry"]:not([disabled])').waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await screenshot('setup-mobile');
  assert.equal(checkoutRequests.some(request=>request.method!=='GET'),false,'Setup and wallet onboarding must not submit payment requests.');

  // The server-ready case uses only read-only resource responses. Actual wallet
  // registration and mutation still go through the integrated portal routes.
  await page.setViewportSize({width:1440,height:1000});
  const registered=await page.request.post(origin+'/api/v1/auth/register',{headers:{Origin:origin},data:{name:'Empty checkout wallet',email:'checkout-empty-wallet@example.test',password:'checkout-empty-password-2026'}});
  assert.equal(registered.ok(),true);
  let productsUnavailable=false;
  await page.route('**/api/v1/agent-checkout/**',async route=>{
    const resource=new URL(route.request().url()).pathname.split('/').at(-1);
    const resources={
      capabilities:{enabled:true,ready:true,publishableKey:'pk_test_browser_setup'},
      products:{products:[{sku:'everyday-headphones',variantId:'black',name:'Everyday Headphones',stock:100}],destinations:[{id:'test-destination',label:'Saved test destination'}]},
      methods:[],intents:[]
    };
    if(resource==='products'&&productsUnavailable)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'CATALOG_UNAVAILABLE',message:'Test catalog temporarily unavailable.'}})});
    if(Object.hasOwn(resources,resource))return route.fulfill({contentType:'application/json',body:JSON.stringify(resources[resource])});
    return route.abort();
  });
  await page.reload();
  await checkout.locator('.checkout-readiness').filter({hasText:/limits enforced/i}).waitFor();
  await checkout.locator('[data-action="add-card"]').click();
  await page.locator('#sheet[open] #add-card-form').waitFor();
  await page.locator('#add-card-form [name="productId"]').selectOption('quicksilver');
  await page.locator('#add-card-form [type="submit"]').click();
  await page.locator('#sheet[open]').waitFor({state:'hidden'});
  await checkout.locator('[data-checkout-action="enroll"]:not([disabled])').waitFor();
  assert.match(await checkout.locator('[name="walletCardId"] option').innerText(),/Quicksilver/);
  await screenshot('ready-wallet-onboarding');

  productsUnavailable=true;
  await page.reload();
  await checkout.getByText('Test catalog temporarily unavailable.',{exact:false}).waitFor();
  assert.equal(await checkout.locator('[data-checkout-action="preview"]:not([disabled])').count(),0,'Catalog failure must not permit a purchase review.');
  productsUnavailable=false;
  await checkout.locator('[data-checkout-action="retry"]').click();
  await checkout.locator('[name="sku"] option').filter({hasText:'Everyday Headphones'}).waitFor({state:'attached'});
  await checkout.getByText('Test catalog temporarily unavailable.',{exact:false}).waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS registered default checkout setup, setup details, status retry, wallet onboarding through actual clicks, navigation, mobile layout, ready empty-wallet onboarding, and visible catalog failure/retry. No payment provider was called. Ready catalog responses use browser fixtures.');
} finally {
  await browser?.close();
  await new Promise(resolve=>app.server.listening?app.server.close(resolve):resolve());
  await app.close();
}
