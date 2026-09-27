import test from 'node:test';
import assert from 'node:assert/strict';
import {newDb} from 'pg-mem';
import {StateStore} from '../src/state.js';
import {AuthStore,digest} from '../src/auth.js';
import {createPortalPersistence} from '../src/portal-persistence.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function database(t) {
  // pg-mem's AST coverage check rejects a repeated CREATE TABLE IF NOT EXISTS.
  const memory=newDb({noAstCoverageCheck:true}),{Pool}=memory.adapters.createPg(),pool=new Pool();
  t.after(()=>pool.end());return {memory,pool};
}
function instance(pool) {
  const store=new StateStore(null),auth=new AuthStore(null);
  const persistence=createPortalPersistence({pool,store,auth});return {store,auth,persistence};
}
function addAccount(app) {
  const user=app.auth.register({name:'Persisted account',email:'persisted@example.test',password:'persisted-test-password'});
  app.store.data.users.push({...user,sample:false});
  app.store.data.cards.push({id:'persisted-card',userId:user.id,productId:'active-cash'});
  app.store.data.cardRewardPurchases.push({id:'tracked-purchase',userId:user.id,rewardCents:200});
  const token=app.auth.issue(user.id);return {user,token};
}

test('accounts, sessions, wallet and tracked cashback survive a new portal instance',async t=>{
  const {pool}=database(t),first=instance(pool);await first.persistence.initialize();
  const {user,token}=await first.persistence.run(()=>addAccount(first));
  const second=instance(pool);await second.persistence.initialize();
  assert.equal(second.auth.lookup(token).userId,user.id);
  assert.ok(second.store.data.users.some(value=>value.id===user.id));
  assert.ok(second.store.data.cards.some(value=>value.id==='persisted-card'));
  assert.equal(second.store.data.cardRewardPurchases[0].rewardCents,200);
  await second.persistence.run(()=>assert.equal(second.auth.lookup(second.auth.login(user.email,'persisted-test-password')).userId,user.id));
});

test('initialization preserves existing data and each run reloads a newer committed snapshot',async t=>{
  const {pool}=database(t),first=instance(pool);await first.persistence.initialize();
  const stale=instance(pool);await stale.persistence.initialize();
  await first.persistence.run(()=>{first.store.data.futureField={preserved:true};first.store.data.cards.push({id:'from-first'});});
  await stale.persistence.run(()=>{assert.ok(stale.store.data.cards.some(card=>card.id==='from-first'));stale.store.data.cards.push({id:'from-second'});});
  const restarted=instance(pool);await restarted.persistence.initialize();
  assert.ok(restarted.store.data.cards.some(card=>card.id==='from-first'));
  assert.ok(restarted.store.data.cards.some(card=>card.id==='from-second'));
  assert.deepEqual(restarted.store.data.futureField,{preserved:true});
  assert.equal(Number((await pool.query('SELECT count(*) AS count FROM pp_portal_snapshots')).rows[0].count),1);
});

test('overlapping local requests are serialized across asynchronous work and preserve both updates',async t=>{
  const {pool}=database(t),app=instance(pool);await app.persistence.initialize();
  const started=deferred(),release=deferred();let secondEntered=false;
  const first=app.persistence.run(async()=>{app.store.data.requestCount=1;started.resolve();await release.promise;assert.equal(secondEntered,false);return 'first';});
  await started.promise;
  const second=app.persistence.run(()=>{secondEntered=true;app.store.data.requestCount++;return 'second';});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(secondEntered,false);
  release.resolve();assert.deepEqual(await Promise.all([first,second]),['first','second']);
  assert.equal((await app.persistence.readSnapshot()).state.requestCount,2);
});

test('callback failure rolls back auth and state together, restores local data, and leaves the queue usable',async t=>{
  const {pool}=database(t),app=instance(pool);await app.persistence.initialize();
  await assert.rejects(app.persistence.run(()=>{addAccount(app);throw Object.assign(new Error('Later validation failed.'),{code:'REJECTED'});}),{code:'REJECTED'});
  assert.equal(app.auth.data.users.length,0);
  assert.equal(app.store.data.users.some(user=>!user.sample),false);
  const reopened=instance(pool);await reopened.persistence.initialize();
  assert.equal(reopened.auth.data.users.length,0);assert.equal(reopened.store.data.cards.some(card=>card.id==='persisted-card'),false);
  await app.persistence.run(()=>addAccount(app));assert.equal((await app.persistence.readSnapshot()).auth.users.length,1);
});

