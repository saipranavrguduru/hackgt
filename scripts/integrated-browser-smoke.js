// Isolated browser regression for the registered Explore/Connected experience.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {newDb} from 'pg-mem';
import {createDatabase} from '../src/connected-db.js';
import {createIntegratedApplication} from '../src/integrated-server.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const {Pool}=newDb().adapters.createPg();const db=createDatabase(null,new Pool());
const port=Number(process.env.INTEGRATED_BROWSER_TEST_PORT || 3308),origin=`http://localhost:${port}`;
const app=createIntegratedApplication({port,storePort:port+1,demoOptions:{persist:false},connectedOptions:{db,
  plaid:{configured:false},ebay:{configured:false},shopify:{configured:false},
  serpapi:{configured:true,search:async()=>({source:'Browser fixture',observedAt:new Date().toISOString(),products:[{id:'fixture-headphones',name:'Browser fixture headphones',merchantName:'Fixture Shop',source:'Browser fixture',url:'https://example.com/headphones',priceCents:10400,priceNote:'Isolated browser test listing'}]})},
  ai:{configured:true,model:'browser-fixture',ask:async()=>({answer:'Compare comfort and total price.',source:'Browser fixture',model:'browser-fixture'})}}});
let browser;
try {
  await app.migrate();await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('[data-action="auth-tab"][data-mode="register"]').click();
  await page.locator('#auth-form [name="name"]').fill('Browser QA');await page.locator('#auth-form [name="email"]').fill('browser-qa@example.test');await page.locator('#auth-form [name="password"]').fill('browser-qa-password');
  await page.locator('#auth-form [type="submit"]').click();await page.locator('.app-shell').waitFor();
  await page.goto(origin+'/#connected');await page.getByRole('heading',{name:'Your bank connections.'}).waitFor();
  await page.getByRole('heading',{name:'Bank connection',exact:true}).waitFor();
  assert.equal(await page.locator('#connected-search-form').count(),0);
  assert.equal(await page.locator('#main-content').getByRole('button',{name:'Sign in',exact:true}).count(),0);
  mkdirSync('test-results/integrated-browser',{recursive:true});await page.screenshot({path:'test-results/integrated-browser/connected.png',fullPage:true});
  await page.goto(origin+'/#explore');await page.locator('#connected-search-form input').fill('headphones');await page.locator('#connected-search-form button').click();
  await page.getByRole('heading',{name:'Browser fixture headphones'}).waitFor();
  await page.locator('#connected-assistant-form input').fill('Compare these headphones');await page.locator('#connected-assistant-form button').click();await page.getByText('Compare comfort and total price.',{exact:false}).waitFor();
  await page.screenshot({path:'test-results/integrated-browser/explore.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/integrated-browser/explore-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);console.log('PASS registered portal sign-in, Connected without second login, Explore catalog and assistant, 390px layout');
} finally {await browser?.close();await new Promise(resolve=>app.server.listening?app.server.close(resolve):resolve());await app.close();}
