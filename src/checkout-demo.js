import {fail,requireValue} from './errors.js';

export const CHECKOUT_DEMO_SCENARIOS=Object.freeze(['price-increase','prompt-injection']);
const subjectValid=value=>typeof value==='string' && /^portal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const loopback=host=>['localhost','127.0.0.1','[::1]'].includes(host);

export function checkoutDemoConfig(env=process.env) {
  return {enabled:env.PERKPILOT_CHECKOUT_ENABLED==='1',demoControls:env.PERKPILOT_CHECKOUT_DEMO_CONTROLS==='1',
    origin:env.CHECKOUT_ORIGIN || `http://localhost:${env.PORT || 3000}`,databaseUrl:env.DATABASE_URL,providerAccountId:env.STRIPE_EXPECTED_ACCOUNT_ID};
}

export function assertCheckoutDemoConfig(config={}) {
  requireValue(config.enabled===true && config.demoControls===true,'DEMO_CONTROLS_DISABLED','Enable checkout and local presenter controls explicitly.',403);
  let origin,database;try{origin=new URL(config.origin);database=new URL(config.databaseUrl);}catch{fail('DEMO_LOCAL_FIXTURE_REQUIRED','Presenter controls require an exact loopback checkout origin and local PostgreSQL fixture.',403);}
  requireValue(origin.protocol==='http:' && loopback(origin.hostname) && origin.origin===config.origin &&
    ['postgres:','postgresql:'].includes(database.protocol) && loopback(database.hostname) && database.pathname.length>1,
    'DEMO_LOCAL_FIXTURE_REQUIRED','Presenter controls require an exact loopback checkout origin and local PostgreSQL fixture.',403);
  requireValue(typeof config.providerAccountId==='string' && /^acct_[A-Za-z0-9_]+$/.test(config.providerAccountId),'DEMO_TEST_ACCOUNT_REQUIRED','Configure the expected test provider account.',403);
  return true;
}

export function createCheckoutDemoControls({repository,merchant,config=checkoutDemoConfig()}={}) {
  assertCheckoutDemoConfig(config);
  const requireSubject=subjectKey=>requireValue(subjectValid(subjectKey),'REGISTERED_USER_REQUIRED','Use a registered portal:<uuid> subject.',403);
  async function seed() {assertCheckoutDemoConfig(config);await merchant.seed();return{action:'seed',status:'ready',merchant:'PerkPilot Test Store'};}
  async function arm({subjectKey,scenario}) {
    assertCheckoutDemoConfig(config);requireSubject(subjectKey);
    requireValue(CHECKOUT_DEMO_SCENARIOS.includes(scenario),'INVALID_DEMO_SCENARIO','Choose price-increase or prompt-injection.');
    return repository.transaction(async tx=>{
      const subject=(await tx.query('SELECT * FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[subjectKey])).rows[0];
      requireValue(subject && subject.provider_account_id===config.providerAccountId && subject.revoked_at===null,'DEMO_SUBJECT_REQUIRED','Use the enrolled presenter subject in this test-account fixture.',403);
      const methods=(await tx.query('SELECT id FROM pp_checkout_methods WHERE subject_key=$1 AND provider_account_id=$2 AND active=true',[subjectKey,config.providerAccountId])).rows;
      requireValue(methods.length>0,'DEMO_SUBJECT_REQUIRED','Enroll a test method before arming the presenter subject.',403);
      await tx.query('INSERT INTO pp_checkout_demo_scenarios(subject_key,name,armed_at) VALUES($1,$2,$3) ON CONFLICT(subject_key) DO UPDATE SET name=EXCLUDED.name,armed_at=EXCLUDED.armed_at',[subjectKey,scenario,repository.now()]);
      return {action:'arm',status:'armed',scenario,subjectKey};
    });
  }
  async function clear({subjectKey}) {
    assertCheckoutDemoConfig(config);requireSubject(subjectKey);
    await repository.transaction(async tx=>{
      await tx.query('SELECT subject_key FROM pp_checkout_subjects WHERE subject_key=$1 FOR UPDATE',[subjectKey]);
      await tx.query('DELETE FROM pp_checkout_demo_scenarios WHERE subject_key=$1',[subjectKey]);
    });
    return {action:'clear',status:'cleared',subjectKey};
  }
  return {seed,arm,clear};
}
