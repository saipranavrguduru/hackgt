import { createDatabase } from '../src/connected-db.js';

const env = process.env;
const missing = [];
for (const key of ['DATABASE_URL','PUBLIC_ORIGIN','PLAID_CLIENT_ID','PLAID_SECRET','PLAID_TOKEN_ENCRYPTION_KEY']) if (!env[key]) missing.push(key);
if (!(env.GEMINI_API_KEY || env.OPENAI_API_KEY)) missing.push('GEMINI_API_KEY or OPENAI_API_KEY');
if (env.PLAID_TOKEN_ENCRYPTION_KEY && Buffer.from(env.PLAID_TOKEN_ENCRYPTION_KEY,'base64').length !== 32) missing.push('valid 32-byte PLAID_TOKEN_ENCRYPTION_KEY');
if (env.PUBLIC_ORIGIN) {
  try { const url = new URL(env.PUBLIC_ORIGIN); if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) missing.push('HTTPS PUBLIC_ORIGIN'); }
  catch { missing.push('valid PUBLIC_ORIGIN'); }
}
if (missing.length) {
  console.error(`Connected preflight unavailable: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  const db = createDatabase();
  try { await db.query('SELECT 1'); console.log(`Connected preflight passed configuration and database connectivity. Plaid: ${env.PLAID_ENV || 'sandbox'}. External provider calls still require a live smoke test.`); if (!env.SERPAPI_API_KEY && !(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) && !(env.SHOPIFY_STORE_DOMAIN && env.SHOPIFY_STOREFRONT_TOKEN)) console.log('Live product search is unavailable: no catalog provider credentials configured.'); }
  catch (error) { console.error(`Connected preflight database unavailable: ${error.code || error.message}`); process.exitCode = 1; }
  finally { await db.close(); }
}
