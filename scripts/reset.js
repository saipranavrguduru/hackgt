import { StateStore } from '../src/state.js';
import { fileURLToPath } from 'node:url';
const store=new StateStore(fileURLToPath(new URL('../data/state.json',import.meta.url)));
store.resetSamples();
console.log('Sample profiles reset. Registered profiles preserved. Run this only while the server is stopped.');