test('run resolves only after COMMIT completes',async t=>{
  const {pool}=database(t),commitStarted=deferred(),releaseCommit=deferred();let hold=false;
  const wrapped={query:(...args)=>pool.query(...args),connect:async()=>{
    const client=await pool.connect();return {release:()=>client.release(),query:async(sql,...args)=>{if(hold&&sql==='COMMIT'){commitStarted.resolve();await releaseCommit.promise;}return client.query(sql,...args);}};
  }};
  const app=instance(wrapped);await app.persistence.initialize();hold=true;let completed=false;
  const request=app.persistence.run(()=>addAccount(app)).then(value=>{completed=true;return value;});
  await commitStarted.promise;assert.equal(completed,false);releaseCommit.resolve();await request;assert.equal(completed,true);
});

test('a failed database commit reports failure and cannot leave a partially saved account',async t=>{
  const {pool,memory}=database(t);let failCommit=false;
  // pg-mem does not implement transaction rollback. This failure-injection
  // wrapper supplies it; actual cross-process row locking requires PostgreSQL.
  const wrapped={query:(...args)=>pool.query(...args),connect:async()=>{
    const client=await pool.connect();let backup;return {release:()=>client.release(),query:async(sql,...args)=>{
      if(sql.startsWith('BEGIN'))backup=memory.backup();
      if(sql==='COMMIT'&&failCommit){failCommit=false;throw new Error('Database commit unavailable.');}
      if(sql==='ROLLBACK')backup.restore();
      return client.query(sql,...args);
    }};
  }};
  const app=instance(wrapped);await app.persistence.initialize();failCommit=true;
  await assert.rejects(app.persistence.run(()=>addAccount(app)),/commit unavailable/);
  assert.equal(app.auth.data.users.length,0);assert.equal(app.store.data.cards.some(card=>card.id==='persisted-card'),false);
  const reopened=instance(pool);await reopened.persistence.initialize();
  assert.equal(reopened.auth.data.users.length,0);assert.equal(reopened.store.data.cardRewardPurchases.length,0);
  await app.persistence.run(()=>addAccount(app));assert.equal((await app.persistence.readSnapshot()).auth.users.length,1);
});

test('readSnapshot reads durable identity without replacing an in-flight request state',async t=>{
  const {pool}=database(t),app=instance(pool);await app.persistence.initialize();
  const durable=await app.persistence.run(()=>addAccount(app));
  await app.persistence.run(async()=>{
    app.auth.logout(durable.token);const activeAuth=app.auth.data,activeState=app.store.data;
    const snapshot=await app.persistence.readSnapshot();
    assert.ok(snapshot.auth.sessions.some(session=>session.digest===digest(durable.token)));
    assert.equal(app.auth.lookup(durable.token),null);assert.equal(app.auth.data,activeAuth);assert.equal(app.store.data,activeState);
    snapshot.state.cards.length=0;assert.ok(app.store.data.cards.length>0);
  });
  assert.equal((await app.persistence.readSnapshot()).auth.sessions.length,0);
});

test('malformed or unsupported persisted snapshots fail closed instead of resetting accounts',async t=>{
  for(const snapshot of [{version:999,state:{},auth:{}},{version:1,state:{users:[],cards:[]},auth:{users:{},sessions:[]}},{version:1,state:null,auth:{users:[],sessions:[]}}]){
    const {pool}=database(t),app=instance(pool);await app.persistence.initialize();
    await pool.query('UPDATE pp_portal_snapshots SET snapshot=$1',[snapshot]);
    const next=instance(pool);await assert.rejects(next.persistence.initialize(),{code:'PORTAL_SNAPSHOT_INVALID'});
    let invoked=false;await assert.rejects(app.persistence.run(()=>{invoked=true;}),{code:'PORTAL_SNAPSHOT_INVALID'});assert.equal(invoked,false);
    await assert.rejects(app.persistence.readSnapshot(),{code:'PORTAL_SNAPSHOT_INVALID'});
    assert.deepEqual((await pool.query('SELECT snapshot FROM pp_portal_snapshots')).rows[0].snapshot,snapshot);
  }
});

test('a callback that corrupts the snapshot is rejected before persistence',async t=>{
  const {pool}=database(t),app=instance(pool);await app.persistence.initialize();
  await assert.rejects(app.persistence.run(()=>{app.auth.data.sessions=null;}),{code:'PORTAL_SNAPSHOT_INVALID'});
  assert.deepEqual(app.auth.data.sessions,[]);assert.deepEqual((await app.persistence.readSnapshot()).auth.sessions,[]);
});
