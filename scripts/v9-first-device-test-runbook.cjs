const fs=require('fs');
const path=require('path');
function read(rel){return JSON.parse(fs.readFileSync(path.join(process.cwd(),rel),'utf8'));}
function fail(msg){console.error(`BLOCKED: ${msg}`);process.exitCode=1;}
const rollout=read('data/v9/rollout-config.json');
const self=read('data/v9/self-enrollment-config.json');
const access=read('data/v9/access-readiness.json');
const policy=read('data/v9/device-test-policy.json');
const checks=[
  ['rollout stage is preview',rollout.stage==='preview'],
  ['random canary is 0%',Number(rollout.canaryPercent)===0],
  ['kill switch is off',rollout.killSwitch!==true],
  ['canary target is v9-app',rollout.canaryPath==='v9-app/'],
  ['self-enroll starts disabled',self.enabled===false],
  ['self-enroll token hash starts empty',!String(self.tokenSha256||'').trim()],
  ['self-enroll readiness starts unapproved',self.readinessApproved===false],
  ['access readiness starts BLOCKED',access.verdict==='BLOCKED'&&access.ready===false],
  ['device-test policy starts disabled',policy.enabled===false],
  ['device-test requires canary 0%',policy.requireCanaryPercentZero!==false],
  ['device-test auto-closes on rollback',policy.autoCloseOnRollback!==false]
];
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)process.exitCode=1;}
if(process.exitCode){fail('repository is not in the required closed pre-test state');return;}
console.log('\nREADY_TO_PREPARE');
console.log('1. Confirm current HEAD CI: production readiness, access gateway, controlled device test, console safety, rollout safety, shadow parity must all be success.');
console.log('2. Open v9-device-test-console/ and generate a 1-device window (recommended 30-60 min).');
console.log('3. Save the clear token only on the test device; commit/apply only the generated SHA-256/config OPEN plan.');
console.log('4. Wait for CI on the OPEN-plan HEAD; if any required gate fails, apply CLOSE immediately and do not enter v9-gate/.');
console.log('5. On the enrolled device, activate self-enroll with the clear token, then enter v9-gate/. Confirm source=self_enroll and target v9-app/.');
console.log('6. Perform at least 10 representative queries. Stop immediately on routing/source error, readiness regression, latency rollback signal, or unexpected V8/V9 routing.');
console.log('7. Evaluate device-test telemetry. PASS or ROLLBACK both require the CLOSE plan.');
console.log('8. Apply CLOSE: self-enroll disabled, token hash cleared, access readiness BLOCKED, device-test policy disabled.');
console.log('9. Confirm post-close CI and verify v9-gate/ returns the device to V8. Random canary remains 0% throughout.');
