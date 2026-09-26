import { randomUUID } from 'node:crypto';
import { createDatabase } from '../src/connected-db.js';
import { createPlaidClient } from '../src/plaid.js';
import { createConnectedAI } from '../src/connected-ai.js';
import { createSerpApiClient } from '../src/serpapi.js';
import { createEbayClient } from '../src/ebay.js';
import { createShopifyClient } from '../src/shopify.js';

const db = createDatabase();
try {
  await db.query('SELECT 1'); console.log('PASS PostgreSQL connection');
  const plaid = createPlaidClient();
  const link = await plaid.createLinkToken(randomUUID());
  if (!link.link_token) throw new Error('Plaid returned no link token.');
  console.log(`PASS Plaid ${plaid.environment} link-token request`);
  const ai = createConnectedAI();
  const answer = await ai.ask('Briefly describe what data is available.', { asOf:null, transactionCount:0, merchants:[], categories:[], listings:[], coverage:'No linked account for this connectivity check.' });
  console.log(`PASS ${answer.source} ${answer.model} response`);
  const serpapi = createSerpApiClient(), ebay = createEbayClient();
  const catalog = serpapi.configured ? serpapi : ebay.configured ? ebay : createShopifyClient();
  if (catalog.configured) {
    const results = await catalog.search('headphones');
    console.log(`PASS ${results.source} search (${results.products.length} USD listings)`);
  } else console.log('SKIP live product search: no catalog provider credentials configured');
} catch (error) {
  console.error(`Connected provider verification failed: ${error.code || error.message}`);
  process.exitCode = 1;
} finally { await db.close(); }
