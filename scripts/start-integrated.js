import { existsSync } from 'node:fs';

if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
const { startIntegratedApplication } = await import('../src/integrated-server.js');
await startIntegratedApplication();
