const fs=require('fs');
const path=require('path');
function read(rel){return JSON.parse(fs.readFileSync(path.join(process.cwd(),rel),'utf8'));}
function fail(msg){console.error(`BLOCKED: ${msg}`);process.exitCode=1;}
const rollout=read('data/v9/rollout-config.json');
const self=read('data/v9/self-enrollment-config.json');
const access=read('data/v9/access-readiness.json');
const policy=read('data/v9/device-test-policy.json');
const canaryPolicy=read('data/v9/canary-policy.json');

const common=[
  ['rollout stage is preview or canary',['preview','canary'].includes(rollout.stage)],
  ['kill switch is off',rollout.killSwitch!==true],
  ['canary target is v9-app',rollout.canaryPath==='v9-app/'],
  ['production candidate is v9-app',rollout.productionPath==='v9-app/'],
  ['device-test requires canary 0% when enabled',policy.requireCanaryPercentZero!==false],
  ['device-test auto-closes on rollback',policy.autoCloseOnRollback!==false]
];
for(const [name,ok] of common){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)process.exitCode=1;}
if(process.exitCode){fail('common safety invariants failed');return;}

const closed =
  rollout.stage==='preview' && Number(rollout.canaryPercent)===0 &&
  self.enabled===false && self.readinessApproved===false && !String(self.tokenSha256||'').trim() && self.expiresAt===null &&
  access.verdict==='BLOCKED' && access.ready===false && policy.enabled===false && canaryPolicy.active===false;

const hash=String(self.tokenSha256||'').trim().toLowerCase();
const expiresAt=Date.parse(self.expiresAt);
const updatedAt=Date.parse(access.updatedAt);
const maxWindowMs=60*60*1000;
const controlledOpen =
  rollout.stage==='preview' && Number(rollout.canaryPercent)===0 && canaryPolicy.active===false &&
  self.enabled===true && self.requireReadiness!==false && self.readinessApproved===true && /^[a-f0-9]{64}$/.test(hash) &&
  String(self.tokenVersion||'').trim().length>0 && Number.isFinite(expiresAt) && expiresAt>Date.now() &&
  Number(self.maxGrantMinutes)>=1 && Number(self.maxGrantMinutes)<=60 &&
  access.verdict==='READY' && access.ready===true && Number.isFinite(updatedAt) && expiresAt>updatedAt && expiresAt-updatedAt<=maxWindowMs &&
  policy.enabled===true && policy.requireReadiness===true && policy.requireCanaryPercentZero===true && policy.autoCloseOnRollback===true &&
  Number(policy.maxWindowMinutes)>=1 && Number(policy.maxWindowMinutes)<=60 &&
  Number(policy.minimumRuns)>=10 && Number(policy.minimumSuccessfulRuns)>=10;

const initialPercent=Number(canaryPolicy.initialPercent||1);
const canary =
  rollout.stage==='canary' && Number(rollout.canaryPercent)===initialPercent && initialPercent===1 && canaryPolicy.active===true &&
  rollout.v8Path==='v8-app/' && rollout.killSwitch===false && rollout.requireReadiness!==false &&
  access.verdict==='READY' && access.ready===true &&
  self.enabled===false && self.readinessApproved===false && !String(self.tokenSha256||'').trim() && self.expiresAt===null &&
  policy.enabled===false;

if(!closed && !controlledOpen && !canary){fail('repository is neither strict CLOSED, valid CONTROLLED_OPEN, nor valid 1% CANARY state');return;}

if(closed){
  console.log('\nREPOSITORY_STATE=CLOSED');
  console.log('READY_TO_PREPARE');
  console.log('1. Confirm current HEAD CI: production readiness, access gateway, controlled device test, console safety, rollout safety, shadow parity must all be success.');
  console.log('2. Open v9-device-test-console/ and generate a 1-device window (recommended 30-60 min).');
  console.log('3. Save the clear token only on the test device; commit/apply only the generated SHA-256/config OPEN plan.');
  console.log('4. Wait for CI on the OPEN-plan HEAD; if any required gate fails, apply CLOSE immediately and do not enter v9-gate/.');
}else if(controlledOpen){
  console.log('\nREPOSITORY_STATE=CONTROLLED_OPEN');
  console.log(`WINDOW_EXPIRES_AT=${new Date(expiresAt).toISOString()}`);
  console.log('OPEN plan safety invariants OK. Clear token is not stored; only a SHA-256 hash is configured.');
  console.log('If any required CI gate fails, apply CLOSE immediately.');
}else{
  console.log('\nREPOSITORY_STATE=CANARY');
  console.log(`CANARY_PERCENT=${initialPercent}`);
  console.log('Random canary is active at the exact approved initial stage. Self-enrollment and controlled-device testing remain disabled.');
  console.log('Non-canary traffic remains on the isolated V8 fallback; readiness and kill-switch gates remain enforced.');
}
