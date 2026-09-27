import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './server.js';
import { createConnectedApplication } from './connected-server.js';
import { createPortalPersistence } from './portal-persistence.js';
import { withPortalPersistence } from './portal-persistence-http.js';

const localHost = value => ['localhost', '127.0.0.1', '::1'].includes(value);

export function createIntegratedApplication(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const storePort = Number(options.storePort ?? process.env.STORE_PORT ?? 3001);
  const configuredOrigin = options.origin || process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  const parsed = configuredOrigin ? new URL(configuredOrigin) : null;
  const origin = parsed && !localHost(parsed.hostname) ? parsed.origin : `http://localhost:${port}`;
  const portalStorage = options.portalStorage || process.env.PERKPILOT_PORTAL_STORAGE || 'file';
  if (!['file','postgres'].includes(portalStorage)) throw new Error('Invalid portal storage configuration.');
  const demo = createApplication({ ...(options.demoOptions || {}), ...(portalStorage==='postgres'?{persist:false}:{}), port, storePort, origin });
  // Identity comes only from the portal's verified cookie, never client-supplied
  // headers, email matching, bearer tokens, or a previous connected session.
  const portalIdentity = req => {
    const token = req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('perkpilot_session='))?.slice('perkpilot_session='.length);
    const session = demo.auth.lookup(token);
    if (session?.kind !== 'portal') return null;
    const user = demo.store.data.users.find(value=>value.id === session.userId);
    if (!user || user.sample) return null;
    return { id:user.id, name:user.name, email:user.email, sessionDigest:session.digest };
  };
  const connected = createConnectedApplication({ ...(options.connectedOptions || {}), origin, portalIdentity });
  const portalPersistence = portalStorage==='postgres' ? createPortalPersistence({pool:connected.db.pool,store:demo.store,auth:demo.auth}) : null;
  const route = (req, res) => {
    let pathname;
    try{pathname=new URL(req.url,origin).pathname;}
    catch{res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":{"code":"INVALID_URL","message":"Invalid request URL."}}');return;}
    const connectedRoute = pathname === '/api' || pathname.startsWith('/api/');
    const demoRoute = pathname === '/api/v1' || pathname.startsWith('/api/v1/');
    return connectedRoute && !demoRoute ? connected.handler(req, res) : demo.handler(req, res);
  };
  const handler = portalPersistence ? withPortalPersistence(portalPersistence,route) : route;
  return {
    server:createServer(handler),
    merchant:portalPersistence ? createServer(withPortalPersistence(portalPersistence,demo.handler)) : demo.createStoreServer(),
    demo,
    connected,
    portalPersistence,
    origin,
    port,
    storePort,
    migrate:async()=>{await connected.migrate();await portalPersistence?.initialize();},
    close:async()=>{ demo.store.save(); await connected.db.close(); }
  };
}

export async function startIntegratedApplication(options = {}) {
  const app = createIntegratedApplication(options);
  await app.migrate();
  const closeServer = server => new Promise(resolveClose => server.listening ? server.close(resolveClose) : resolveClose());
  const fail = error => {
    console.error(`Cannot start integrated PerkPilot: ${error.code || error.message}.`);
    process.exitCode = 1;
    closeServer(app.server); closeServer(app.merchant); app.connected.db.close();
  };
  app.server.on('error', fail); app.merchant.on('error', fail);
  app.server.listen(app.port, '0.0.0.0', () => console.log(`PerkPilot: ${app.origin} (full app + connected services)`));
  app.merchant.listen(app.storePort, '127.0.0.1', () => console.log(`Controlled storefront: http://localhost:${app.storePort}/store?product=alo-jacket`));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async()=>{
    app.demo.store.save();
    await Promise.all([closeServer(app.server), closeServer(app.merchant), app.connected.db.close()]);
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startIntegratedApplication().catch(error=>{ console.error(`Cannot start integrated PerkPilot: ${error.message}`); process.exitCode=1; });
}
