// The small portal keeps its existing synchronous domain stores. Requests must
// use run() and withhold their HTTP response until it resolves after COMMIT.
// The local queue protects shared objects; the row lock protects rolling peers.
const VERSION=1;
const stateArrays=['users','accounts','cards','transactions','merchants','products','offers','notifications','missions','quotes','checkoutSessions','purchases','ledger','events','researchSessions','watches','comparisons','pairings','storeCarts','cardRewardPurchases'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const error=(code,message)=>Object.assign(new Error(message),{code,status:503});
const invalid=()=>error('PORTAL_SNAPSHOT_INVALID','Stored portal data is unavailable or incompatible.');

function validate(snapshot) {
  if(!object(snapshot)||snapshot.version!==VERSION||!object(snapshot.state)||!object(snapshot.auth)||snapshot.state.schemaVersion!==1||
    stateArrays.some(key=>!Array.isArray(snapshot.state[key]))||!Array.isArray(snapshot.auth.users)||!Array.isArray(snapshot.auth.sessions))throw invalid();
  const users=snapshot.state.users;
  if(users.some(user=>!object(user)||typeof user.id!=='string'))throw invalid();
  if(snapshot.auth.users.some(user=>!object(user)||typeof user.id!=='string'||typeof user.email!=='string'||typeof user.name!=='string'||
    !/^[0-9a-f]{32}$/i.test(user.salt)||!/^[0-9a-f]{128}$/i.test(user.passwordHash)||!users.some(profile=>profile.id===user.id&&!profile.sample)))throw invalid();
  if(snapshot.auth.sessions.some(session=>!object(session)||!/^[0-9a-f]{64}$/i.test(session.digest)||typeof session.userId!=='string'||
    !['portal','extension'].includes(session.kind)||!Number.isFinite(session.expiresAt)||!users.some(user=>user.id===session.userId)))throw invalid();
  return snapshot;
}

export function createPortalPersistence({pool,store,auth,key='default'}={}) {
  if(!pool?.query||!pool?.connect||!store?.data||!auth?.data||store.path||auth.path||typeof key!=='string'||!key||key.length>120)
    throw error('PORTAL_PERSISTENCE_CONFIG','Portal database persistence requires a pool and pathless stores.');
  let initialized=false,queue=Promise.resolve();
  const serialize=()=>validate(structuredClone({version:VERSION,state:store.data,auth:auth.data}));
  const apply=snapshot=>{store.data=structuredClone(snapshot.state);auth.data=structuredClone(snapshot.auth);};
  const enqueue=work=>{const result=queue.then(work);queue=result.catch(()=>{});return result;};
  const ready=()=>{if(!initialized)throw error('PORTAL_PERSISTENCE_NOT_READY','Portal database persistence has not initialized.');};
  const read=async(client,lock=false)=>{
    const result=await client.query(`SELECT snapshot FROM pp_portal_snapshots WHERE key=$1${lock?' FOR UPDATE':''}`,[key]);
    return structuredClone(validate(result.rows[0]?.snapshot));
  };
  const rollback=async client=>{try{await client.query('ROLLBACK');}catch{/* Preserve the original failure; discard this connection below. */}};

  async function initialize() {
    return enqueue(async()=>{
      if(initialized)return;
      await pool.query(`CREATE TABLE IF NOT EXISTS pp_portal_snapshots (
        key text PRIMARY KEY, snapshot jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      const client=await pool.connect();let failed=false;
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO pp_portal_snapshots(key,snapshot) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[key,serialize()]);
        const snapshot=await read(client,true);
        await client.query('COMMIT');apply(snapshot);initialized=true;
      } catch(cause) {failed=true;await rollback(client);throw cause;}
      finally {client.release(failed);}
    });
  }

  async function run(work) {
    return enqueue(async()=>{
      ready();const client=await pool.connect();let before,failed=false;
      try {
        await client.query('BEGIN');
        before=await read(client,true);apply(before);
        const result=await work();
        const after=serialize();
        // GETs and provider-backed routes usually leave the portal unchanged.
        if(JSON.stringify(before)!==JSON.stringify(after)){
          const saved=await client.query('UPDATE pp_portal_snapshots SET snapshot=$1,updated_at=now() WHERE key=$2',[after,key]);
          if(saved.rowCount!==1)throw invalid();
        }
        await client.query('COMMIT');return result;
      } catch(cause) {failed=true;await rollback(client);if(before)apply(before);throw cause;}
      finally {client.release(failed);}
    });
  }

  async function readSnapshot() {
    ready();const snapshot=await read(pool);
    // Independent committed read for workers: never hydrate shared request data.
    return {state:snapshot.state,auth:snapshot.auth};
  }

  return {initialize,run,readSnapshot};
}
