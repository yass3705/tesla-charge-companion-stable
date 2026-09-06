const assert=require('node:assert/strict');
const path=require('node:path');

const enginePath=path.resolve(process.env.V9_ROLLOUT_ENGINE||'assets/v9/rollout-engine.js');
const Rollout=require(enginePath);

const ready={verdict:'READY',ready:true};
const blocked={verdict:'BLOCKED',ready:false};
const baseConfig={
  stage:'canary',
  canaryPercent:1,
  killSwitch:false,
  requireReadiness:true,
  salt:'tcc-v9-rollout-v1',
  v8Path:'./',
  previewPath:'v9-preview/',
  canaryPath:'v9-production-shell/',
  productionPath:'v9-production-shell/'
};

const identities=Array.from({length:10000},(_,i)=>`prod-smoke-${i}`);

let blockedV9=0;
for(const identity of identities){
  const decision=Rollout.decide({config:baseConfig,identity,readiness:blocked});
  if(decision.engine==='v9')blockedV9++;
  assert.equal(decision.engine,'v8');
  assert.equal(decision.reason,'readiness_blocked');
  assert.equal(decision.path,'./');
}
assert.equal(blockedV9,0,'BLOCKED readiness must expose zero identities to V9');

let missingV9=0;
for(const identity of identities){
  const decision=Rollout.decide({config:baseConfig,identity,readiness:null});
  if(decision.engine==='v9')missingV9++;
  assert.equal(decision.engine,'v8');
  assert.equal(decision.reason,'readiness_missing');
  assert.equal(decision.path,'./');
}
assert.equal(missingV9,0,'missing readiness must expose zero identities to V9');

let readyV9=0;
for(const identity of identities){
  const first=Rollout.decide({config:baseConfig,identity,readiness:ready});
  const second=Rollout.decide({config:baseConfig,identity,readiness:ready});
  assert.deepEqual(second,first,'assignment must be deterministic for a stable identity and salt');
  if(first.engine==='v9'){
    readyV9++;
    assert.equal(first.stage,'canary');
    assert.equal(first.path,'v9-production-shell/');
    assert.ok(first.bucket<1);
  }else{
    assert.equal(first.engine,'v8');
    assert.equal(first.stage,'canary-control');
    assert.equal(first.path,'./');
    assert.ok(first.bucket>=1);
  }
}
const readyPercent=readyV9/identities.length*100;
assert.ok(readyPercent>=0.8&&readyPercent<=1.2,`1% canary sample outside tolerance: ${readyPercent}%`);

let killedV9=0;
const killedConfig={...baseConfig,killSwitch:true};
for(const identity of identities){
  const decision=Rollout.decide({config:killedConfig,identity,readiness:ready});
  if(decision.engine==='v9')killedV9++;
  assert.equal(decision.engine,'v8');
  assert.equal(decision.reason,'kill_switch');
  assert.equal(decision.path,'./');
}
assert.equal(killedV9,0,'kill switch must expose zero identities to V9');

console.log(JSON.stringify({
  ok:true,
  module:'tcc-v9-production-routing-smoke',
  sampleSize:identities.length,
  blockedV9,
  missingV9,
  readyV9,
  readyPercent,
  killedV9,
  enginePath
},null,2));
