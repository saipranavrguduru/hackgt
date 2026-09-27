import {createDatabase} from '../src/connected-db.js';
import {createCheckoutRepository} from '../src/checkout-repository.js';
import {createCheckoutMerchant} from '../src/checkout-merchant.js';

// Explicit operator command only; checkout runtime never runs connected migrations.
const database=createDatabase(process.env.DATABASE_URL);
try {
  const repository=createCheckoutRepository({pool:database.pool});
  await repository.migrate();
  if (process.argv.includes('--seed')) {
    if (!process.env.STRIPE_EXPECTED_ACCOUNT_ID) throw new Error('STRIPE_EXPECTED_ACCOUNT_ID is required to seed the controlled merchant.');
    await createCheckoutMerchant({repository,providerAccountId:process.env.STRIPE_EXPECTED_ACCOUNT_ID}).seed();
  }
  console.log('Checkout schema v1 is ready.');
} finally {await database.close();}
