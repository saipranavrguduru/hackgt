// Isolated Explore-to-checkout regression. PostgreSQL, catalog, Stripe, and
// Gemini transports use fixtures; this is not real provider acceptance evidence.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {newDb} from 'pg-mem';
import {createDatabase} from '../src/connected-db.js';
import {createCheckoutAgent} from '../src/checkout-agent.js';
import {startCheckoutApplication} from './start-checkout.js';
import {checkoutFixture} from '../tests/helpers/checkout-fixture.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const port=Number(process.env.EXPLORE_BROWSER_TEST_PORT||3316),origin=`http://localhost:${port}`;
const {Pool}=newDb().adapters.createPg(),db=createDatabase(null,new Pool());
const fixture=await checkoutFixture();
fixture.provider.verifyAccount=async()=>({id:fixture.provider.accountId,mode:'test'});
const listing=(id,name,priceCents)=>({id,name,priceCents,currency:'USD',merchantName:'Browser Fixture Retailer',source:'Isolated browser catalog',url:`https://example.test/products/${id}`,imageUrl:`${origin}/explore-fixture/${id}.svg`,priceNote:'Observed browser fixture price',observedAt:new Date().toISOString()});
const products=[listing('travel-headphones','Explore travel headphones',12999),listing('running-shoes','Explore running shoes',4950),listing('over-limit','Explore premium telescope',60000)];
let app,browser,modelCalls=0;
const requests=[],recommendationRequests=[],pageErrors=[];
try {
  app=await startCheckoutApplication({port,storePort:port+1,demoOptions:{persist:false},connectedOptions:{db,
    plaid:{configured:false},ebay:{configured:false},shopify:{configured:false},
    serpapi:{configured:true,search:async()=>({source:'Isolated browser catalog',observedAt:new Date().toISOString(),products})},
    ai:{configured:true,model:'browser-fixture',ask:async()=>({answer:'Compare the listed products.',source:'Browser fixture',model:'browser-fixture'})}},
    checkoutOptions:{pool:fixture.pool,provider:fixture.provider,now:fixture.now,config:{enabled:true,origin,repository:fixture.repository,merchant:fixture.merchant},agentFactory:options=>createCheckoutAgent({...options,apiKey:'fixture-model-key',model:'fixture-tool-calling',fetchImpl:async(_url,init)=>{
      modelCalls++;const history=JSON.parse(init.body).input,last=history.at(-1);let name='read_cart',args={};
      if(last.type==='function_result'&&last.name==='read_cart')name='rank_cards';
      if(last.type==='function_result'&&last.name==='rank_cards'){const quote=JSON.parse(last.result[0].text);name='execute_purchase';args={quoteId:quote.id,cardId:quote.rankedCards[0].cardId};}
      return {ok:true,json:async()=>({steps:[{type:'function_call',id:randomUUID(),name,arguments:args}]})};
    }})}});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addInitScript(()=>{
    window.Stripe=()=>({elements:()=>({create:()=>({mount:node=>{node.innerHTML='<p role="note">Stripe test field fixture</p>';},destroy:()=>{}})}),confirmSetup:async()=>({setupIntent:{status:'succeeded'}}),handleNextAction:async()=>({paymentIntent:{status:'succeeded'}})});
  });
  await context.route('**/explore-fixture/*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#edf1e8"/><circle cx="200" cy="150" r="70" fill="#6d795c"/></svg>'}));
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/v1/agent-checkout/'))requests.push({path,method:request.method(),...(request.method()==='POST'?{body:request.postDataJSON()}:{})});if(path==='/api/v1/location/recommendations'&&request.method()==='POST')recommendationRequests.push(request.postDataJSON());});
  const sheet=page.locator('#sheet[data-owner="explore-checkout"]'),checkout=sheet.locator('[data-explore-checkout]'),recommendation=sheet.locator('[data-explore-recommendation]');
  const screenshot=async name=>{mkdirSync('test-results/explore-checkout-browser',{recursive:true});await page.screenshot({path:`test-results/explore-checkout-browser/${name}.png`,fullPage:false});};
  const api=async(path,body,method='POST')=>{const response=await context.request.fetch(origin+'/api/v1'+path,{method,headers:{Origin:origin},...(body===undefined?{}:{data:body})});const value=await response.json();assert.equal(response.ok(),true,JSON.stringify(value));return value;};
  const closeProduct=async()=>{await sheet.locator('[data-action="close"]').click();await page.locator('#sheet[open]').waitFor({state:'hidden'});};
  const openProduct=async(id,target='image')=>{
    const selector=target==='image'?'.connected-product-open':target==='title'?'.connected-product-title':'.product-actions .button';
    await page.locator(`${selector}[data-action="connected-product"][data-id="${id}"]`).click();await sheet.waitFor();
    if(id!=='over-limit')await checkout.locator('[data-checkout-selected-product]').waitFor();
  };
  const assertFit=async()=>{
    const fit=await page.evaluate(()=>{const sheet=document.querySelector('#sheet'),box=sheet.getBoundingClientRect();return {page:document.documentElement.scrollWidth<=innerWidth+1,dialog:sheet.scrollWidth<=sheet.clientWidth+1,bounds:box.left>=-1&&box.right<=innerWidth+1};});
    assert.deepEqual(fit,{page:true,dialog:true,bounds:true});
  };
  const preview=async(name,total)=>{
    const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/agent-checkout/previews'&&response.request().method()==='POST');
    await checkout.locator('[data-checkout-action="preview"]:not([disabled])').click();const value=await (await response).json();
    assert.equal(value.cart.name,name);assert.equal(value.cart.totalCents,total);assert.match(value.cart.sku,/^explore-/);assert.equal(value.cart.variantId,'sandbox');
    await checkout.locator('[name="maximum"]').waitFor();assert.equal(await checkout.locator('[name="maximum"]').inputValue(),(total/100).toFixed(2));
    assert.equal(await checkout.locator('[name="sku"]').count(),0,'A selected Explore item must not offer an unrelated SKU selector.');return value;
  };
  const enroll=async card=>{
    await checkout.locator('[name="walletCardId"]').selectOption(card.id);await checkout.locator('[name="consent"]').check();await checkout.locator('[data-checkout-action="enroll"]').click();
    await checkout.getByText('Stripe test field fixture').waitFor();await checkout.locator('[data-checkout-action="confirm-enrollment"]').click();
    await checkout.getByText('Stripe test field fixture').waitFor({state:'hidden'});await checkout.locator('[data-checkout-selected-product]').waitFor();
    assert.match(await checkout.locator('[data-checkout-selected-product]').innerText(),/Explore travel headphones/,'Enrolling a method must preserve the selected product dialog.');
  };
  const addAndEnroll=async productId=>{
    await checkout.locator('[data-action="add-card"]').click();await page.locator('#add-card-form').waitFor();
    await page.locator('#add-card-form [name="productId"]').selectOption(productId);await page.locator('#add-card-form [type="submit"]').click();
    await sheet.waitFor();await checkout.locator('[data-checkout-selected-product]').waitFor();
    assert.match(await checkout.locator('[data-checkout-selected-product]').innerText(),/Explore travel headphones/,'Adding a card must return to the same selected Explore product.');
    const state=await api('/bootstrap',undefined,'GET'),card=state.cards.find(card=>card.productId===productId);assert.ok(card);
    await recommendation.getByText(/Wells Fargo Active Cash/).first().waitFor();const advisory=await recommendation.innerText();
    assert.match(advisory,/2(?:\.0+)?%/);assert.match(advisory,/\$2\.60/,'Advisory cash back is based on the $129.99 merchandise price.');
    if(productId==='active-cash'){
      assert.equal(await checkout.locator('[data-checkout-action="remove-method"]').count(),0,'Wallet recommendations must work before Stripe enrollment.');
      await recommendation.scrollIntoViewIfNeeded();await screenshot('recommendation-desktop');
      await page.setViewportSize({width:390,height:844});await recommendation.scrollIntoViewIfNeeded();await assertFit();await screenshot('recommendation-mobile');await page.setViewportSize({width:1440,height:1000});
    }
    await enroll(card);return card;
  };

  await page.goto(origin);await page.locator('[data-action="auth-tab"][data-mode="register"]').click();
  await page.locator('#auth-form [name="name"]').fill('Explore checkout QA');await page.locator('#auth-form [name="email"]').fill(`explore-${randomUUID()}@example.test`);await page.locator('#auth-form [name="password"]').fill('explore-browser-test-password-2026');
  await page.locator('#auth-form [type="submit"]').click();await page.locator('.app-shell').waitFor();
  await page.goto(origin+'/#explore');await page.locator('#connected-search-form input').fill('travel gear');await page.locator('#connected-search-form button').click();
  await page.getByRole('heading',{name:'Explore travel headphones',exact:true}).waitFor();assert.equal(await page.locator('.connected-product').count(),3);
  await openProduct('over-limit','action');await sheet.getByRole('heading',{name:'Checkout unavailable',exact:true}).waitFor();assert.equal(await sheet.locator('[data-checkout-action="buy"]').count(),0);await screenshot('unavailable-desktop');await closeProduct();

  await openProduct('travel-headphones');assert.equal(await checkout.locator('[data-checkout-action="enroll"]').count(),0);assert.equal(await checkout.locator('[data-checkout-action="preview"]').isDisabled(),true);
  await recommendation.locator('[data-action="add-card"]').waitFor();
  assert.ok(recommendationRequests.some(request=>request.category==='other'&&request.amountCents===12999&&request.placeName==='Browser Fixture Retailer'),'Opening a listing must request an automatic advisory using its observed amount, retailer, and unknown merchant category.');
  await screenshot('empty-wallet-desktop');const activeCard=await addAndEnroll('active-cash'),otherCard=await addAndEnroll('quicksilver');
  const methods=await api('/agent-checkout/methods',undefined,'GET'),otherMethod=methods.find(method=>method.cardId===otherCard.id);assert.ok(otherMethod);
  await checkout.locator(`[data-checkout-action="remove-method"][data-id="${otherMethod.id}"]`).click();
  await checkout.locator('[name="walletCardId"] option').filter({hasText:'Quicksilver'}).waitFor({state:'attached'});
  assert.match(await checkout.locator('[data-checkout-selected-product]').innerText(),/Explore travel headphones/,'Removing an enrolled method must preserve the selected product dialog.');await enroll(otherCard);

  await closeProduct();await page.locator('.nav-list a[href="#wallet"]').click();const walletCheckout=page.locator('#checkout-root');await walletCheckout.locator('[data-checkout-action="preview"]:not([disabled])').waitFor();
  for(const selector of ['[data-action="account"]','[data-action="card-detail"]']){
    await page.locator(selector).first().click();await page.locator('#sheet[open]').waitFor();await page.locator('#sheet [data-action="close"]').click();
    assert.equal(await walletCheckout.locator('[data-checkout-action="preview"]').isEnabled(),true,'Closing an unrelated dialog must not dispose Wallet checkout.');
  }
  await page.locator('.nav-list a[href="#explore"]').click();await openProduct('travel-headphones');
  // A completed wallet mutation must not reopen the old product after the user
  // closes its form and opens another product while the response is in flight.
  const currentState=await api('/bootstrap',undefined,'GET'),extraProduct=currentState.cardProducts.find(product=>product.id==='savor');assert.ok(extraProduct);assert.equal(currentState.cards.some(card=>card.productId==='savor'),false);
  let releaseAdd,addFetched;const addGate=new Promise(resolve=>{releaseAdd=resolve;}),fetched=new Promise(resolve=>{addFetched=resolve;});
  const delayAdd=async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();addFetched();await addGate;await route.fulfill({response});};
  await page.route('**/api/v1/finance/cards',delayAdd);
  try{
    await checkout.locator('[data-action="add-card"]').click();await page.locator('#add-card-form [name="productId"]').selectOption(extraProduct.id);await page.locator('#add-card-form [type="submit"]').click();await fetched;
    await page.locator('#sheet [data-action="close"]').click();await openProduct('running-shoes');
    const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/bootstrap');releaseAdd();await refreshed;
    await page.waitForFunction(()=>window.App.state.data.cards.length===3);await page.waitForTimeout(250);
    assert.match(await checkout.locator('[data-checkout-selected-product]').innerText(),/Explore running shoes/,'A delayed add-card response must not replace the newer selected product.');
  }finally{releaseAdd();await page.unroute('**/api/v1/finance/cards',delayAdd);}
  await closeProduct();await openProduct('travel-headphones');
  await recommendation.getByText(/Wells Fargo Active Cash/).first().waitFor();
  const conditionalResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/location/recommendations'&&response.request().postDataJSON()?.category==='dining');
  await sheet.locator('#connected-product-recommendation-form [name="category"]').selectOption('dining');await sheet.locator('#connected-product-recommendation-form [type="submit"]').click();
  const conditional=await (await conditionalResponse).json(),conditionalBest=conditional.cards.find(card=>card.cardId===conditional.bestCardId);
  assert.equal(conditionalBest.cardName,'Capital One Savor');assert.equal(conditionalBest.rewardBps,300);assert.equal(conditionalBest.rewardCents,390);
  await recommendation.getByText(/Capital One Savor/).first().waitFor();const conditionalText=await recommendation.innerText();assert.match(conditionalText,/3(?:\.0+)?%/);assert.match(conditionalText,/\$3\.90/);assert.match(conditionalText,/if.*(?:coded|dining)|conditional/i,'A chosen merchant category must remain an explicitly conditional estimate.');
  await recommendation.scrollIntoViewIfNeeded();await screenshot('recommendation-conditional-desktop');await page.setViewportSize({width:390,height:844});await recommendation.scrollIntoViewIfNeeded();await assertFit();await screenshot('recommendation-conditional-mobile');await page.setViewportSize({width:1440,height:1000});
  assert.equal(fixture.provider.calls.length,0,'Search, open, wallet setup, and enrollment must not submit a payment.');
  const previewA=await preview('Explore travel headphones',14799);assert.equal(await checkout.locator('.checkout-card-set li').count(),1,'The highlighted best card is separate from the other enrolled card.');assert.equal(fixture.provider.calls.length,0);
  const checkoutBest=checkout.locator('[data-checkout-best-card]');await checkoutBest.waitFor();const bestText=await checkoutBest.innerText();assert.match(bestText,/Wells Fargo Active Cash/);assert.match(bestText,/2(?:\.0+)?%/);assert.match(bestText,/\$2\.96/);assert.doesNotMatch(bestText,/Capital One Savor/,'Checkout compares enrolled methods at their actual base rates, independently from the advisory category.');
  await assertFit();await checkout.locator('.checkout-permission').scrollIntoViewIfNeeded();await screenshot('permission-desktop');
  await page.setViewportSize({width:390,height:844});await assertFit();await checkout.locator('[data-checkout-form="buy"]').scrollIntoViewIfNeeded();await screenshot('permission-mobile');await page.setViewportSize({width:1440,height:1000});
  await checkout.locator('[data-checkout-action="buy"]').click();await checkout.locator('[data-checkout-receipt]').waitFor();
  await page.waitForFunction(()=>window.App.state.data.savings.checkoutCashbackCents===296);
  assert.equal(fixture.provider.calls.length,1);assert.equal(fixture.provider.calls[0].amountCents,14799);assert.equal(modelCalls,3);
  const state=await api('/bootstrap',undefined,'GET'),principal='portal:'+state.user.id;
  const savedMethod=(await fixture.repository.query('SELECT payment_method_id FROM pp_checkout_methods WHERE subject_key=$1 AND card_id=$2',[principal,activeCard.id])).rows[0];
  assert.equal(fixture.provider.calls[0].paymentMethodId,savedMethod.payment_method_id);assert.match(await checkout.locator('[data-checkout-receipt]').innerText(),/Explore travel headphones/);await checkout.locator('[data-checkout-receipt]').scrollIntoViewIfNeeded();await screenshot('receipt-desktop');
  await closeProduct();await openProduct('travel-headphones','title');await checkout.locator('[data-checkout-receipt]').waitFor();assert.equal(fixture.provider.calls.length,1,'Reopening a confirmed product must not dispatch another payment.');await closeProduct();

  await openProduct('running-shoes','action');assert.match(await checkout.locator('[data-checkout-selected-product]').innerText(),/Explore running shoes/);assert.equal(await checkout.locator('[data-checkout-receipt]').count(),0,'Product B must never show Product A’s receipt.');
  const previewB=await preview('Explore running shoes',5945);assert.notEqual(previewA.cart.sku,previewB.cart.sku);assert.equal(fixture.provider.calls.length,1);
  fixture.provider.status='processing';await checkout.locator('[data-checkout-action="buy"]').click();await checkout.getByRole('heading',{name:'Processing test payment',exact:true}).waitFor();assert.equal(fixture.provider.calls.length,2);assert.equal(fixture.provider.calls[1].amountCents,5945);
  await closeProduct();await openProduct('travel-headphones','action');await checkout.getByRole('heading',{name:'Previous purchase · Processing test payment',exact:true}).waitFor();
  assert.match(await checkout.locator('.checkout-progress').innerText(),/Explore running shoes/);assert.equal(await checkout.locator('[data-checkout-action="preview"]').isDisabled(),true);assert.equal(await checkout.locator('[data-checkout-action="buy"]').count(),0);assert.equal(await checkout.locator('[data-checkout-receipt]').count(),0);assert.equal(fixture.provider.calls.length,2);
  await checkout.locator('.checkout-progress').scrollIntoViewIfNeeded();await screenshot('previous-purchase-desktop');await page.setViewportSize({width:390,height:844});await assertFit();await checkout.locator('.checkout-progress').scrollIntoViewIfNeeded();await screenshot('previous-purchase-mobile');
  const imports=requests.filter(request=>request.path.endsWith('/catalog-products')&&request.method==='POST');assert.ok(imports.length>=4);for(const request of imports)assert.deepEqual(Object.keys(request.body),['checkoutReference']);
  const approvals=requests.filter(request=>request.path.endsWith('/intents')&&request.method==='POST');assert.equal(approvals.length,2);for(const request of approvals)assert.deepEqual(Object.keys(request.body).sort(),['approved','maxAmountCents','previewId']);
  await closeProduct();await page.setViewportSize({width:1440,height:1000});await page.locator('.nav-list a[href="#saved"]').click();
  await page.locator('.metric-value').waitFor();assert.equal(await page.locator('.metric-value').innerText(),'$2.96','Completed order cashback counts; pending purchases do not.');
  assert.equal(await page.locator('.savings-purchase').count(),1);assert.match(await page.locator('.savings-purchase').innerText(),/Explore travel headphones/);await screenshot('savings-checkout-desktop');
  await page.reload();await page.locator('.metric-value').waitFor();assert.equal(await page.locator('.metric-value').innerText(),'$2.96','Reload must neither lose nor duplicate purchase cashback.');
  await page.locator('.nav-list a[href="#for-you"]').click();assert.match(await page.locator('.saved-quiet').innerText(),/\$2\.96/);
  await page.locator('[data-action="location-open"]').first().click();await page.locator('#location-form [name="category"]').selectOption('dining');await page.locator('#location-form [name="placeName"]').fill('Cafe fixture');await page.locator('#location-form [name="amount"]').fill('100');await page.locator('#location-form [type="submit"]').click();
  await page.locator('[data-action="location-track-purchase"]').waitFor();assert.equal((await api('/rewards/summary',undefined,'GET')).trackedTotalCents,296,'Merely comparing cards must not add savings.');
  await page.locator('[data-action="location-track-purchase"]').click();await page.waitForFunction(()=>window.App.state.data.savings.trackedTotalCents===596);assert.equal(await page.locator('[data-action="location-track-purchase"]').isDisabled(),true);await screenshot('savings-manual-purchase');
  await page.locator('#sheet [data-action="close"]').click();await page.locator('.nav-list a[href="#saved"]').click();assert.equal(await page.locator('.metric-value').innerText(),'$5.96');assert.equal(await page.locator('.savings-purchase').count(),2);assert.match(await page.locator('.savings-history').innerText(),/Cafe fixture/);await screenshot('savings-combined-desktop');
  await page.setViewportSize({width:390,height:844});await assertFit();await screenshot('savings-combined-mobile');
  await page.locator('[data-action="remove-card-purchase"]').click();await page.waitForFunction(()=>window.App.state.data.savings.trackedTotalCents===296);assert.equal(await page.locator('.metric-value').innerText(),'$2.96');assert.equal(await page.locator('.savings-purchase').count(),1);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: completed checkout cashback updates Saved automatically; pending payment excluded; reload deduplicates; manual I bought this adds canonical cashback once; Remove tracking corrects the total; desktop/mobile savings views.');
  console.log('PASS: registered Explore search; automatic wallet advice before enrollment; recommendation refresh after wallet creation; conditional Savor dining rewards; enrolled Active Cash checkout highlight and receipt; image/title/action product opening; unavailable price; wallet creation/enrollment/removal preserve selected product; unrelated Wallet dialogs preserve checkout; delayed wallet response preserves newer product; exact product/total preview; explicit approval; reopen without duplicate payment; another pending product blocks checkout with correct identity; desktop and 390px layouts. All provider/catalog/model transports are isolated fixtures.');
} catch(error) {
  if(browser){mkdirSync('test-results/explore-checkout-browser',{recursive:true});const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({path:'test-results/explore-checkout-browser/failure.png',fullPage:true}).catch(()=>{});}
  throw error;
} finally {
  await browser?.close();if(app)await app.close();else await db.close();await fixture.close();
}
