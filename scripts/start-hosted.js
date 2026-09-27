import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDatabase} from '../src/connected-db.js';
import {resolveCheckoutOrigin} from '../src/checkout-origin.js';
import {startCheckoutApplication} from './start-checkout.js';

export async function startHostedApplication(options={}) {
  const origin=resolveCheckoutOrigin({origin:options.checkoutOptions?.config?.origin});
  if(new URL(origin).protocol!=='https:')throw Object.assign(new Error('Hosted deployment requires HTTPS.'),{code:'HTTPS_REQUIRED'});
  if(process.env.PERKPILOT_CHECKOUT_DEMO_CONTROLS==='1')throw Object.assign(new Error('Presenter controls are local only.'),{code:'HOSTED_DEMO_CONTROLS_FORBIDDEN'});
  const enabled=options.checkoutOptions?.config?.enabled ?? process.env.PERKPILOT_CHECKOUT_ENABLED==='1';
  const db=options.connectedOptions?.db || createDatabase(undefined,null,{schema:process.env.PERKPILOT_DATABASE_SCHEMA || 'perkpilot_hosted'});
  try {
    await db.initializeSchema();
    if(enabled) {
      // Free Render services have no pre-deploy job. This explicit hosted
      // entrypoint performs idempotent schema setup and controlled merchant seed.
      const {createCheckoutRepository}=await import('../src/checkout-repository.js');
      const {createCheckoutMerchant}=await import('../src/checkout-merchant.js');
      const repository=createCheckoutRepository({pool:db.pool});
      await repository.migrate();
      if(!process.env.STRIPE_EXPECTED_ACCOUNT_ID)throw Object.assign(new Error('Test account required.'),{code:'STRIPE_ACCOUNT_REQUIRED'});
      await createCheckoutMerchant({repository,providerAccountId:process.env.STRIPE_EXPECTED_ACCOUNT_ID}).seed();
    }
    return await startCheckoutApplication({...options,portalStorage:'postgres',connectedOptions:{...options.connectedOptions,db},
      checkoutOptions:{...options.checkoutOptions,pool:db.pool,config:{...options.checkoutOptions?.config,enabled,origin}}
    });
  }catch(error){await db.close().catch(()=>{});throw error;}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  startHostedApplication().catch(error=>{
    console.error(`Hosted startup unavailable: ${error.code || 'CONFIGURATION_ERROR'}. Check the Render environment settings.`);
    process.exitCode=1;
  });
}
