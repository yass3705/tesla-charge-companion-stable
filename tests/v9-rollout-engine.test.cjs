const assert=require('node:assert/strict');
const Rollout=require('../assets/v9/rollout-engine.js');

const ready={verdict:'READY',ready:true},blocked={verdict:'BLOCKED',ready:false};
let d=Rollout.decide({config:{stage:'preview',canaryPercent:10},identity:'device-a'});
assert.equal(d.engine,'v9');assert.equal(d.stage,'preview');

d=Rollout.decide({config:{stage:'production',requireReadiness:true},identity:'device-a',readiness:null});
assert.equal(d.engine,'v8');assert.equal(d.reason,'readiness_missing');
d=Rollout.decide({config:{stage:'production',requireReadiness:true},identity:'device-a',readiness:blocked});
assert.equal(d.engine,'v8');assert.equal(d.reason,'readiness_blocked');
d=Rollout.decide({config:{stage:'production',requireReadiness:true},identity:'device-a',readiness:ready});
assert.equal(d.engine,'v9');assert.equal(d.stage,'production');

const config={stage:'canary',canaryPercent:10,requireReadiness:true,salt:'stable'};
const a=Rollout.decide({config,identity:'same-device',readiness:ready});
const b=Rollout.decide({config,identity:'same-device',readiness:ready});
assert.equal(a.bucket,b.bucket,'canary assignment must be deterministic');
assert.ok(['v8','v9'].includes(a.engine));

const killed=Rollout.decide({config:{stage:'production',killSwitch:true},identity:'x',readiness:ready});
assert.equal(killed.engine,'v8');assert.equal(killed.reason,'kill_switch');
assert.equal(Rollout.promotionAllowed('preview','canary',blocked),false);
assert.equal(Rollout.promotionAllowed('preview','canary',ready),true);
assert.equal(Rollout.promotionAllowed('canary','production',ready),true);
assert.equal(Rollout.promotionAllowed('preview','production',ready),false,'stage skipping must be forbidden');
const rollback=Rollout.rollback({stage:'production',canaryPercent:100},'incident');
assert.equal(rollback.killSwitch,true);assert.equal(rollback.rollbackReason,'incident');
console.log(JSON.stringify({ok:true,module:'tcc-v9-rollout-engine',checks:['preview-isolated','readiness-required','deterministic-canary','kill-switch','sequential-promotion','rollback']},null,2));
