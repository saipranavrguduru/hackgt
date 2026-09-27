import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { createDatabase } from '../src/connected-db.js';
import { createIntegratedApplication } from '../src/integrated-server.js';

test('one origin serves the original portal and connected provider APIs', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = createDatabase(null, new Pool());
  const port = 36000 + Math.floor(Math.random() * 10000);
  const app = createIntegratedApplication({
    port,
    storePort:port + 1,
    demoOptions:{persist:false},
    connectedOptions:{
      db,
      plaid:{configured:true,environment:'sandbox'},
      ai:{configured:true},
      serpapi:{configured:false},
      ebay:{configured:false},
      shopify:{configured:false}
    }
  });
  await app.migrate();
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  try {
    const portal = await fetch(`http://localhost:${port}/`);
    assert.equal(portal.status,200);
    assert.match(await portal.text(), /connected-ui\.js/);
    const demoHealth = await fetch(`http://localhost:${port}/api/v1/health`).then(response=>response.json());
    assert.equal(demoHealth.synthetic,true);
    const connectedHealth = await fetch(`http://localhost:${port}/api/health`).then(response=>response.json());
    assert.deepEqual(connectedHealth,{database:'ready',plaid:'sandbox',ai:true,catalog:'unconfigured'});
  } finally {
    await new Promise(resolve=>app.server.close(resolve));
    await db.close();
  }
});
