import test from 'node:test';
import assert from 'node:assert/strict';
import {newDb} from 'pg-mem';
import pg from 'pg';
import {createDatabase} from '../src/connected-db.js';

test('configured PostgreSQL connections use only the validated schema search path',async()=>{
  const database=createDatabase('postgresql://fixture@localhost/fixture',null,{schema:'perkpilot_hosted'});
  try{assert.equal(new pg.Client(database.pool.options).connectionParameters.options,'-c search_path=perkpilot_hosted');}finally{await database.close();}
  const conflicting=createDatabase('postgresql://fixture@localhost/fixture?options=-c%20search_path%3Dpublic',null,{schema:'perkpilot_hosted'});
  try{assert.equal(new pg.Client(conflicting.pool.options).connectionParameters.options,'-c search_path=perkpilot_hosted');}finally{await conflicting.close();}
  for(const schema of ['Public','hosted,public','hosted;DROP SCHEMA public','hosted"',' hosted','hosted-name','1hosted','a'.repeat(64),null]){
    assert.throws(()=>createDatabase('postgresql://fixture@localhost/fixture',null,{schema}),{code:'INVALID_DATABASE_SCHEMA'},String(schema));
  }
});

test('schema environment default is opt-in and an empty schema preserves legacy pool configuration',async()=>{
  const previous=process.env.PERKPILOT_DATABASE_SCHEMA;
  try{
    process.env.PERKPILOT_DATABASE_SCHEMA='perkpilot_hosted';
    const hosted=createDatabase('postgresql://fixture@localhost/fixture');
    try{assert.equal(hosted.pool.options.options,'-c search_path=perkpilot_hosted');}finally{await hosted.close();}
    const legacy=createDatabase('postgresql://fixture@localhost/fixture',null,{schema:''});
    try{assert.equal(legacy.pool.options.options,undefined);}finally{await legacy.close();}
    delete process.env.PERKPILOT_DATABASE_SCHEMA;
    const defaultDatabase=createDatabase('postgresql://fixture@localhost/fixture');
    try{assert.equal(defaultDatabase.pool.options.options,undefined);}finally{await defaultDatabase.close();}
  }finally{if(previous===undefined)delete process.env.PERKPILOT_DATABASE_SCHEMA;else process.env.PERKPILOT_DATABASE_SCHEMA=previous;}
});

test('explicit schema initialization is idempotent and construction does not mutate the database',async t=>{
  const memory=newDb({noAstCoverageCheck:true}),{Pool}=memory.adapters.createPg(),pool=new Pool();
  const database=createDatabase(null,pool,{schema:'perkpilot_hosted'});t.after(()=>database.close());
  assert.throws(()=>memory.getSchema('perkpilot_hosted'));
  await database.initializeSchema();await database.initializeSchema();
  assert.ok(memory.getSchema('perkpilot_hosted'));
  assert.equal((await pool.query('SELECT table_name FROM information_schema.tables')).rows.length,0,'initializing the namespace must not create or mutate public tables');
  const legacy=createDatabase(null,{query:()=>assert.fail('No schema was requested.'),end:async()=>{}},{schema:''});
  await legacy.initializeSchema();await legacy.close();
});

test('connected migrations initialize the namespace first without changing injected pool ownership',async t=>{
  const memory=newDb({noAstCoverageCheck:true}),{Pool}=memory.adapters.createPg(),pool=new Pool();
  const commands=[];const query=pool.query.bind(pool);pool.query=(sql,params)=>{commands.push(sql);return query(sql,params);};
  const database=createDatabase(null,pool,{schema:'perkpilot_hosted'});t.after(()=>database.close());
  assert.equal(database.pool,pool);assert.equal(commands.length,0);
  await database.migrate();
  assert.equal(commands[0],'CREATE SCHEMA IF NOT EXISTS "perkpilot_hosted"');
  assert.ok(memory.getSchema('perkpilot_hosted'));assert.ok(commands.some(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS connected_users')));
});
