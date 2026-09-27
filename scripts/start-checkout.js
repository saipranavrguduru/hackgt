import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveCheckoutOrigin} from '../src/checkout-origin.js';

export async function startCheckoutApplication(options={}) {
 const {createIntegratedApplication}=await import('../src/integrated-server.js');
 const {createCheckoutRuntime}=await import('../src/checkout-runtime.js');
 const origin=resolveCheckoutOrigin({origin:options.checkoutOptions?.config?.origin,port:options.port});
 const host=['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)?'127.0.0.1':'0.0.0.0';
 const app=createIntegratedApplication({...options,origin});
 let checkout;
 const closeServer=server=>new Promise(resolveClose=>server.listening?server.close(resolveClose):resolveClose());
 const close=async()=>{await checkout?.close();await Promise.all([closeServer(app.server),closeServer(app.merchant)]);await app.close();};
 try {
  await app.migrate();
  checkout=await createCheckoutRuntime({auth:app.demo.auth,store:app.demo.store,...options.checkoutOptions,config:{origin,resolveCatalogReference:app.connected.resolveCatalogReference,...(app.portalPersistence?{readPortalSnapshot:()=>app.portalPersistence.readSnapshot()}:{}),...options.checkoutOptions?.config}});
  if(checkout.capabilities().enabled)app.demo.setCheckoutRuntime(checkout);
  await checkout.start();
  await new Promise((resolveListen,reject)=>{app.server.once('error',reject);app.server.listen(app.port,host,resolveListen);});
  await new Promise((resolveListen,reject)=>{app.merchant.once('error',reject);app.merchant.listen(app.storePort,'127.0.0.1',resolveListen);});
  console.log(`PerkPilot: ${app.origin} (checkout ${checkout.capabilities().enabled?'enabled':'disabled'})`);
  let shuttingDown=false;
  const shutdown=async()=>{if(shuttingDown)return;shuttingDown=true;await close();};
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>shutdown().catch(()=>{process.exitCode=1;}));
  app.server.on('error',()=>{process.exitCode=1;shutdown().catch(()=>{});});app.merchant.on('error',()=>{process.exitCode=1;shutdown().catch(()=>{});});
  return {...app,checkout,close:shutdown};
 }catch(error){await close();throw error;}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 startCheckoutApplication().catch(error=>{console.error(`Checkout startup unavailable: ${error.code || 'CONFIGURATION_ERROR'}. Verify configuration and run the explicit checkout migration; ordinary npm run dev does not require Stripe.`);process.exitCode=1;});
}
