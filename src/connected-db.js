import pg from 'pg';

const { Pool } = pg;
export function createDatabase(url = process.env.DATABASE_URL, injectedPool = null, {schema = process.env.PERKPILOT_DATABASE_SCHEMA} = {}) {
  if (!url && !injectedPool) throw new Error('DATABASE_URL is required for connected mode.');
  if (schema !== undefined && schema !== '' && (typeof schema !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)))
    throw Object.assign(new Error('Database schema must be a lowercase PostgreSQL identifier of at most 63 characters.'), {code:'INVALID_DATABASE_SCHEMA'});
  const connectionOptions = schema ? `-c search_path=${schema}` : undefined;
  // pg lets URL options override Pool options. Pin both when the URL includes
  // options so a configured hosted namespace can never fall back to public.
  let connectionString = url;
  if (schema && !injectedPool) {
    const parsed = new URL(url);
    if (parsed.searchParams.has('options')) { parsed.searchParams.set('options', connectionOptions); connectionString = parsed.toString(); }
  }
  const pool = injectedPool || new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, ...(schema ? {options:connectionOptions} : {}) });
  const query = (sql, params = []) => pool.query(sql, params);
  const initializeSchema = async () => { if (schema) await query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); };
  async function transaction(fn) {
    const client=await pool.connect();
    try{await client.query('BEGIN');const result=await fn({query:(sql,params=[])=>client.query(sql,params)});await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  async function migrate() {
    await initializeSchema();
    await query(`CREATE TABLE IF NOT EXISTS connected_users (
      id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
      password_salt text NOT NULL, password_hash text NOT NULL,
      consent boolean NOT NULL DEFAULT false, shopping_location text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await query('ALTER TABLE connected_users ADD COLUMN IF NOT EXISTS shopping_location text');
    await query(`CREATE TABLE IF NOT EXISTS connected_portal_bindings (
      portal_user_id text PRIMARY KEY,
      user_id uuid NOT NULL UNIQUE REFERENCES connected_users(id) ON DELETE CASCADE
    )`);
    await query(`CREATE TABLE IF NOT EXISTS connected_sessions (
      token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES connected_users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS plaid_items (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES connected_users(id) ON DELETE CASCADE,
      provider_item_id text NOT NULL UNIQUE, token_ciphertext text NOT NULL,
      cursor text, last_synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS connected_accounts (
      id text NOT NULL, user_id uuid NOT NULL REFERENCES connected_users(id) ON DELETE CASCADE,
      item_id uuid NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE, data jsonb NOT NULL,
      PRIMARY KEY(user_id,item_id,id)
    )`);
    await query(`CREATE TABLE IF NOT EXISTS connected_transactions (
      id text NOT NULL, user_id uuid NOT NULL REFERENCES connected_users(id) ON DELETE CASCADE,
      item_id uuid NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE, data jsonb NOT NULL,
      PRIMARY KEY(user_id,item_id,id)
    )`);
    await query('CREATE INDEX IF NOT EXISTS connected_tx_user_item ON connected_transactions(user_id, item_id)');
    await query(`CREATE TABLE IF NOT EXISTS connected_login_attempts (
      attempt_key text PRIMARY KEY, attempts integer NOT NULL, window_until timestamptz NOT NULL
    )`);
  }
  async function saveSync(item, accounts, changes, cursor) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const account of accounts) await client.query(
        `INSERT INTO connected_accounts(id,user_id,item_id,data) VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id,item_id,id) DO UPDATE SET data=EXCLUDED.data`,
        [account.id, item.user_id, item.id, account]);
      for (const removedId of changes.removedIds) await client.query('DELETE FROM connected_transactions WHERE id=$1 AND user_id=$2 AND item_id=$3', [removedId, item.user_id, item.id]);
      for (const transaction of changes.updated) {
        if (transaction.replacesTransactionId) await client.query('DELETE FROM connected_transactions WHERE id=$1 AND user_id=$2 AND item_id=$3', [transaction.replacesTransactionId, item.user_id, item.id]);
        await client.query(
          `INSERT INTO connected_transactions(id,user_id,item_id,data) VALUES($1,$2,$3,$4)
           ON CONFLICT(user_id,item_id,id) DO UPDATE SET data=EXCLUDED.data`,
          [transaction.id, item.user_id, item.id, transaction]);
      }
      await client.query('UPDATE plaid_items SET cursor=$1,last_synced_at=now() WHERE id=$2 AND user_id=$3', [cursor, item.id, item.user_id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return { pool, query, transaction, initializeSchema, migrate, saveSync, close: () => pool.end() };
}
