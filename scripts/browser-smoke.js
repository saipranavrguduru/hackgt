// Optional browser QA. Runtime app and npm test remain dependency-free.
// Supply PLAYWRIGHT_MODULE_PATH when Playwright is installed outside this project.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createApplication } from '../src/server.js';

const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const port=Number(process.env.BROWSER_TEST_PORT || 3300),storePort=port+1;
const testPosition={latitude:33.7756,longitude:-84.3963,accuracy:12};
const locationProviderCalls=[];
const locationFetch=async(url,options)=>{
  locationProviderCalls.push({url:String(url),method:options?.method});
  return new Response(JSON.stringify({elements:[
    {type:'node',id:91001,lat:33.77572,lon:-84.3963,tags:{name:'Atlas Kitchen',amenity:'restaurant',cuisine:'american'}},
    {type:'node',id:91002,lat:33.77608,lon:-84.3961,tags:{name:'Atlas Grocery',shop:'supermarket'}},
    {type:'node',id:91003,lat:33.77651,lon:-84.3964,tags:{name:'Atlas Fuel',amenity:'fuel'}},
  ]}),{status:200,headers:{'content-type':'application/json'}});
};
const app=createApplication({persist:false,port,storePort,locationFetch});
const merchant=app.createStoreServer();
const listen=(server,port)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const close=server=>new Promise(resolve=>server.close(resolve));
let browser;
try {
  await listen(app.server,port);await listen(merchant,storePort);
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',geolocation:testPosition,permissions:['geolocation']});
  const page=await context.newPage();const errors=[];
  const locationRequests=[];
  const observeLocationRequests=target=>target.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/v1/location/'))locationRequests.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});});
  observeLocationRequests(page);
  page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  const base=`http://localhost:${port}`;
  const screenshot=async name=>{mkdirSync('test-results/browser',{recursive:true});await page.screenshot({path:`test-results/browser/${name}.png`,fullPage:true});};
  const click=async selector=>{await page.locator(selector).first().click();};
  const responseFor=path=>page.waitForResponse(response=>response.url().includes('/api/v1/')&&response.url().includes(path)&&response.request().method()!=='GET');
  await page.goto(base);
  await page.locator('.auth-shell').waitFor();await screenshot('sign-in');
  await click('[data-action="demo-login"][data-user="alex"]');
  await page.locator('[data-action="publish"]').waitFor();await screenshot('for-you');
  await Promise.all([responseFor('/demo/offers/publish'),click('[data-action="publish"]')]);
  await page.goto(`${base}/?product=alo-jacket`);
  await page.locator('#sheet[open]').waitFor();
  await page.getByText('$101.92',{exact:true}).first().waitFor();
  await Promise.all([responseFor('/commerce/offers/alo-discover-credit/activate'),click('[data-action="activate"]')]);
  await page.getByText('$82.96',{exact:true}).first().waitFor();await screenshot('quote');
  await click('[data-action="checkout-review"]');
  await page.locator('#checkout-form').waitFor();
  await page.locator('[name="approved"]').check();
  await page.locator('#checkout-form [type="submit"]').click();
  await page.locator('[data-action="purchase-event"][data-type="settled"]').waitFor();
  for(const type of ['settled','qualified','credit_posted','reward_posted']) {
    await Promise.all([responseFor('/events'),click(`[data-action="purchase-event"][data-type="${type}"]`)]);
    await page.locator(`[data-action="purchase-event"][data-type="${type}"]:not([disabled])`).waitFor();
  }
  await click('[data-action="close"]');
  await page.goto(`${base}/#saved`);await page.getByText('$47.04',{exact:true}).first().waitFor();await screenshot('saved');
  console.log('PASS: discovery, activation, explicit checkout and $47.04 posted ledger');

  await page.goto(`${base}/#spend`);
  for(let i=0;i<2;i++) {
    await click('[data-action="merchant-evidence"][data-id="alo"]');
    await Promise.all([responseFor('/preferences'),click('[data-action="exclude-transaction"]')]);
  }
  const profile=await context.request.get(`${base}/api/v1/profile`);
  assert.equal((await profile.json()).preferences.excludedTransactions.length,2);
  if(await page.locator('#sheet[open]').count())await click('[data-action="close"]');
  await screenshot('spend-dna');
  console.log('PASS: consecutive transaction corrections remain excluded');

  await page.goto(`${base}/#explore`);
  await page.locator('#research-search [name="query"]').fill('Best noise cancelling headphones for long flights under $350');
  await page.locator('#research-search [type="submit"]').click();
  await page.locator('[data-compare-product]').first().waitFor();
  assert.ok(await page.locator('[data-compare-product]').count()>=3);
  await page.locator('[data-compare-product]').nth(0).check();
  await page.locator('[data-compare-product]').nth(1).check();
  await click('[data-action="compare-products"]');await page.locator('.comparison-table').waitFor();await screenshot('comparison');
  await click('[data-action="close"]');
  await click('[data-action="research-product"]');await page.getByText('Sources & freshness',{exact:true}).waitFor();
  await click('[data-action="watch-product"]');await page.locator('#research-watch [type="submit"]').click();
  await page.locator('#sheet:not([open])').waitFor({state:'attached'});
  const watches=await context.request.get(`${base}/api/v1/research/watches`);assert.equal((await watches.json()).length,1);
  console.log('PASS: product search, comparison, evidence and saved watch');

  const freedomResponse=await context.request.post(`${base}/api/v1/finance/cards`,{data:{productId:'freedom-unlimited'}});
  assert.equal(freedomResponse.status(),201);
  const freedomCard=await freedomResponse.json();
  await page.goto(`${base}/#wallet`);
  const openLocation=async()=>{await click('[data-action="location-open"]');await page.locator('#location-form').waitFor();};
  const submitLocation=async(category,amount='')=>{
    await page.locator('#location-form [name="category"]').selectOption(category);
    await page.locator('#location-form [name="amount"]').fill(amount);
    const [response]=await Promise.all([responseFor('/location/recommendations'),page.locator('#location-form [type="submit"]').click()]);
    assert.equal(response.status(),200);
    await page.locator('#location-results').waitFor();
    return response.json();
  };
  const assertLocationWinner=async(name,rate,reward)=>{
    const primary=page.locator('#location-results .location-card-result.primary');
    await primary.getByRole('heading',{name,exact:true}).waitFor();
    assert.equal(await primary.locator('.location-rate').innerText(),rate);
    if(reward===undefined)assert.equal(await page.locator('#location-results .location-reward').count(),0,'Blank amount must show rates only');
    else assert.equal(await primary.locator('.location-reward > strong').innerText(),reward);
  };
  const unopenedRequests=locationRequests.length;
  await openLocation();await page.waitForLoadState('networkidle');
  assert.equal(locationRequests.length,unopenedRequests,'Opening the sheet must not request location or recommendations');
  assert.equal(locationProviderCalls.length,0);
  let locationResult=await submitLocation('dining');
  assert.equal(locationResult.bestCardId,freedomCard.id);
  assert.equal(locationResult.amountCents,null);
  assert.ok(locationResult.cards.every(card=>card.rewardCents===null));
  await assertLocationWinner('Chase Freedom Unlimited','3%');
  assert.equal(locationRequests.at(-1).body.amountCents,undefined,'A blank amount must not be submitted as zero');
  locationResult=await submitLocation('dining','50');
  assert.equal(locationResult.cards.find(card=>card.cardId===freedomCard.id).rewardCents,150);
  await assertLocationWinner('Chase Freedom Unlimited','3%','$1.50');
  const beforeCategoryChange=locationRequests.length;
  await page.locator('#location-form [name="category"]').selectOption('groceries');
  assert.equal(await page.locator('#location-results').count(),0,'Editing the category must clear the previous recommendation');
  assert.equal(locationRequests.length,beforeCategoryChange,'Editing details does not silently submit a new recommendation');
  locationResult=await submitLocation('groceries');
  assert.equal(locationResult.bestCardId,'alex-active-cash');
  await assertLocationWinner('Wells Fargo Active Cash','2%');
  locationResult=await submitLocation('gas','50');
  assert.equal(locationResult.bestCardId,'alex-active-cash');
  await assertLocationWinner('Wells Fargo Active Cash','2%','$1.00');
  assert.equal(locationProviderCalls.length,0,'Manual comparisons must not contact the location provider');
  await screenshot('location-manual');
  console.log('PASS: manual Dining/Groceries/Gas, owned-card category rates, optional amount and stale-result clearing');

  await click('[data-action="close"]');await openLocation();
  const beforeNearbyRecommendations=locationRequests.filter(request=>request.path.endsWith('/recommendations')).length;
  const [nearbyResponse]=await Promise.all([responseFor('/location/nearby'),click('[data-action="location-locate"]')]);
  assert.equal(nearbyResponse.status(),200);
  await page.locator('[data-action="location-select-place"]').first().waitFor();
  assert.equal(await page.locator('[data-action="location-select-place"]').count(),3);
  assert.equal(await page.locator('[data-action="location-select-place"][aria-pressed="true"]').count(),0,'GPS must not choose a merchant automatically');
  assert.equal(await page.locator('#location-results').count(),0);
  assert.equal(locationRequests.filter(request=>request.path.endsWith('/recommendations')).length,beforeNearbyRecommendations);
  assert.equal(locationProviderCalls.length,1);
  assert.equal(locationProviderCalls[0].url,'https://overpass-api.de/api/interpreter');
  await page.locator('[data-action="location-select-place"]').filter({hasText:'Atlas Kitchen'}).click();
  assert.equal(await page.locator('#location-form [name="category"]').inputValue(),'dining');
  assert.equal(await page.locator('#location-form [name="placeName"]').inputValue(),'Atlas Kitchen');
  assert.equal(await page.locator('#location-results').count(),0,'Selecting a place still requires explicit comparison');
  assert.equal(locationRequests.filter(request=>request.path.endsWith('/recommendations')).length,beforeNearbyRecommendations);
  const [selectedResponse]=await Promise.all([responseFor('/location/recommendations'),page.locator('#location-form [type="submit"]').click()]);
  assert.equal((await selectedResponse.json()).placeName,'Atlas Kitchen');
  await assertLocationWinner('Chase Freedom Unlimited','3%');
  await screenshot('location-nearby');
  console.log('PASS: GPS lookup uses controlled map data and requires place selection plus explicit submit');

  await click('[data-action="close"]');await openLocation();
  await page.evaluate(()=>{
    window.__smokeOriginalGeolocation=navigator.geolocation;
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(_success,failure){failure({code:1,message:'Permission denied in controlled browser test'});}}});
  });
  const beforeDeniedCalls=locationProviderCalls.length;
  await click('[data-action="location-locate"]');
  await page.locator('#location-status').filter({hasText:'Location permission was not granted.'}).waitFor();
  assert.equal(locationProviderCalls.length,beforeDeniedCalls);
  await submitLocation('groceries');await assertLocationWinner('Wells Fargo Active Cash','2%');
  console.log('PASS: denied geolocation preserves the manual category fallback');

  await click('[data-action="close"]');await openLocation();
  await page.evaluate(()=>{
    window.__smokePendingGeolocation=[];
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,failure){window.__smokePendingGeolocation.push({success,failure});}}});
  });
  await click('[data-action="location-locate"]');
  await page.waitForFunction(()=>window.__smokePendingGeolocation.length===1);
  await click('[data-action="close"]');await openLocation();
  const beforeStaleRequests=locationRequests.length;
  await page.evaluate(position=>window.__smokePendingGeolocation[0].success({coords:position,timestamp:Date.now()}),testPosition);
  await page.waitForLoadState('networkidle');
  assert.equal(locationRequests.length,beforeStaleRequests,'A late location success from a closed sheet must not send a request');
  assert.equal(locationProviderCalls.length,beforeDeniedCalls);
  assert.equal(await page.locator('[data-action="location-select-place"]').count(),0);
  assert.equal(await page.locator('#location-results').count(),0);
  await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:window.__smokeOriginalGeolocation}));
  await page.setViewportSize({width:390,height:844});
  await submitLocation('dining','50');await assertLocationWinner('Chase Freedom Unlimited','3%','$1.50');
  assert.ok(await page.evaluate(()=>{const sheet=document.querySelector('#sheet');return sheet.scrollWidth<=sheet.clientWidth+1&&document.documentElement.scrollWidth<=window.innerWidth+1;}),'Location sheet must fit a 390px viewport');
  await screenshot('mobile-location');await click('[data-action="close"]');
  console.log('PASS: late GPS is ignored after close/reopen and the location sheet fits 390px');

  for(const route of ['for-you','spend','explore','wallet','saved']) {
    await page.setViewportSize({width:390,height:844});await page.goto(`${base}/#${route}`);
    await page.locator('.sidebar').waitFor({state:'attached'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`Mobile overflow on ${route}`);
    await screenshot(`mobile-${route}`);
  }
  console.log('PASS: five core screens fit a 390px viewport');

  const store=await context.newPage();store.setDefaultTimeout(12000);store.setDefaultNavigationTimeout(12000);
  store.on('pageerror',error=>errors.push(`Storefront: ${error.message}`));
  await store.goto(`http://localhost:${storePort}/store?product=alo-jacket`);
  await store.locator('#store-cart[data-cart-id]').waitFor();
  await store.locator('#nike-link').click();
  await store.locator('#store-cart[data-product-id="nike-pegasus"]').waitFor();
  assert.equal(new URL(store.url()).searchParams.get('product'),'nike-pegasus');
  assert.equal(await store.locator('#product-name').innerText(),'Nike Pegasus Running Shoes');
  assert.equal(await store.locator('#nike-link').getAttribute('aria-current'),'page');
  await store.screenshot({path:'test-results/browser/storefront-nike.png',fullPage:true});
  assert.equal(await store.locator('#shoe-art').isVisible(),true,'Nike merchant navigation must show the shoe artwork');
  assert.equal(await store.locator('#jacket-art').isVisible(),false,'Nike merchant navigation must hide the jacket artwork');
  await store.locator('#alo-link').click();
  await store.locator('#store-cart[data-product-id="alo-jacket"]').waitFor();
  assert.equal(new URL(store.url()).searchParams.get('product'),'alo-jacket');
  assert.equal(await store.locator('#product-name').innerText(),'Alo Running Jacket');
  assert.equal(await store.locator('#alo-link').getAttribute('aria-current'),'page');
  assert.equal(await store.locator('#jacket-art').isVisible(),true,'Alo merchant navigation must show the jacket artwork');
  assert.equal(await store.locator('#shoe-art').isVisible(),false,'Alo merchant navigation must hide the shoe artwork');
  console.log('PASS: storefront merchant links load the selected product and artwork');

  await store.locator('#research-link').click();
  await store.locator('#sheet[open]').waitFor();
  assert.equal(new URL(store.url()).origin,base);
  assert.equal(new URL(store.url()).searchParams.get('research'),'alo-jacket');
  await store.getByText('Sources & freshness',{exact:true}).waitFor();
  await store.locator('#sheet[open]').getByText('Alo Running Jacket',{exact:true}).waitFor();
  await store.goBack();
  await store.locator('#store-cart[data-product-id="alo-jacket"]').waitFor();
  console.log('PASS: storefront research link opens the selected product brief');

  const size=store.locator('#sizes').getByRole('button',{name:'S',exact:true});
  await size.click();
  await store.locator('#sizes button[aria-pressed="true"]').filter({hasText:/^S$/}).waitFor();
  assert.equal(await store.locator('#sizes button[aria-pressed="true"]').count(),1);
  assert.equal(await store.locator('#quantity').innerText(),'1');
  assert.equal(await store.locator('#decrease').isDisabled(),true);
  for(const [selector,quantity,total] of [['#increase','2','$208.00'],['#decrease','1','$104.00'],['#increase','2','$208.00']]) {
    const revision=await store.locator('#store-cart').getAttribute('data-cart-revision');
    await store.locator(selector).click();
    await store.waitForFunction(previous=>document.getElementById('store-cart').dataset.cartRevision!==previous,revision);
    assert.equal(await store.locator('#quantity').innerText(),quantity);
    assert.equal(await store.locator('#bag-quantity').innerText(),quantity);
    assert.equal(await store.locator('#charge-total').innerText(),total);
    assert.equal(await store.locator('#decrease').isDisabled(),quantity==='1');
    assert.equal(await size.getAttribute('aria-pressed'),'true');
  }
  await store.screenshot({path:'test-results/browser/storefront.png',fullPage:true});
  console.log('PASS: storefront size selection and quantity controls update the bag and totals');
  // Open through the real anchor while keeping the merchant tab alive to test a later cart change.
  const [checkoutPage]=await Promise.all([context.waitForEvent('page'),store.locator('#checkout-link').click({modifiers:[process.platform==='darwin'?'Meta':'Control']})]);
  checkoutPage.setDefaultTimeout(12000);checkoutPage.setDefaultNavigationTimeout(12000);
  checkoutPage.on('pageerror',error=>errors.push(`Storefront checkout: ${error.message}`));
  await checkoutPage.locator('#sheet[open]').waitFor();
  assert.equal(new URL(checkoutPage.url()).origin,base);
  assert.equal(new URL(checkoutPage.url()).searchParams.get('product'),'alo-jacket');
  await checkoutPage.getByText('$208.00',{exact:true}).first().waitFor();
  await checkoutPage.locator('[data-action="checkout-review"]').click();
  await checkoutPage.locator('#checkout-form').waitFor();
  console.log('PASS: storefront checkout link opens a quote for the current two-item cart');
  const nextRevision=await store.locator('#store-cart').getAttribute('data-cart-revision');
  await store.locator('#increase').click();
  await store.waitForFunction(previous=>document.getElementById('store-cart').dataset.cartRevision!==previous,nextRevision);
  await checkoutPage.locator('[name="approved"]').check();await checkoutPage.locator('#checkout-form [type="submit"]').click();
  await checkoutPage.getByText('Your merchant cart changed. Review a fresh quote before approving.',{exact:true}).waitFor();
  await checkoutPage.locator('[data-action="refresh-quote"]').click();
  await checkoutPage.getByText('$312.00',{exact:true}).first().waitFor();
  await checkoutPage.locator('[data-action="checkout-review"]').click();
  assert.equal(await checkoutPage.locator('[name="approved"]').isChecked(),false);
  console.log('PASS: merchant changes reject old approval and refresh requires review of the new $312 total');

  const emptyContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const registered=await emptyContext.request.post(`${base}/api/v1/auth/register`,{data:{name:'Location Browser Test',email:'location-browser@example.test',password:'location-browser-password-2026'}});
  assert.equal(registered.status(),201);
  const emptyPage=await emptyContext.newPage();emptyPage.setDefaultTimeout(12000);observeLocationRequests(emptyPage);
  emptyPage.on('pageerror',error=>errors.push(error.message));
  await emptyPage.goto(`${base}/#wallet`);
  await emptyPage.locator('[data-action="location-open"]').first().click();
  await emptyPage.locator('#location-form [name="category"]').selectOption('dining');
  await emptyPage.locator('#location-form [type="submit"]').click();
  await emptyPage.getByRole('heading',{name:'Your wallet needs a card first.',exact:true}).waitFor();
  assert.equal(await emptyPage.locator('.location-card-result').count(),0);
  assert.equal(await emptyPage.locator('[data-action="location-add-card"]').count(),1);
  await emptyContext.close();
  console.log('PASS: a new registered wallet shows an add-card path without invented recommendations');
  assert.deepEqual(errors,[],'Unexpected browser JavaScript errors');
  console.log('Browser smoke passed. Screenshots: test-results/browser/');
} finally {
  if(browser)await browser.close();
  await Promise.all([close(app.server),close(merchant)]);
}
