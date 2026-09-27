import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDatabase} from '../src/connected-db.js';
import {createCheckoutRepository} from '../src/checkout-repository.js';
import {createCheckoutMerchant} from '../src/checkout-merchant.js';
import {assertCheckoutDemoConfig,checkoutDemoConfig,createCheckoutDemoControls} from '../src/checkout-demo.js';

export async function runCheckoutDemo(args=process.argv.slice(2),env=process.env) {
  const [command,...flags]=args;
  if(!['seed','arm','clear'].includes(command))throw Object.assign(new Error('Use seed, arm --subject portal:<uuid> --scenario price-increase|prompt-injection, or clear --subject portal:<uuid>.'),{code:'INVALID_DEMO_COMMAND'});
  const fields={};
  for(let index=0;index<flags.length;index+=2){
    const name=flags[index],value=flags[index+1];
    if(!['--subject','--scenario'].includes(name) || !value || fields[name]!==undefined)throw Object.assign(new Error('Use only the documented subject and scenario flags.'),{code:'INVALID_DEMO_COMMAND'});
    fields[name]=value;
  }
  if(command==='seed' && flags.length || command==='clear' && (!fields['--subject'] || fields['--scenario']) || command==='arm' && (!fields['--subject'] || !fields['--scenario']))throw Object.assign(new Error('Supply the required flags for this presenter command.'),{code:'INVALID_DEMO_COMMAND'});
  const config=checkoutDemoConfig(env);assertCheckoutDemoConfig(config);
  const database=createDatabase(config.databaseUrl);
  try {
    const repository=createCheckoutRepository({pool:database.pool,demoConfig:config});
    const merchant=createCheckoutMerchant({repository,providerAccountId:config.providerAccountId});
    const controls=createCheckoutDemoControls({repository,merchant,config});
    if(command==='seed')return await controls.seed();
    if(command==='arm')return await controls.arm({subjectKey:fields['--subject'],scenario:fields['--scenario']});
    return await controls.clear({subjectKey:fields['--subject']});
  }finally{await database.close();}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runCheckoutDemo().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(`Presenter controls unavailable: ${/^[A-Z_]{1,80}$/.test(error.code || '')?error.code:'DEMO_CONFIGURATION_ERROR'}. No shared product price or policy was changed.`);process.exitCode=1;});
}
