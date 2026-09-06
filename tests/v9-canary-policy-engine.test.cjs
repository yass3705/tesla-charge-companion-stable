const assert=require('node:assert/strict');
const E=require('../assets/v9/canary-policy-engine.js');
const repositoryPolicy=require('../data/v9/canary-policy.json');

// Exercise progression semantics independently from whether public exposure is
// currently enabled. Activation is a control-plane state, not an engine-policy
// algorithm invariant.
const policy={...repositoryPolicy,active:true};
let r=E.evaluate({policy,currentPercent:0,metrics:{runs:10,observedHours:4,failures:0,sourceErrors:0,routingErrors:0,averageLatencyMs:1000},readiness:{verdict:'READY'},build:{stable:true}});
assert.equal(r.decision,'HOLD');assert(r.reasons.includes('minimum_observation_not_met'));assert(r.reasons.includes('minimum_runs_not_met'));
r=E.evaluate({policy,currentPercent:0,metrics:{runs:25,observedHours:24,failures:0,sourceErrors:0,routingErrors:0,averageLatencyMs:1000},readiness:{verdict:'READY'},build:{startedSha:'a',currentSha:'a'}});assert.equal(r.decision,'PROMOTE_ELIGIBLE');assert.equal(r.nextPercent,1);assert.equal(r.manualApprovalRequired,true);
r=E.evaluate({policy,currentPercent:1,metrics:{runs:30,observedHours:24,failures:0,sourceErrors:0,routingErrors:0,averageLatencyMs:2682},readiness:{verdict:'READY'},build:{startedSha:'a',currentSha:'a'}});assert.equal(r.decision,'HOLD');assert.equal(r.nextPercent,5);assert(r.reasons.includes('minimum_runs_not_met'));
r=E.evaluate({policy,currentPercent:1,metrics:{runs:100,observedHours:24,failures:6,sourceErrors:0,routingErrors:0,averageLatencyMs:1000},readiness:{verdict:'READY'},build:{stable:true}});assert.equal(r.decision,'ROLLBACK');assert(r.reasons.includes('failure_rate'));
r=E.evaluate({policy,currentPercent:5,metrics:{runs:150,observedHours:24,failures:0,sourceErrors:0,routingErrors:0,averageLatencyMs:1000},readiness:{verdict:'READY'},build:{startedSha:'a',currentSha:'b'}});assert.equal(r.decision,'HOLD');assert(r.reasons.includes('build_changed'));
assert.deepEqual(repositoryPolicy.stages.map(x=>x.percent),[1,5,10,25,50,100]);
assert.equal(repositoryPolicy.initialPercent,1);
assert.equal(typeof repositoryPolicy.active,'boolean');
console.log(JSON.stringify({ok:true,module:'tcc-v9-canary-policy',checks:['progressive-stages','minimum-window','minimum-runs','one-percent-hold','rollback','stable-build','manual-approval','activation-decoupled-from-policy-algorithm']},null,2));
