import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { createDatabase } from './connected-db.js';
import { createPlaidClient, encryptToken, decryptToken, normalizePlaidAccount, normalizePlaidTransaction } from './plaid.js';
import { createConnectedAI } from './connected-ai.js';
import { createSerpApiClient } from './serpapi.js';
import { createShoppingLocationResolver } from './geocoder.js';
import { createEbayClient } from './ebay.js';
import { createShopifyClient } from './shopify.js';
import { fail, requireValue } from './errors.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = { '/': ['live.html', 'text/html'], '/live.js': ['live.js', 'text/javascript'], '/live.css': ['live.css', 'text/css'] };
const hash = value => createHash('sha256').update(value).digest('hex');
const safeUser = user => ({ id: user.id, name: user.name, email: user.email, consent: user.consent, shoppingLocation: user.shopping_location || null });
const shoppingLocation = value => {
  if (value === undefined || value === null || value === '') return null;
  requireValue(typeof value === 'string', 'INVALID_LOCATION', 'Enter a city, region, and country.');
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  requireValue(clean.length >= 2 && clean.length <= 120, 'INVALID_LOCATION', 'Enter a shopping location up to 120 characters.');
  return clean;
};

async function bodyOf(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; requireValue(Buffer.byteLength(body) <= 32768, 'BODY_TOO_LARGE', 'Request is too large.', 413); }
  if (!body) return {};
  requireValue(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON_REQUIRED', 'Send JSON.', 415);
  try { const parsed = JSON.parse(body); requireValue(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'INVALID_JSON', 'Send an object.'); return parsed; }
  catch (error) { if (error.code) throw error; fail('INVALID_JSON', 'Malformed JSON.'); }
}

