import { randomUUID } from 'node:crypto';
import { createPlaidClient } from '../src/plaid.js';

const plaid = createPlaidClient();
try {
  if (!plaid.configured) throw new Error('Set PLAID_CLIENT_ID and PLAID_SECRET in the environment.');
  const result = await plaid.createLinkToken(randomUUID());
  if (!result.link_token) throw new Error('Plaid returned no link token.');
  console.log(`PASS: Plaid ${plaid.environment} accepted the credentials and created a link token.`);
} catch (error) {
  console.error(`Plaid verification failed: ${error.code || error.message}`);
  process.exitCode = 1;
}
