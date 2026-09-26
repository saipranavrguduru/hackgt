import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function files(path) { return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(path,entry.name)):[join(path,entry.name)]); }
let checked=0;
for(const dir of ['src','public','extension','scripts','tests']) if(existsSync(dir)) for(const file of files(dir)) if(file.endsWith('.js')) {
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0) { console.error(result.stderr); process.exit(1); } checked++;
}
for(const file of ['public/index.html','public/app.js','public/style.css','public/store.html','extension/manifest.json']) if(!existsSync(file)) throw new Error(`Required artifact missing: ${file}`);
const manifest=JSON.parse(readFileSync('extension/manifest.json','utf8'));
if(manifest.manifest_version!==3) throw new Error('Manifest V3 required');
console.log(`Static build passed: ${checked} JavaScript files checked; portal, storefront and MV3 manifest present. No bundling or TypeScript compilation is performed.`);
