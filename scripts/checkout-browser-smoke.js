// Local browser integration only: real portal/checkout/agent dispatcher, injected
// pg-mem/Gemini transport/payment sandbox doubles. No network provider evidence.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../src/server.js';
import {createCheckoutRuntime} from '../src/checkout-runtime.js';
import {createCheckoutAgent} from '../src/checkout-agent.js';
import {checkoutFixture} from '../tests/helpers/checkout-fixture.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const port=Number(process.env.CHECKOUT_BROWSER_TEST_PORT||3304),origin=`http://localhost:${port}`;
const fixture=await checkoutFixture();fixture.provider.verifyAccount=async()=>({id:fixture.provider.accountId,mode:'test'});
const app=createApplication({persist:false,mode:'demo',port,storePort:port+1,origin});
let scenario=null,modelCalls=0,runtime,browser;
const modelFetch=async(_url,init)=>{
  modelCalls++;const input=JSON.parse(init.body).input,last=input.at(-1);let name='read_cart',args={};
  if(last.type==='function_result'&&last.name==='read_cart')name='rank_cards';
  if(last.type==='function_result'&&last.name==='rank_cards'){const quote=JSON.parse(last.result[0].text);name='execute_purchase';args={quoteId:quote.id,cardId:quote.rankedCards[0].cardId};}
  return {ok:true,json:async()=>({steps:[{type:'function_call',id:randomUUID(),name,arguments:args}]})};
};
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const close=server=>new Promise(resolve=>server.close(resolve));
try {
  runtime=await createCheckoutRuntime({auth:app.auth,store:app.store,pool:fixture.pool,provider:fixture.provider,now:fixture.now,config:{enabled:true,origin,repository:fixture.repository,merchant:fixture.merchant},agentFactory:options=>{
    const agent=createCheckoutAgent({...options,apiKey:'fixture-model-key',model:'fixture-function-calling',fetchImpl:modelFetch});
    return {...agent,run:async(context,options)=>{
      if(scenario){const row=(await fixture.repository.query('SELECT data FROM pp_checkout_intents WHERE id=$1',[context.intentId])).rows[0];await fixture.repository.query('UPDATE pp_checkout_intents SET data=$1 WHERE id=$2',[{...row.data,scenario},context.intentId]);scenario=null;}
      return agent.run(context,options);
    }};
  }});
  app.setCheckoutRuntime(runtime);await runtime.start();await listen(app.server);
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1360,height:1000},reducedMotion:'reduce'});
  await context.addInitScript(()=>{
    window.Stripe=()=>({elements:()=>({create:()=>({mount:node=>{node.innerHTML='<div role="note">Stripe test field fixture</div>';},destroy:()=>{}})}),confirmSetup:async()=>({setupIntent:{status:'succeeded'}}),handleNextAction:async()=>({paymentIntent:{status:'succeeded'}})});
  });
  const page=await context.newPage(),errors=[],intentPosts=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/agent-checkout/intents')intentPosts.push(request.postDataJSON());});
  const api=async(path,body,method='POST')=>{const response=await context.request.fetch(origin+'/api/v1'+path,{method,headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{data:body})});const value=await response.json();assert.equal(response.ok(),true,JSON.stringify(value));return value;};
  await page.goto(origin);const registered=await api('/auth/register',{name:'Checkout browser presenter',email:`checkout-${randomUUID()}@example.test`,password:'browser-test-password-2026'});
  const a=await api('/finance/cards',{productId:'active-cash'}),b=await api('/finance/cards',{productId:'quicksilver'});
  const state=await api('/bootstrap',undefined,'GET');const activeCard=state.cards.find(c=>c.productId==='active-cash'),otherCard=state.cards.find(c=>c.productId==='quicksilver');assert.ok(activeCard&&otherCard);void a;void b;void registered;
  await page.goto(origin+'/#checkout');await page.reload();await page.locator('[data-checkout-action="enroll"]:not([disabled])').waitFor();
  const enroll=async card=>{
    await page.locator('[name="walletCardId"]').selectOption(card.id);await page.locator('[name="consent"]').check();await page.locator('[data-checkout-action="enroll"]').click();
    await page.getByText('Stripe test field fixture').waitFor();await page.locator('[data-checkout-action="confirm-enrollment"]').click();await page.getByText('Stripe test field fixture').waitFor({state:'hidden'});
    await page.locator('[data-checkout-action="remove-method"]').filter({hasText:'Remove'}).last().waitFor();
  };
  await enroll(activeCard);await enroll(otherCard);
  const review=async()=>{await page.locator('[data-checkout-action="preview"]:not([disabled])').click();await page.locator('[name="maximum"]').waitFor();await page.locator('[name="maximum"]').fill('110.00');await page.getByRole('button',{name:'Buy with PerkPilot — up to $110.00'}).waitFor();};
  const screenshot=async name=>{mkdirSync('test-results/checkout-browser',{recursive:true});await page.screenshot({path:`test-results/checkout-browser/${name}.png`,fullPage:true});};
  await review();
  const bestCard=page.locator('[data-checkout-best-card]');assert.equal(await bestCard.count(),1);
  assert.match(await bestCard.innerText(),/Best enrolled card for this test purchase/i);
  assert.match(await bestCard.innerText(),/Active Cash/);
  assert.match(await bestCard.innerText(),/2% base reward/);
  assert.match(await bestCard.innerText(),/Estimated reward \$2\.08/);
  assert.equal(await page.locator('.checkout-card-set li').count(),1);
  assert.match(await page.locator('.checkout-card-set li').innerText(),/Quicksilver/);
  await screenshot('permission-desktop');
  await page.getByRole('button',{name:'Buy with PerkPilot — up to $110.00'}).click();await page.locator('[data-checkout-receipt]').waitFor();
  assert.equal(fixture.provider.calls.length,1);assert.equal(fixture.provider.calls[0].paymentMethodId,(await fixture.repository.query('SELECT payment_method_id FROM pp_checkout_methods WHERE subject_key=$1 AND card_id=$2',['portal:'+state.user.id,activeCard.id])).rows[0].payment_method_id);
  assert.equal(fixture.provider.calls[0].amountCents,10400);assert.equal(modelCalls,3);assert.equal(intentPosts.length,1);assert.deepEqual(Object.keys(intentPosts[0]).sort(),['approved','maxAmountCents','previewId']);await screenshot('receipt-desktop');
  await page.setViewportSize({width:390,height:844});await screenshot('receipt-mobile');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1360,height:1000});
  fixture.provider.status='processing';await review();await page.getByRole('button',{name:'Buy with PerkPilot — up to $110.00'}).click();await page.getByRole('heading',{name:'Processing test payment'}).waitFor();
  assert.equal(await page.locator('[data-checkout-receipt]').count(),0);const pending=await page.evaluate(()=>localStorage.getItem('perkpilot-checkout-intent'));assert.ok(pending);const paymentCount=fixture.provider.payments.size;
  // Removing the optional cache simulates navigation/lost-response recovery:
  // the server's owner-scoped intent listing must recover the same payment.
  await page.evaluate(()=>localStorage.removeItem('perkpilot-checkout-intent'));
  await page.reload();await page.getByRole('heading',{name:'Processing test payment'}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('perkpilot-checkout-intent')),pending);assert.equal(fixture.provider.payments.size,paymentCount);assert.equal(await page.locator('[data-checkout-receipt]').count(),0);await screenshot('pending-refreshed');
  for(const payment of fixture.provider.payments.values())payment.status='succeeded';fixture.advance(5001);await page.getByRole('button',{name:'Check payment status'}).click();await page.locator('[data-checkout-receipt]').waitFor();
  fixture.provider.status='succeeded';scenario='price-increase';await review();const before=fixture.provider.calls.length;await page.getByRole('button',{name:'Buy with PerkPilot — up to $110.00'}).click();await page.getByRole('heading',{name:'Purchase blocked'}).waitFor();assert.equal(fixture.provider.calls.length,before);assert.equal(await page.locator('[data-checkout-receipt]').count(),0);await screenshot('blocked-price');
  const blocked=await page.evaluate(()=>localStorage.getItem('perkpilot-checkout-intent'));assert.equal((await fixture.repository.query('SELECT state FROM pp_checkout_intents WHERE id=$1',[blocked])).rows[0].state,'blocked');
  await page.locator('[data-action="account"]').first().click();await page.locator('[data-action="logout"]').first().click();await page.locator('.auth-shell').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('perkpilot-checkout-intent')),null);assert.equal(await page.locator('[data-checkout-receipt]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: registered UI enrollment, one-click permission, actual Gemini-shaped tool dispatcher, best card, confirmed fixture receipt, pending reload, $140 refusal under $110 with zero dispatch, logout cleanup, mobile layout. Provider, model transport and bank UI are injected test doubles; no real sandbox verification.');
} finally {
  await browser?.close();await runtime?.close();if(app.server.listening)await close(app.server);await fixture.close();
}
