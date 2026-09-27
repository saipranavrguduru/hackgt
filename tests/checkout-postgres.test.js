import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCheckoutRepository} from '../src/checkout-repository.js';
import {createCheckoutMerchant} from '../src/checkout-merchant.js';

test('real PostgreSQL: concurrent authorization, inventory and rollback use isolated schema',{skip:!process.env.TEST_CHECKOUT_DATABASE_URL ? 'TEST_CHECKOUT_DATABASE_URL absent; real concurrency is unverified' : false},async()=> {
  const schema=`pp_checkout_test_${randomUUID().replaceAll('-','')}`;
  const decoy=`${schema}_decoy`;
  const admin=new pg.Pool({connectionString:process.env.TEST_CHECKOUT_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE SCHEMA ${decoy}`);
  await admin.query(`CREATE TABLE ${decoy}.pp_checkout_schema_versions(version integer PRIMARY KEY,applied_at bigint NOT NULL)`);
  const pool=new pg.Pool({connectionString:process.env.TEST_CHECKOUT_DATABASE_URL,options:`-c search_path=${schema}`,max:4});
  try {
    const repository=createCheckoutRepository({pool,now:()=>Date.now()}); await repository.migrate();await repository.migrate();
    const merchant=createCheckoutMerchant({repository,providerAccountId:'acct_test'}); await merchant.seed();
    const principal={subjectKey:`portal:${randomUUID()}`,sessionDigest:'test-session'};await repository.ensureSubject(principal);
    const products=await merchant.listProducts(principal);
    const snapshot=await merchant.previewCart(principal,{sku:'everyday-headphones',variantId:'black',quantity:1,destinationId:products.destinations[0].id});
    const preview=await repository.createPreview(principal,{...snapshot,eligibleCardIds:['a']});
    const [a,b]=await Promise.all([repository.authorizePreview(principal,{previewId:preview.id,maxAmountCents:11000}),repository.authorizePreview(principal,{previewId:preview.id,maxAmountCents:11000})]);
    assert.equal(a.id,b.id);assert.equal((await repository.query('SELECT count(*)::int AS count FROM pp_checkout_intents')).rows[0].count,1);
    await assert.rejects(repository.transaction(async tx=>{await tx.query('UPDATE pp_checkout_products SET stock=0');throw new Error('abort');}),/abort/);
    assert.equal((await repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,100);
    const [c,d]=await Promise.all([repository.claimRun(a.id,'a'),repository.claimRun(a.id,'b')]);assert.equal([c,d].filter(Boolean).length,1);
    const orderId=randomUUID();
    await repository.query('INSERT INTO pp_checkout_orders(id,intent_id,subject_key,sku,variant_id,quantity,amount_cents,currency,card_id,state,reservation_state,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[orderId,a.id,principal.subjectKey,'everyday-headphones','black',1,10400,'USD','a','payment_pending','none',Date.now(),{}]);
    const reserve=()=>repository.transaction(async tx=>{
      await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey]);
      await tx.query('SELECT * FROM pp_checkout_intents WHERE id=$1 FOR UPDATE',[a.id]);
      return merchant.reserve(tx,orderId,snapshot.cart);
    });
    await Promise.all([reserve(),reserve()]);
    assert.equal((await repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,99);
    await Promise.all([repository.transaction(tx=>merchant.finalize(tx,orderId,'confirmed')),repository.transaction(tx=>merchant.finalize(tx,orderId,'confirmed'))]);
    assert.equal((await repository.query('SELECT stock FROM pp_checkout_products')).rows[0].stock,99);
    await assert.rejects(repository.query('INSERT INTO pp_checkout_attempts(id,order_id,idempotency_key,request_digest,state,dispatched_at) VALUES($1,$2,$3,$4,$5,$6),($7,$2,$8,$4,$5,$6)',[randomUUID(),orderId,`pp-checkout:${orderId}:payment:v1`,'digest','payment_pending',Date.now(),randomUUID(),'different-key']),error=>error.code==='23505');
  } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.query(`DROP SCHEMA ${decoy} CASCADE`);await admin.end();}
});