export function createConnectedApplication(options = {}) {
  const db = options.db || createDatabase(options.databaseUrl);
  const plaid = options.plaid || createPlaidClient(options.plaidOptions);
  const ai = options.ai || createConnectedAI(options.aiOptions);
  const serpapi = options.serpapi || createSerpApiClient(options.serpapiOptions);
  const locationResolver = options.locationResolver || createShoppingLocationResolver(options.locationOptions);
  const ebay = options.ebay || createEbayClient(options.ebayOptions);
  const shopify = options.shopify || createShopifyClient(options.shopifyOptions);
  const catalog = serpapi.configured ? serpapi : ebay.configured ? ebay : shopify;
  const catalogName = serpapi.configured ? 'serpapi-google-shopping' : ebay.configured ? 'ebay' : shopify.configured ? 'shopify' : 'unconfigured';
  const origin = options.origin || process.env.PUBLIC_ORIGIN || 'http://localhost:3400';
  const canonical = new URL(origin);
  requireValue(['http:', 'https:'].includes(canonical.protocol) && !canonical.pathname.slice(1) && !canonical.search && !canonical.hash, 'INVALID_ORIGIN', 'PUBLIC_ORIGIN must be an origin.');
  if (canonical.protocol === 'http:') requireValue(['localhost', '127.0.0.1'].includes(canonical.hostname), 'INSECURE_ORIGIN', 'Public connected mode requires HTTPS.');

  async function snapshot(userId) {
    const [accounts, transactions, items] = await Promise.all([
      db.query('SELECT data FROM connected_accounts WHERE user_id=$1 ORDER BY id', [userId]),
      db.query('SELECT data FROM connected_transactions WHERE user_id=$1 ORDER BY data->>\'postedAt\' DESC LIMIT 2000', [userId]),
      db.query('SELECT id,last_synced_at FROM plaid_items WHERE user_id=$1 ORDER BY created_at', [userId])
    ]);
    return { accounts: accounts.rows.map(row => row.data), transactions: transactions.rows.map(row => row.data),
      connections: items.rows.map(row => ({ id: row.id, lastSyncedAt: row.last_synced_at })) };
  }
  function profileFrom(data) {
    const posted = data.transactions.filter(tx => tx.status === 'posted' && tx.kind === 'purchase' && tx.currency === 'USD' && tx.amountCents > 0);
    const merchants = new Map(), categories = new Map();
    for (const tx of posted) {
      for (const [map, name] of [[merchants, tx.merchantName], [categories, tx.category]]) {
        const row = map.get(name) || { name, count: 0, totalCents: 0, lastPurchaseAt: null };
        row.count++; row.totalCents += tx.amountCents;
        if (!row.lastPurchaseAt || tx.postedAt > row.lastPurchaseAt) row.lastPurchaseAt = tx.postedAt;
        map.set(name, row);
      }
    }
    const sort = map => [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 12);
    return { transactionCount: posted.length, merchants: sort(merchants), categories: sort(categories),
      totalCents: posted.reduce((sum, tx) => sum + tx.amountCents, 0),
      asOf: data.connections.map(c => c.lastSyncedAt).filter(Boolean).sort().at(-1) || null,
      provenance: 'plaid', coverage: 'Gross posted USD purchases from connected accounts are included; refunds are excluded from these totals. Merchant and category labels come from bank data; item purchases are unknown.' };
  }
  async function syncItem(item) {
    const token = decryptToken(item.token_ciphertext, process.env.PLAID_TOKEN_ENCRYPTION_KEY);
    let cursor = item.cursor || undefined;
    const updated = new Map(), removedIds = new Set();
    let pages = 0, page;
    do {
      requireValue(++pages <= 20, 'PLAID_SYNC_TOO_LARGE', 'Bank sync exceeded the page limit; try again later.', 502);
      page = await plaid.sync(token, cursor);
      requireValue(Array.isArray(page.added) && Array.isArray(page.modified) && Array.isArray(page.removed) && typeof page.next_cursor === 'string', 'PLAID_INVALID_RESPONSE', 'Bank sync response is incomplete.', 502);
      for (const row of page.removed) { const id = `plaid:${row.transaction_id}`; removedIds.add(id); updated.delete(id); }
      for (const row of [...page.added, ...page.modified]) { const tx = normalizePlaidTransaction(row, item.user_id); updated.set(tx.id, tx); removedIds.delete(tx.id); }
      cursor = page.next_cursor;
    } while (page.has_more);
    const accountResponse = await plaid.accounts(token);
    requireValue(Array.isArray(accountResponse.accounts), 'PLAID_INVALID_RESPONSE', 'Bank account response is incomplete.', 502);
    const observedAt = new Date().toISOString();
    const accounts = accountResponse.accounts.map(row => normalizePlaidAccount(row, item.user_id, observedAt));
    await db.saveSync(item, accounts, { updated: [...updated.values()], removedIds: [...removedIds] }, cursor);
    return { addedOrModified: updated.size, removed: removedIds.size, accountCount: accounts.length, lastSyncedAt: observedAt };
  }

  async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self'; connect-src 'self' https://production.plaid.com https://development.plaid.com https://sandbox.plaid.com; frame-src https://cdn.plaid.com https://*.plaid.com; img-src 'self' https: data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      requireValue(req.headers.host === canonical.host, 'INVALID_HOST', 'Use the configured app address.', 403);
      const url = new URL(req.url, origin);
      const method = req.method;
      if (!['GET', 'HEAD'].includes(method)) requireValue(req.headers.origin === origin && req.headers['sec-fetch-site'] !== 'cross-site', 'ORIGIN_REJECTED', 'Request origin is not permitted.', 403);
      if (method === 'GET' && assets[url.pathname]) {
        const [name, mime] = assets[url.pathname];
        const content = await readFile(resolve(join(root, 'public'), name));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-cache' }); return res.end(content);
      }
      if (url.pathname === '/api/health' && method === 'GET') { await db.query('SELECT 1'); return send({ database: 'ready', plaid: plaid.configured ? plaid.environment : 'unconfigured', ai: ai.configured, catalog: catalogName }); }
      const body = ['POST', 'PATCH', 'DELETE'].includes(method) ? await bodyOf(req) : {};
      const cookieToken = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('perkpilot_live='))?.slice('perkpilot_live='.length);
      const session = cookieToken && cookieToken.length < 256 ? (await db.query(`SELECT u.* FROM connected_sessions s JOIN connected_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hash(cookieToken)])).rows[0] : null;
      const setCookie = value => res.setHeader('Set-Cookie', `perkpilot_live=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? 43200 : 0}${canonical.protocol === 'https:' ? '; Secure' : ''}`);
      if (url.pathname === '/api/auth/register' && method === 'POST') {
        requireValue(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 80, 'INVALID_NAME', 'Enter your name.');
        requireValue(typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) && body.email.length <= 254, 'INVALID_EMAIL', 'Enter an email address.');
        requireValue(typeof body.password === 'string' && body.password.length >= 12 && body.password.length <= 128, 'INVALID_PASSWORD', 'Use a 12–128 character password.');
        const salt = randomBytes(16).toString('hex'), id = randomUUID();
        const savedLocation = shoppingLocation(body.shoppingLocation);
        try { await db.query('INSERT INTO connected_users(id,email,name,password_salt,password_hash,shopping_location) VALUES($1,$2,$3,$4,$5,$6)', [id, body.email.trim().toLowerCase(), body.name.trim(), salt, scryptSync(body.password, salt, 64).toString('hex'), savedLocation]); }
        catch (error) { if (error.code === '23505') fail('ACCOUNT_EXISTS', 'An account with this email exists.', 409); throw error; }
        const raw = randomBytes(32).toString('base64url');
        await db.query("INSERT INTO connected_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [hash(raw), id]);
        setCookie(raw); return send({ user: { id, name: body.name.trim(), email: body.email.trim().toLowerCase(), consent: false, shoppingLocation:savedLocation } }, 201);
      }
      if (url.pathname === '/api/auth/login' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        const attemptKey = hash(`${req.socket.remoteAddress || ''}:${email}`);
        const attempt = (await db.query('SELECT attempts,window_until FROM connected_login_attempts WHERE attempt_key=$1', [attemptKey])).rows[0];
        requireValue(!attempt || attempt.window_until <= new Date() || attempt.attempts < 5, 'RATE_LIMITED', 'Too many attempts. Try again later.', 429);
        const user = (await db.query('SELECT * FROM connected_users WHERE email=$1', [email])).rows[0];
        const candidate = scryptSync(typeof body.password === 'string' && body.password.length <= 128 ? body.password : '', user?.password_salt || 'constant-dummy-salt', 64);
        if (!user || !timingSafeEqual(candidate, Buffer.from(user.password_hash, 'hex'))) {
          await db.query(`INSERT INTO connected_login_attempts(attempt_key,attempts,window_until) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(attempt_key) DO UPDATE SET attempts=CASE WHEN connected_login_attempts.window_until<now() THEN 1 ELSE connected_login_attempts.attempts+1 END,window_until=CASE WHEN connected_login_attempts.window_until<now() THEN now()+interval '15 minutes' ELSE connected_login_attempts.window_until END`, [attemptKey]);
          fail('INVALID_CREDENTIALS', 'Invalid credentials.', 401);
        }
        await db.query('DELETE FROM connected_login_attempts WHERE attempt_key=$1', [attemptKey]);
        const raw = randomBytes(32).toString('base64url');
        await db.query("INSERT INTO connected_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [hash(raw), user.id]);
        setCookie(raw); return send({ user: safeUser(user) });
      }
      if (url.pathname === '/api/auth/session' && method === 'GET') return send({ user: session ? safeUser(session) : null });
      if (url.pathname === '/api/auth/logout' && method === 'POST') { if (cookieToken) await db.query('DELETE FROM connected_sessions WHERE token_hash=$1', [hash(cookieToken)]); setCookie(''); return send({ ok: true }); }
      requireValue(session, 'LOGIN_REQUIRED', 'Sign in first.', 401);
      if (url.pathname === '/api/consent' && method === 'POST') {
        requireValue(typeof body.consent === 'boolean', 'INVALID_CONSENT', 'Choose whether to use connected transactions for insights.');
        await db.query('UPDATE connected_users SET consent=$1 WHERE id=$2', [body.consent, session.id]);
        return send({ consent: body.consent });
      }
      if (url.pathname === '/api/profile/location' && method === 'PATCH') {
        const savedLocation = shoppingLocation(body.location);
        await db.query('UPDATE connected_users SET shopping_location=$1 WHERE id=$2', [savedLocation, session.id]);
        return send({ location:savedLocation });
      }
      if (url.pathname === '/api/profile/location/locate' && method === 'POST') {
        const resolved = await locationResolver.locate(body);
        await db.query('UPDATE connected_users SET shopping_location=$1 WHERE id=$2', [resolved.location, session.id]);
        return send(resolved);
      }
      if (url.pathname === '/api/plaid/link-token' && method === 'POST') {
        requireValue(session.consent, 'CONSENT_REQUIRED', 'Enable spending insights before linking an account.', 403);
        requireValue(process.env.PLAID_TOKEN_ENCRYPTION_KEY, 'PROVIDER_NOT_CONFIGURED', 'Plaid token encryption is not configured.', 503);
        const result = await plaid.createLinkToken(session.id);
        return send({ linkToken: result.link_token, expiration: result.expiration });
      }
      if (url.pathname === '/api/plaid/exchange' && method === 'POST') {
        requireValue(session.consent, 'CONSENT_REQUIRED', 'Enable spending insights first.', 403);
        requireValue(typeof body.publicToken === 'string' && body.publicToken.length < 1000, 'INVALID_TOKEN', 'Plaid token is missing.');
        const exchanged = await plaid.exchange(body.publicToken);
        requireValue(exchanged.access_token && exchanged.item_id, 'PLAID_INVALID_RESPONSE', 'Plaid exchange was incomplete.', 502);
        const item = { id: randomUUID(), user_id: session.id, provider_item_id: exchanged.item_id,
          token_ciphertext: encryptToken(exchanged.access_token, process.env.PLAID_TOKEN_ENCRYPTION_KEY), cursor: null };
        try { await db.query('INSERT INTO plaid_items(id,user_id,provider_item_id,token_ciphertext) VALUES($1,$2,$3,$4)', [item.id, item.user_id, item.provider_item_id, item.token_ciphertext]); }
        catch (error) { if (error.code === '23505') fail('ACCOUNT_ALREADY_LINKED', 'This bank connection is already linked.', 409); throw error; }
        const result = await syncItem(item); return send({ itemId: item.id, ...result }, 201);
      }
      if (url.pathname === '/api/plaid/sync' && method === 'POST') {
        const items = (await db.query('SELECT * FROM plaid_items WHERE user_id=$1 ORDER BY created_at', [session.id])).rows;
        requireValue(items.length, 'NO_CONNECTION', 'Link an account first.', 409);
        const results = []; for (const item of items) results.push({ itemId: item.id, ...await syncItem(item) });
        return send({ results });
      }
      const disconnect = url.pathname.match(/^\/api\/plaid\/items\/([0-9a-f-]{36})$/);
      if (disconnect && method === 'DELETE') {
        const item = (await db.query('SELECT * FROM plaid_items WHERE id=$1 AND user_id=$2', [disconnect[1], session.id])).rows[0];
        requireValue(item, 'NOT_FOUND', 'Connection not found.', 404);
        await plaid.remove(decryptToken(item.token_ciphertext, process.env.PLAID_TOKEN_ENCRYPTION_KEY));
        await db.query('DELETE FROM plaid_items WHERE id=$1 AND user_id=$2', [item.id, session.id]);
        return send({ ok: true });
      }
      if (url.pathname === '/api/dashboard' && method === 'GET') {
        const data = await snapshot(session.id);
        return send({ user: safeUser(session), ...data, profile: session.consent ? profileFrom(data) : null, aiConfigured: ai.configured, catalogConfigured: catalog.configured });
      }
      if (url.pathname === '/api/products' && method === 'GET') return send(await catalog.search(url.searchParams.get('q') || '', session.shopping_location ? { location:session.shopping_location } : undefined));
      if (url.pathname === '/api/assistant' && method === 'POST') {
        const data = await snapshot(session.id);
        const profile = session.consent ? profileFrom(data) : { transactionCount: 0, merchants: [], categories: [], totalCents: 0, asOf: null, coverage: 'Spending insights are disabled.' };
        let listings = [];
        if (body.catalogQuery !== undefined) {
          requireValue(typeof body.catalogQuery === 'string' && body.catalogQuery.length >= 2 && body.catalogQuery.length <= 120, 'INVALID_SEARCH', 'Search query is invalid.');
          const result = await catalog.search(body.catalogQuery, session.shopping_location ? { location:session.shopping_location } : undefined);
          listings = result.products.slice(0, 5).map(product => ({ name: product.name, merchantName: product.merchantName, priceCents: product.priceCents, shippingCents: product.shippingCents, taxCents: product.taxCents, observedAt: product.observedAt, url: product.url, source: product.source }));
        }
        return send(await ai.ask(body.message, { ...profile, listings }));
      }
      if (url.pathname === '/api/account' && method === 'DELETE') {
        const items = (await db.query('SELECT token_ciphertext FROM plaid_items WHERE user_id=$1', [session.id])).rows;
        for (const item of items) await plaid.remove(decryptToken(item.token_ciphertext, process.env.PLAID_TOKEN_ENCRYPTION_KEY));
        await db.query('DELETE FROM connected_users WHERE id=$1', [session.id]); setCookie(''); return send({ ok: true });
      }
      fail('NOT_FOUND', 'Endpoint not found.', 404);
    } catch (error) {
      const status = error.status || error.statusCode || 500;
      if (status >= 500) console.error('Connected PerkPilot error:', error.code || error.name);
      if (!res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { code: error.code || 'SERVER_ERROR', message: status >= 500 && !error.code ? 'Request failed.' : error.message } })); }
    }
  }
  return { server: createServer(handler), db, migrate: () => db.migrate() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createConnectedApplication();
  const port = Number(process.env.PORT || 3400);
  app.migrate().then(() => app.server.listen(port, '0.0.0.0', () => console.log(`Connected PerkPilot ready on port ${port}`))).catch(error => { console.error('Connected mode could not start:', error.message); process.exitCode = 1; app.db.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.server.close(() => app.db.close()));
}
