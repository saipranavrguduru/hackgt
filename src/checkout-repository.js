import {randomUUID} from 'node:crypto';
import {canonicalPurchaseHash} from './checkout-policy.js';
import {fail} from './errors.js';
import {assertCheckoutDemoConfig} from './checkout-demo.js';

// All time columns are UTC epoch milliseconds, matching the injected JS clock.
// `data` contains internal snapshots; HTTP/model callers must project safe fields.
export const CHECKOUT_SCHEMA_VERSION = 2;
const tables = [
  `CREATE TABLE IF NOT EXISTS pp_checkout_schema_versions(version integer PRIMARY KEY, applied_at bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_subjects(subject_key text PRIMARY KEY, provider_account_id text, customer_id text, revoked_at bigint, created_at bigint NOT NULL, data jsonb NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_methods(id text PRIMARY KEY, subject_key text NOT NULL REFERENCES pp_checkout_subjects(subject_key), card_id text NOT NULL, product_id text NOT NULL, provider_account_id text NOT NULL, setup_id text, payment_method_id text, active boolean NOT NULL DEFAULT true, consent_at bigint, revoked_at bigint, created_at bigint NOT NULL, data jsonb NOT NULL DEFAULT '{}', UNIQUE(provider_account_id,payment_method_id))`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_enrollments(id text PRIMARY KEY, subject_key text NOT NULL REFERENCES pp_checkout_subjects(subject_key), card_id text NOT NULL, provider_account_id text NOT NULL, customer_id text NOT NULL, setup_id text UNIQUE, state text NOT NULL, consent_at bigint NOT NULL, created_at bigint NOT NULL, data jsonb NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_products(sku text NOT NULL, variant_id text NOT NULL, merchant_id text NOT NULL, provider_account_id text NOT NULL, merchandise_cents integer NOT NULL CHECK(merchandise_cents >= 0), tax_cents integer NOT NULL CHECK(tax_cents >= 0), shipping_cents integer NOT NULL CHECK(shipping_cents >= 0), revision integer NOT NULL DEFAULT 1, stock integer NOT NULL CHECK(stock >= 0), data jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(sku,variant_id))`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_destinations(id text PRIMARY KEY, subject_key text NOT NULL REFERENCES pp_checkout_subjects(subject_key), data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_previews(id text PRIMARY KEY, subject_key text NOT NULL REFERENCES pp_checkout_subjects(subject_key), session_digest text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_intents(id text PRIMARY KEY, subject_key text NOT NULL REFERENCES pp_checkout_subjects(subject_key), preview_id text NOT NULL UNIQUE REFERENCES pp_checkout_previews(id), session_digest text NOT NULL, purchase_hash text NOT NULL, max_amount_cents integer NOT NULL CHECK(max_amount_cents >= 0 AND max_amount_cents <= 50000), state text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, revoked_at bigint, worker_id text, lease_until bigint, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_jobs(id text PRIMARY KEY, intent_id text NOT NULL UNIQUE REFERENCES pp_checkout_intents(id), state text NOT NULL, created_at bigint NOT NULL, worker_id text, lease_until bigint)`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_quotes(id text PRIMARY KEY, intent_id text NOT NULL REFERENCES pp_checkout_intents(id), created_at bigint NOT NULL, expires_at bigint NOT NULL, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_orders(id text PRIMARY KEY, intent_id text NOT NULL UNIQUE REFERENCES pp_checkout_intents(id), subject_key text NOT NULL REFERENCES pp_checkout_subjects(subject_key), sku text NOT NULL, variant_id text NOT NULL, quantity integer NOT NULL CHECK(quantity >= 1 AND quantity <= 10), amount_cents integer NOT NULL CHECK(amount_cents >= 0 AND amount_cents <= 50000), currency text NOT NULL CHECK(currency = 'USD'), card_id text NOT NULL, state text NOT NULL, reservation_state text NOT NULL DEFAULT 'none', created_at bigint NOT NULL, confirmed_at bigint, data jsonb NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_attempts(id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES pp_checkout_orders(id), idempotency_key text NOT NULL UNIQUE, request_digest text NOT NULL, payment_id text, state text NOT NULL, dispatched_at bigint NOT NULL, last_reconciled_at bigint, data jsonb NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_events(id text PRIMARY KEY, provider_account_id text NOT NULL, environment text NOT NULL CHECK(environment = 'test'), provider_event_id text NOT NULL, received_at bigint NOT NULL, processed_at bigint, state text NOT NULL, data jsonb NOT NULL DEFAULT '{}', UNIQUE(provider_account_id,environment,provider_event_id))`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_actions(id text PRIMARY KEY, intent_id text NOT NULL REFERENCES pp_checkout_intents(id), sequence integer NOT NULL, created_at bigint NOT NULL, data jsonb NOT NULL, UNIQUE(intent_id,sequence))`,
  `CREATE TABLE IF NOT EXISTS pp_checkout_demo_scenarios(subject_key text PRIMARY KEY REFERENCES pp_checkout_subjects(subject_key), name text NOT NULL CHECK(name IN ('price-increase','prompt-injection')), armed_at bigint NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pp_checkout_intents_owner_state ON pp_checkout_intents(subject_key,state)`,
  `CREATE INDEX IF NOT EXISTS pp_checkout_methods_owner ON pp_checkout_methods(subject_key,active)`,
];
const principalValid = principal => principal && /^portal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(principal.subjectKey) && typeof principal.sessionDigest === 'string' && principal.sessionDigest.length > 0;
const requirePrincipal = principal => {if (!principalValid(principal)) fail('REGISTERED_USER_REQUIRED','A registered portal session is required.',403);};
const previewView = row => ({...row.data,id:row.id,subjectKey:row.subject_key,createdAt:Number(row.created_at),expiresAt:Number(row.expires_at)});
export function checkoutIntentFromRow(row) {
  return {...row.data?.permission,...row.data,id:row.id,subjectKey:row.subject_key,state:row.state,previewId:row.preview_id,
    purchaseHash:row.purchase_hash,maxAmountCents:row.max_amount_cents,createdAt:Number(row.created_at),expiresAt:Number(row.expires_at),
    revokedAt:row.revoked_at === null ? null : Number(row.revoked_at),workerId:row.worker_id,leaseUntil:row.lease_until === null ? null : Number(row.lease_until)};
}

export function createCheckoutRepository({pool,now=Date.now,demoConfig=null}) {
  if (!pool?.connect || !pool?.query) throw new Error('A checkout PostgreSQL pool is required.');
  if (demoConfig) assertCheckoutDemoConfig(demoConfig);
  const query = (sql,params=[])=>pool.query(sql,params);
  async function transaction(fn) {
    const client=await pool.connect();
    try {await client.query('BEGIN');const result=await fn({query:(sql,params=[])=>client.query(sql,params)});await client.query('COMMIT');return result;}
    catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }
  async function migrate() {
    await transaction(async tx=>{
      const existing=(await tx.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='pp_checkout_schema_versions'")).rows;
      if (existing.length) {
        const version=(await tx.query('SELECT version FROM pp_checkout_schema_versions WHERE version=$1',[CHECKOUT_SCHEMA_VERSION])).rows;
        if (version.length) return;
      }
      for (const sql of tables) await tx.query(sql);
      await tx.query('INSERT INTO pp_checkout_schema_versions(version,applied_at) VALUES($1,$2) ON CONFLICT(version) DO NOTHING',[CHECKOUT_SCHEMA_VERSION,now()]);
    });
  }
  async function ensureSubject(principal,{tx}={}) {
    requirePrincipal(principal);const db=tx ?? {query};
    await db.query('INSERT INTO pp_checkout_subjects(subject_key,created_at) VALUES($1,$2) ON CONFLICT(subject_key) DO NOTHING',[principal.subjectKey,now()]);
    return (await db.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1',[principal.subjectKey])).rows[0];
  }
  async function createPreview(principal,snapshot) {
    requirePrincipal(principal);canonicalPurchaseHash(snapshot?.cart);
    return transaction(async tx=>{
      await ensureSubject(principal,{tx});
      const id=randomUUID(),time=now();
      const row=(await tx.query('INSERT INTO pp_checkout_previews(id,subject_key,session_digest,created_at,expires_at,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,principal.subjectKey,principal.sessionDigest,time,time+300000,snapshot])).rows[0];
      return previewView(row);
    });
  }
  async function authorizePreview(principal,{previewId,maxAmountCents}) {
    requirePrincipal(principal);
    if (!Number.isSafeInteger(maxAmountCents) || maxAmountCents < 0 || maxAmountCents > 50000) fail('INVALID_PURCHASE','Invalid purchase maximum.');
    return transaction(async tx=>{
      const subject=(await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey])).rows[0];
      if (!subject) fail('NOT_FOUND','Preview not found.',404);
      const p=(await tx.query('SELECT * FROM pp_checkout_previews WHERE id=$1 AND subject_key=$2 FOR UPDATE',[previewId,principal.subjectKey])).rows[0];
      if (!p) fail('NOT_FOUND','Preview not found.',404);
      const existing=(await tx.query('SELECT * FROM pp_checkout_intents WHERE preview_id=$1',[previewId])).rows[0];
      if (existing) {
        if (existing.max_amount_cents !== maxAmountCents || existing.session_digest !== principal.sessionDigest) fail('IDEMPOTENCY_CONFLICT','This preview already authorized different terms.',409);
        return checkoutIntentFromRow(existing);
      }
      if (subject.revoked_at !== null) fail('PERMISSION_REVOKED','Subject is revoked.',403);
      if (p.session_digest !== principal.sessionDigest) fail('NOT_FOUND','Preview not found.',404);
      const time=now();if (time >= Number(p.expires_at)) fail('PREVIEW_EXPIRED','Preview has expired.',409);
      const ids=p.data.eligibleCardIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id=>typeof id !== 'string' || !id)) fail('INVALID_PURCHASE','Choose an enrolled card set.');
      const hash=canonicalPurchaseHash(p.data.cart),id=randomUUID();
      const permission={...p.data.cart,cart:p.data.cart,subjectKey:principal.subjectKey,sessionDigest:principal.sessionDigest,previewId,
        purchaseHash:hash,maxAmountCents,eligibleCardIds:[...ids],cardSelection:'best_estimated_reward',createdAt:time,expiresAt:time+300000,termsVersion:1};
      const data={permission,preview:p.data};
      if (demoConfig) {
        assertCheckoutDemoConfig(demoConfig);
        const scenario=(await tx.query('SELECT name FROM pp_checkout_demo_scenarios WHERE subject_key=$1 FOR UPDATE',[principal.subjectKey])).rows[0];
        if (scenario) {
          // Attach only after authoritative approval terms are fixed. Existing
          // intent replay returned above cannot consume a new armed scenario.
          if(subject.provider_account_id!==demoConfig.providerAccountId || p.data.cart.providerAccountId!==demoConfig.providerAccountId)fail('DEMO_TEST_ACCOUNT_REQUIRED','Presenter scenario account does not match this purchase.',403);
          data.scenario={name:scenario.name};
          await tx.query('DELETE FROM pp_checkout_demo_scenarios WHERE subject_key=$1',[principal.subjectKey]);
        }
      }
      const row=(await tx.query('INSERT INTO pp_checkout_intents(id,subject_key,preview_id,session_digest,purchase_hash,max_amount_cents,state,created_at,expires_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,principal.subjectKey,previewId,principal.sessionDigest,hash,maxAmountCents,'queued',time,time+300000,data])).rows[0];
      await tx.query('INSERT INTO pp_checkout_jobs(id,intent_id,state,created_at) VALUES($1,$2,$3,$4)',[randomUUID(),id,'queued',time]);
      return checkoutIntentFromRow(row);
    });
  }
  async function getIntent(principal,id) {
    requirePrincipal(principal);
    const row=(await query('SELECT * FROM pp_checkout_intents WHERE id=$1 AND subject_key=$2',[id,principal.subjectKey])).rows[0];
    if (!row) fail('NOT_FOUND','Intent not found.',404);
    const actions=(await query('SELECT * FROM pp_checkout_actions WHERE intent_id=$1 ORDER BY sequence',[id])).rows;
    return {...checkoutIntentFromRow(row),events:actions.map(a=>({...a.data,sequence:a.sequence,createdAt:Number(a.created_at)}))};
  }
  async function claimRun(intentId,workerId) {
    return transaction(async tx=>{
      const time=now();
      const row=(await tx.query("UPDATE pp_checkout_intents SET worker_id=$1,lease_until=$2,state='running' WHERE id=$3 AND state IN ('queued','running') AND (lease_until IS NULL OR lease_until <= $4) AND expires_at > $4 AND revoked_at IS NULL RETURNING *",[workerId,time+60000,intentId,time])).rows[0];
      if (!row) return null;
      await tx.query("UPDATE pp_checkout_jobs SET state='running',worker_id=$1,lease_until=$2 WHERE intent_id=$3",[workerId,time+60000,intentId]);
      return checkoutIntentFromRow(row);
    });
  }
  async function renewRun(intentId,workerId) {
    return transaction(async tx=>{
      const time=now(),lease=time+60000;
      const result=await tx.query("UPDATE pp_checkout_intents SET lease_until=$1 WHERE id=$2 AND worker_id=$3 AND state='running' AND lease_until > $4 RETURNING id",[lease,intentId,workerId,time]);
      if (!result.rows.length) return false;
      await tx.query('UPDATE pp_checkout_jobs SET lease_until=$1 WHERE intent_id=$2 AND worker_id=$3',[lease,intentId,workerId]);
      return true;
    });
  }
  async function appendAction(intentId,event) {
    // Only bounded public progress fields are persisted; never arbitrary model text.
    const data={};for (const key of ['tool','code','state','quoteId','cardId']) if (typeof event?.[key] === 'string') data[key]=event[key].slice(0,256);
    return transaction(async tx=>{
      const row=(await tx.query('SELECT id FROM pp_checkout_intents WHERE id=$1 FOR UPDATE',[intentId])).rows[0];
      if (!row) fail('NOT_FOUND','Intent not found.',404);
      const actions=(await tx.query('SELECT sequence FROM pp_checkout_actions WHERE intent_id=$1 ORDER BY sequence DESC LIMIT 1',[intentId])).rows;
      const sequence=(actions[0]?.sequence ?? 0)+1,time=now();
      await tx.query('INSERT INTO pp_checkout_actions(id,intent_id,sequence,created_at,data) VALUES($1,$2,$3,$4,$5)',[randomUUID(),intentId,sequence,time,data]);
      return {...data,sequence,createdAt:time};
    });
  }
  async function listRecoverable() {
    const rows=(await query("SELECT * FROM pp_checkout_intents WHERE state IN ('payment_pending','requires_action') OR (state IN ('queued','running') AND (lease_until IS NULL OR lease_until <= $1)) ORDER BY created_at",[now()])).rows;
    return rows.map(checkoutIntentFromRow);
  }
  return {pool,now,query,transaction,migrate,ensureSubject,createPreview,authorizePreview,getIntent,claimRun,renewRun,appendAction,listRecoverable};
}
