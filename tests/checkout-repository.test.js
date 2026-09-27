import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newDb } from 'pg-mem';
import { createCheckoutRepository } from '../src/checkout-repository.js';
import { createCheckoutMerchant } from '../src/checkout-merchant.js';

const principal = () => ({subjectKey:`portal:${randomUUID()}`,sessionDigest:'session-digest'});
async function fixture() {
  const memory = newDb(); const {Pool} = memory.adapters.createPg(); const pool = new Pool();
  let time = 100000;
  const repository = createCheckoutRepository({pool,now:()=>time});
  await repository.migrate();
  const merchant = createCheckoutMerchant({repository,now:()=>time,providerAccountId:'acct_test'});
  await merchant.seed();
  const alice=principal(),bob=principal();
  await repository.ensureSubject(alice); await repository.ensureSubject(bob);
  return {repository,merchant,alice,bob,memory,pool,tick:n=>{time+=n;}};
}
async function preview(f,who=f.alice) {
  const products = await f.merchant.listProducts(who);
  const snapshot = await f.merchant.previewCart(who,{sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:products.destinations[0].id});
  return f.repository.createPreview(who,{...snapshot,eligibleCardIds:['card-a','card-b']});
}
test('migration and seed are idempotent and create only checkout tables', async()=> {
  const f=await fixture(); await f.repository.migrate(); await f.merchant.seed();
  const tables=await f.repository.query('SELECT table_name FROM information_schema.tables');
  assert.equal(tables.rows.some(r=>r.table_name==='connected_users'),false);
  assert.equal((await f.repository.query('SELECT COUNT(*) AS count FROM pp_checkout_products')).rows[0].count,1);
  assert.equal((await f.repository.query('SELECT version FROM pp_checkout_schema_versions ORDER BY version DESC LIMIT 1')).rows[0].version,2);
  await f.pool.end();
});
test('merchant scope uses the configured provider account',async()=> {
  const memory=newDb();const {Pool}=memory.adapters.createPg();const pool=new Pool();
  const repository=createCheckoutRepository({pool,now:()=>100000});await repository.migrate();
  const merchant=createCheckoutMerchant({repository,providerAccountId:'acct_configured'});await merchant.seed();
  const p=principal();const listing=await merchant.listProducts(p);
  assert.equal(listing.products[0].providerAccountId,'acct_configured');
  await pool.end();
});
test('controlled merchant produces exact amount, quantity totals and owned fictitious destinations', async()=> {
  const f=await fixture(); const p=await preview(f);
  assert.equal(p.cart.totalCents,10400); assert.equal(p.cart.category,'other');
  const two=await f.merchant.previewCart(f.alice,{sku:p.cart.sku,variantId:'black',quantity:2,destinationId:p.destination.id});
  assert.equal(two.cart.totalCents,20300);
  await assert.rejects(f.merchant.previewCart(f.bob,{sku:p.cart.sku,variantId:'black',quantity:1,destinationId:p.destination.id}),{code:'NOT_FOUND'});
  await f.pool.end();
});
test('preview authorizes once with immutable parameters and owner-scoped lookup', async()=> {
  const f=await fixture(); const p=await preview(f);
  const a=await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000});
  const b=await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000});
  assert.equal(a.id,b.id); assert.equal(a.state,'queued'); assert.equal(a.expiresAt-a.createdAt,300000);
  assert.equal(a.permission.eligibleCardIds.length,2);
  await assert.rejects(f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:12000}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(f.repository.authorizePreview(f.bob,{previewId:p.id,maxAmountCents:11000}),{code:'NOT_FOUND'});
  await assert.rejects(f.repository.getIntent(f.bob,a.id),{code:'NOT_FOUND'});
  assert.equal((await f.repository.getIntent(f.alice,a.id)).id,a.id);
  assert.equal((await f.repository.query('SELECT COUNT(*) AS count FROM pp_checkout_jobs')).rows[0].count,1);
  await f.pool.end();
});
test('expired previews refuse new permission but an existing identical replay remains stable', async()=> {
  const f=await fixture(); const p=await preview(f); const original=await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000});
  f.tick(300000);
  assert.equal((await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000})).id,original.id);
  const p2=await preview(f); f.tick(300000);
  await assert.rejects(f.repository.authorizePreview(f.alice,{previewId:p2.id,maxAmountCents:11000}),{code:'PREVIEW_EXPIRED'});
  await f.pool.end();
});
test('run leases prevent a second worker until expiry and actions are persisted in order',async()=> {
  const f=await fixture(); const p=await preview(f); const a=await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000});
  assert.equal((await f.repository.claimRun(a.id,'worker-a')).state,'running');
  assert.equal(await f.repository.claimRun(a.id,'worker-b'),null);
  assert.equal(await f.repository.renewRun(a.id,'worker-b'),false);
  await f.repository.appendAction(a.id,{tool:'read_cart',code:'OK'});
  await f.repository.appendAction(a.id,{tool:'rank_cards',code:'OK'});
  assert.deepEqual((await f.repository.getIntent(f.alice,a.id)).events.map(e=>e.sequence),[1,2]);
  f.tick(60001); assert.equal((await f.repository.listRecoverable()).length,1);
  assert.equal((await f.repository.claimRun(a.id,'worker-b')).workerId,'worker-b');
  await f.pool.end();
});
test('run renewal persists job lease and action records omit untrusted secrets',async()=> {
  const f=await fixture();const p=await preview(f);const a=await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000});
  await f.repository.claimRun(a.id,'worker-a');f.tick(15000);assert.equal(await f.repository.renewRun(a.id,'worker-a'),true);
  const lease=(await f.repository.query('SELECT lease_until FROM pp_checkout_jobs WHERE intent_id=$1',[a.id])).rows[0].lease_until;
  assert.equal(Number(lease),175000);
  await f.repository.appendAction(a.id,{tool:'read_cart',code:'OK',clientSecret:'secret',description:'123 Secret Street',args:{rawCard:'1234'}});
  const event=(await f.repository.getIntent(f.alice,a.id)).events[0];
  assert.deepEqual(Object.keys(event).sort(),['code','createdAt','sequence','tool']);
  await f.pool.end();
});
test('stock reservation and finalization change stock once and seed preserves orders',async()=> {
  const f=await fixture(); const p=await preview(f); const a=await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000}); const id=randomUUID();
  await f.repository.query('INSERT INTO pp_checkout_orders(id,intent_id,subject_key,sku,variant_id,quantity,amount_cents,currency,card_id,state,reservation_state,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,a.id,f.alice.subjectKey,p.cart.sku,'black',1,10400,'USD','card-a','payment_pending','none',100000,{}]);
  await f.repository.transaction(async tx=>{await f.merchant.reserve(tx,id,p.cart);await f.merchant.reserve(tx,id,p.cart);});
  assert.equal((await f.repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,99);
  await f.repository.transaction(async tx=>{await f.merchant.finalize(tx,id,'confirmed');await f.merchant.finalize(tx,id,'confirmed');});
  await f.merchant.seed();
  assert.equal((await f.repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,99);
  assert.equal((await f.repository.query('SELECT state FROM pp_checkout_orders WHERE id=$1',[id])).rows[0].state,'confirmed');
  await f.pool.end();
});
test('a verified terminal failure releases stock once',async()=> {
  const f=await fixture(); const p=await preview(f); const a=await f.repository.authorizePreview(f.alice,{previewId:p.id,maxAmountCents:11000});const id=randomUUID();
  await f.repository.query('INSERT INTO pp_checkout_orders(id,intent_id,subject_key,sku,variant_id,quantity,amount_cents,currency,card_id,state,reservation_state,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,a.id,f.alice.subjectKey,p.cart.sku,'black',1,10400,'USD','card-a','payment_pending','none',100000,{}]);
  await f.repository.transaction(async tx=>{await f.merchant.reserve(tx,id,p.cart);await f.merchant.finalize(tx,id,'released');await f.merchant.finalize(tx,id,'released');});
  assert.equal((await f.repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,100);
  await f.pool.end();
});
