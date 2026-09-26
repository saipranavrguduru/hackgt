import { createSerpApiClient } from '../src/serpapi.js';

const catalog = createSerpApiClient();
try {
  if (!catalog.configured) throw new Error('Set SERPAPI_API_KEY in the environment.');
  const result = await catalog.search('noise cancelling headphones');
  console.log(`PASS: SerpApi Google Shopping returned ${result.products.length} usable USD listings.`);
} catch (error) {
  console.error(`SerpApi verification failed: ${error.code || error.message}`);
  process.exitCode = 1;
}
