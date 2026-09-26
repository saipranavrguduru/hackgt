import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { requireValue, fail } from './errors.js';

const endpoint = { sandbox: 'https://sandbox.plaid.com', development: 'https://development.plaid.com', production: 'https://production.plaid.com' };
const cents = amount => {
  requireValue(typeof amount === 'number' && Number.isFinite(amount) && Math.abs(amount) < 1e9, 'INVALID_PROVIDER_AMOUNT', 'Invalid transaction amount.', 502);
  return Math.round(amount * 100);
};
const keyFrom = value => {
  const key = Buffer.from(value || '', 'base64');
  requireValue(key.length === 32, 'PROVIDER_NOT_CONFIGURED', 'Set a 32-byte base64 PLAID_TOKEN_ENCRYPTION_KEY.', 503);
  return key;
};
export function encryptToken(token, encodedKey) {
  const iv = randomBytes(12), key = keyFrom(encodedKey);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.');
}
export function decryptToken(value, encodedKey) {
  const [iv, tag, body] = String(value).split('.').map(part => Buffer.from(part, 'base64url'));
  requireValue(iv?.length === 12 && tag?.length === 16 && body, 'INVALID_PROVIDER_TOKEN', 'Stored connection is invalid.', 500);
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(encodedKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function createPlaidClient({ clientId = process.env.PLAID_CLIENT_ID, secret = process.env.PLAID_SECRET, environment = process.env.PLAID_ENV || 'sandbox', redirectUri = process.env.PLAID_REDIRECT_URI, fetchImpl = fetch } = {}) {
  requireValue(endpoint[environment], 'INVALID_PLAID_ENV', 'Choose a supported Plaid environment.');
  const configured = Boolean(clientId && secret);
  async function call(path, input) {
    requireValue(configured, 'PROVIDER_NOT_CONFIGURED', 'Plaid credentials are not configured.', 503);
    let response;
    try {
      response = await fetchImpl(`${endpoint[environment]}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, secret, ...input }), signal: AbortSignal.timeout(15000)
      });
    } catch { fail('PLAID_UNAVAILABLE', 'Bank connection is temporarily unavailable.', 502); }
    let data;
    try { data = await response.json(); } catch { fail('PLAID_UNAVAILABLE', 'Bank provider returned an invalid response.', 502); }
    if (!response.ok) fail('PLAID_ERROR', data.error_message || 'Bank provider rejected the request.', 502);
    return data;
  }
  return {
    configured, environment,
    createLinkToken: (userId, webhook) => call('/link/token/create', { user: { client_user_id: userId }, client_name: 'PerkPilot', products: ['transactions'], country_codes: ['US'], language: 'en', ...(redirectUri ? { redirect_uri: redirectUri } : {}), ...(webhook ? { webhook } : {}) }),
    exchange: publicToken => call('/item/public_token/exchange', { public_token: publicToken }),
    sync: (accessToken, cursor) => call('/transactions/sync', { access_token: accessToken, ...(cursor ? { cursor } : {}), count: 500 }),
    remove: accessToken => call('/item/remove', { access_token: accessToken }),
    accounts: accessToken => call('/accounts/get', { access_token: accessToken })
  };
}

export function normalizePlaidAccount(account, userId, observedAt) {
  const balance = account.balances?.current;
  return { id: `plaid:${account.account_id}`, userId, providerAccountId: account.account_id,
    name: account.name || 'Connected account', type: account.type === 'credit' ? 'liability' : 'asset',
    balanceCents: typeof balance === 'number' && Number.isFinite(balance) ? cents(balance) : null,
    currency: account.balances?.iso_currency_code || null, last4: account.mask || null,
    source: 'Plaid connected account', provenance: 'plaid', lastSyncedAt: observedAt };
}

export function normalizePlaidTransaction(tx, userId) {
  const currency = tx.iso_currency_code || null;
  const amountCents = cents(tx.amount);
  const merchant = (tx.merchant_name || tx.name || 'Unknown merchant').trim().slice(0, 120);
  const detailed = tx.personal_finance_category?.detailed || null;
  const primary = tx.personal_finance_category?.primary || null;
  const isPayment = /^(LOAN_PAYMENTS|TRANSFER_OUT|TRANSFER_IN)/.test(primary || '');
  const kind = isPayment ? 'card_payment' : amountCents < 0 ? 'refund' : 'purchase';
  return { id: `plaid:${tx.transaction_id}`, userId, providerTransactionId: tx.transaction_id,
    accountId: `plaid:${tx.account_id}`, merchantId: `plaid-merchant:${merchant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    merchantName: merchant, category: primary?.toLowerCase() || 'other', providerCategory: detailed,
    amountCents, currency, kind, status: tx.pending ? 'pending' : 'posted',
    postedAt: tx.date ? `${tx.date}T12:00:00.000Z` : null,
    replacesTransactionId: tx.pending_transaction_id ? `plaid:${tx.pending_transaction_id}` : null,
    provenance: 'plaid', sourceLabel: 'Connected bank transaction' };
}
