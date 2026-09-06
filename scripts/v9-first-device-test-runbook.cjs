const fs=require('fs');
const path=require('path');
function read(rel){return JSON.parse(fs.readFileSync(path.join(process.cwd(),rel),'utf8'));}
function fail(msg){console.error(`BLOCKED: ${msg}`);process.exitCode=1;}
const rollout=read('data/v9/rollout-config.json');
const self=read('data/v9/self-enrollment-config.json');
const access=read('data/v9/access-readiness.json');
const devicePolicy=read('data/v9/device-test-policy.json');
const canaryPolicy=read('data/v9/canary-policy.json');
const shell=fs.existsSync(path.join(process.cwd(),'ops/v9/production-shell-readiness.json'))
  ?read('ops/v9/production-shell-readiness.json')
  :null;

const common=[
  ['rollout stage is preview or canary',['preview','canary'].includes(rollout.stage)],
  ['kill switch is off',rollout.killSwitch!==true],
  ['canary target is v9-app',rollout.canaryPath==='v9-app/'],
  ['production candidate is v9-app',rollout.productionPath==='v9-app/'],
  ['device-test requires canary 0% when enabled',devicePolicy.requireCanaryPercentZero!==false],
  ['device-test auto-closes on rollback',devicePolicy.autoCloseOnRollback!==false]
];
for(const [name,ok] of common){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)process.exitCode=1;}
if(process.exitCode){fail('common safety invariants failed');return;}

const selfClosed=
  self.enabled===false && self.readinessApproved===false && !String(self.tokenSha256||'').trim() && self.expiresAt===null;
const deviceTestsClosed=devicePolicy.enabled===false;

// Historical pre-readiness state: both engine access and user exposure are closed.
const closed =
  rollout.stage==='preview' && Number(rollout.canaryPercent)===0 &&
  selfClosed && access.verdict==='BLOCKED' && access.ready===false &&
  deviceTestsClosed && canaryPolicy.active===false && (!shell || shell.ready===false);

// New two-gate state: engine evidence is READY, but the production user shell is
// explicitly BLOCKED. This is safer than the old CLOSED state for public traffic:
// validated engine evidence is retained while user exposure remains exactly 0%.
const engineReadyShellBlocked =
  !!shell && shell.state==='BLOCKED' && shell.ready===false && shell.controlPath==='./' &&
  rollout.stage==='preview' && Number(rollout.canaryPercent)===0 && rollout.v8Path===shell.controlPath &&
  canaryPolicy.active===false && access.verdict==='READY' && access.ready===true &&
  selfClosed && deviceTestsClosed;

const hash=String(self.tokenSha256||'').trim().toLowerCase();
const expiresAt=Date.parse(self.expiresAt);
const updatedAt=Date.parse(access.updatedAt);
const maxWindowMs=60*60*1000;
const controlledOpen =
  (!shell || shell.ready!==false) &&
  rollout.stage==='preview' && Number(rollout.canaryPercent)===0 && canaryPolicy.active===false &&
  self.enabled===true && self.requireReadiness!==false && self.readinessApproved===true && /^[a-f0-9]{64}$/.test(hash) &&
  String(self.tokenVersion||'').trim().length>0 && Number.isFinite(expiresAt) && expiresAt>Date.now() &&
  Number(self.maxGrantMinutes)>=1 && Number(self.maxGrantMinutes)<=60 &&
  access.verdict==='READY' && access.ready===true && Number.isFinite(updatedAt) && expiresAt>updatedAt && expiresAt-updatedAt<=maxWindowMs &&
  devicePolicy.enabled===true && devicePolicy.requireReadiness===true && devicePolicy.requireCanaryPercentZero===true && devicePolicy.autoCloseOnRollback===true &&
  Number(devicePolicy.maxWindowMinutes)>=1 && Number(devicePolicy.maxWindowMinutes)<=60 &&
  Number(devicePolicy.minimumRuns)>=10 && Number(devicePolicy.minimumSuccessfulRuns)>=10;

const initialPercent=Number(canaryPolicy.initialPercent||1);
const canary =
  (!shell || shell.ready===true) &&
  rollout.stage==='canary' && Number(rollout.canaryPercent)===initialPercent && initialPercent===1 && canaryPolicy.active===true &&
  rollout.killSwitch===false && rollout.requireReadiness!==false &&
  access.verdict==='READY' && access.ready===true &&
  selfClosed && deviceTestsClosed;

if(!closed && !engineReadyShellBlocked && !controlledOpen && !canary){
  fail('repository is neither strict CLOSED, ENGINE_READY_SHELL_BLOCKED, valid CONTROLLED_OPEN, nor valid 1% CANARY state');
  return;
}

if(engineReadyShellBlocked){
  console.log('\nREPOSITORY_STATE=ENGINE_READY_SHELL_BLOCKED');
  console.log('PUBLIC_USER_EXPOSURE_PERCENT=0');
  console.log('ENGINE_EVIDENCE=READY');
  console.log('Production user shell is not ready; public routing remains closed while the validated engine evidence is retained.');
  console.log('Do not open self-enrollment or random canary traffic until the production-shell readiness gate is READY.');
}else if(closed){
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
  console.log(`Non-canary traffic remains on the declared production control path: ${shell?.controlPath||rollout.v8Path}.`);
}
