import test from 'node:test';
import assert from 'node:assert/strict';
import {newDb} from 'pg-mem';
import {createDatabase} from '../src/connected-db.js';

test('hosted entrypoint starts the public listener with PostgreSQL portal persistence',async()=>{
  const {startHostedApplication}=await import('../scripts/start-hosted.js');
  const {Pool}=newDb().adapters.createPg();
  const app=await startHostedApplication({port:0,storePort:0,connectedOptions:{db:createDatabase(null,new Pool()),
    plaidOptions:{clientId:'',secret:''},aiOptions:{apiKey:'',geminiApiKey:''},serpapiOptions:{apiKey:''},
    ebayOptions:{clientId:'',clientSecret:''},shopifyOptions:{storeDomain:'',token:''}},
    checkoutOptions:{config:{origin:'https://perkpilot.example',enabled:false}}
  });
  try {
    assert.equal(app.server.address().address,'0.0.0.0');
    assert.equal(app.demo.auth.path,null);assert.equal(app.demo.store.path,null);
    assert.ok(app.portalPersistence);
    assert.equal((await app.portalPersistence.readSnapshot()).auth.users.length,0);
  }finally{await app.close();}
});

test('hosted startup rejects local HTTP and armed presenter controls before database access',async()=>{
  const {startHostedApplication}=await import('../scripts/start-hosted.js');
  await assert.rejects(startHostedApplication({checkoutOptions:{config:{origin:'http://localhost:3000'}}}),{code:'HTTPS_REQUIRED'});
  const previous=process.env.PERKPILOT_CHECKOUT_DEMO_CONTROLS;process.env.PERKPILOT_CHECKOUT_DEMO_CONTROLS='1';
  try {await assert.rejects(startHostedApplication({checkoutOptions:{config:{origin:'https://perkpilot.example'}}}),{code:'HOSTED_DEMO_CONTROLS_FORBIDDEN'});}
  finally{if(previous===undefined)delete process.env.PERKPILOT_CHECKOUT_DEMO_CONTROLS;else process.env.PERKPILOT_CHECKOUT_DEMO_CONTROLS=previous;}
});
