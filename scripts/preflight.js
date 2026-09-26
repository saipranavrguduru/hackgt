import { providerReadiness } from '../src/providers.js';
const result=providerReadiness();
console.log(`${result.ready?'PASS':'UNAVAILABLE'}: ${result.message}`);
for(const item of result.missing) console.log(`Missing: ${item}`);
process.exitCode=result.ready?0:1;
