const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const cp=require('child_process');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'tcc-v9-preparer-'));
try{
  fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
  fs.mkdirSync(path.join(root,'data/v9'),{recursive:true});
  fs.copyFileSync('scripts/v9-prepare-first-device-window.cjs',path.join(root,'scripts/v9-prepare-first-device-window.cjs'));

  const rollout={...require('../data/v9/rollout-config.json'),stage:'preview',canaryPercent:0,killSwitch:false};
  const self={...require('../data/v9/self-enrollment-config.json'),enabled:false,readinessApproved:false,tokenSha256:'',expiresAt:null};
  const access={schemaVersion:1,verdict:'BLOCKED',ready:false,updatedAt:new Date().toISOString(),reason:'test fixture closed'};
  const policy={...require('../data/v9/device-test-policy.json'),enabled:false,requireReadiness:true,requireCanaryPercentZero:true,autoCloseOnRollback:true};
  fs.writeFileSync(path.join(root,'data/v9/rollout-config.json'),JSON.stringify(rollout));
  fs.writeFileSync(path.join(root,'data/v9/self-enrollment-config.json'),JSON.stringify(self));
  fs.writeFileSync(path.join(root,'data/v9/access-readiness.json'),JSON.stringify(access));
  fs.writeFileSync(path.join(root,'data/v9/device-test-policy.json'),JSON.stringify(policy));

  const out=cp.execFileSync(process.execPath,[path.join(root,'scripts/v9-prepare-first-device-window.cjs'),'30'],{cwd:root,encoding:'utf8'});
  const plan=JSON.parse(out);
  assert.equal(plan.type,'tcc-v9-first-device-window-plan');
  assert.equal(plan.minutes,30);
  assert.ok(plan.clearToken&&plan.clearToken.length>=40);
  assert.ok(plan.tokenVersion);
  const openSelf=plan.open['data/v9/self-enrollment-config.json'];
  const closeSelf=plan.close['data/v9/self-enrollment-config.json'];
  assert.equal(openSelf.enabled,true);
  assert.equal(openSelf.readinessApproved,true);
  assert.ok(openSelf.tokenSha256);
  assert.notEqual(openSelf.tokenSha256,plan.clearToken);
  assert.equal(plan.open['data/v9/access-readiness.json'].verdict,'READY');
  assert.equal(plan.open['data/v9/device-test-policy.json'].enabled,true);
  assert.equal(closeSelf.enabled,false);
  assert.equal(closeSelf.tokenSha256,'');
  assert.notEqual(closeSelf.tokenVersion,openSelf.tokenVersion);
  assert.ok(closeSelf.tokenVersion.endsWith('-closed'));
  assert.equal(plan.close['data/v9/access-readiness.json'].verdict,'BLOCKED');
  assert.equal(plan.close['data/v9/device-test-policy.json'].enabled,false);
  assert.equal(rollout.canaryPercent,0);
  assert.ok(!JSON.stringify(plan.open).includes(plan.clearToken));
  assert.ok(!JSON.stringify(plan.close).includes(plan.clearToken));
  const src=fs.readFileSync('scripts/v9-prepare-first-device-window.cjs','utf8');
  assert.ok(!src.includes('api.github.com'));
  assert.ok(!src.includes('update_file'));
  console.log(JSON.stringify({ok:true,module:'tcc-v9-first-device-window-preparer'},null,2));
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}
