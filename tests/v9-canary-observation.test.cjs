'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const Observation=require('../scripts/v9-canary-observation.cjs');
const observation=require('../ops/v9/canary-observation.json');
const policy=require('../data/v9/canary-policy.json');
const rollout=require('../data/v9/rollout-config.json');

const clone=value=>JSON.parse(JSON.stringify(value));
const fingerprint=observation.candidate.runtimeFingerprint;
const blockedReadiness={verdict:'BLOCKED',ready:false};
const readyReadiness={verdict:'READY',ready:true};
const deploymentWorkflow=fs.readFileSync('.github/workflows/v9-device-test-pages.yml','utf8');

const baseTree='100644 blob aaaa\tv9-app/app.js\n100644 blob bbbb\tdata/v9/rollout-config.json\n';
const controlChange='100644 blob aaaa\tv9-app/app.js\n100644 blob cccc\tdata/v9/rollout-config.json\n';
const runtimeChange='100644 blob dddd\tv9-app/app.js\n100644 blob bbbb\tdata/v9/rollout-config.json\n';
assert.equal(Observation.fingerprintTree(baseTree),Observation.fingerprintTree(controlChange));
assert.notEqual(Observation.fingerprintTree(baseTree),Observation.fingerprintTree(runtimeChange));

const derived=Observation.deriveEvidence(observation.evidence);
assert.deepEqual(derived,observation.evidence.aggregate);
assert.equal(derived.runs,30);
assert.equal(derived.passes,30);
assert.equal(derived.failures,0);
assert.equal(derived.routeAttempts,720);
assert.equal(derived.routesSucceeded,720);
assert.equal(derived.averageLatencyMs,7043);
assert.equal(derived.maxLatencyMs,18372);

let result=Observation.evaluateObservation({
  observation,
  policy,
  rollout,
  readiness:blockedReadiness,
  deploymentWorkflow,
  now:'2026-09-01T15:48:19Z',
  sourceFingerprint:fingerprint,
  deploymentFingerprint:fingerprint,
  currentFingerprint:fingerprint
});
assert.equal(result.decision,'OBSERVING');
assert.equal(result.safe,true);
assert(result.reasons.includes('minimum_observation_not_met'));
assert.equal(result.promotion.decision,'HOLD');
assert(result.promotion.reasons.includes('readiness_not_ready'));

result=Observation.evaluateObservation({
  observation,
  policy,
  rollout,
  readiness:readyReadiness,
  deploymentWorkflow,
  now:observation.window.eligibleAfter,
  sourceFingerprint:fingerprint,
  deploymentFingerprint:fingerprint,
  currentFingerprint:fingerprint
});
assert.equal(result.decision,'WINDOW_COMPLETE');
assert.equal(result.promotion.decision,'PROMOTE_ELIGIBLE');
assert.equal(result.promotion.nextPercent,1);
assert.equal(result.promotion.manualApprovalRequired,true);

result=Observation.evaluateObservation({
  observation,
  policy,
  rollout,
  readiness:readyReadiness,
  deploymentWorkflow,
  now:observation.window.eligibleAfter,
  sourceFingerprint:fingerprint,
  deploymentFingerprint:'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  currentFingerprint:fingerprint
});
assert.equal(result.decision,'RESET_REQUIRED');
assert.equal(result.safe,false);
assert(result.reasons.includes('build_changed'));

const badAggregate=clone(observation);
badAggregate.evidence.aggregate.runs=31;
result=Observation.evaluateObservation({
  observation:badAggregate,
  policy,
  rollout,
  readiness:readyReadiness,
  deploymentWorkflow,
  now:observation.window.eligibleAfter,
  sourceFingerprint:fingerprint,
  deploymentFingerprint:fingerprint,
  currentFingerprint:fingerprint
});
assert.equal(result.decision,'INVALID');
assert(result.reasons.includes('aggregate_evidence_mismatch'));

const unsafeRollout={...rollout,stage:'canary',canaryPercent:1};
result=Observation.evaluateObservation({
  observation,
  policy,
  rollout:unsafeRollout,
  readiness:readyReadiness,
  deploymentWorkflow,
  now:observation.window.eligibleAfter,
  sourceFingerprint:fingerprint,
  deploymentFingerprint:fingerprint,
  currentFingerprint:fingerprint
});
assert.equal(result.decision,'INVALID');
assert(result.reasons.includes('rollout_must_remain_preview_zero'));

result=Observation.evaluateObservation({
  observation,
  policy,
  rollout,
  readiness:readyReadiness,
  deploymentWorkflow:'name: unlocked',
  now:observation.window.eligibleAfter,
  sourceFingerprint:fingerprint,
  deploymentFingerprint:fingerprint,
  currentFingerprint:fingerprint
});
assert.equal(result.decision,'INVALID');
assert(result.reasons.includes('pages_deployment_lock_missing'));

result=Observation.evaluateObservation({
  observation,
  policy,
  rollout,
  readiness:readyReadiness,
  deploymentWorkflow,
  now:observation.window.eligibleAfter,
  sourceFingerprint:fingerprint,
  deploymentFingerprint:fingerprint,
  currentFingerprint:'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
});
assert.equal(result.decision,'WINDOW_COMPLETE');
assert.equal(result.safe,true);
assert.equal(result.promotion.decision,'HOLD');
assert(result.promotion.reasons.includes('build_changed'));

console.log(JSON.stringify({
  ok:true,
  module:'tcc-v9-canary-observation',
  checks:['live-evidence','aggregate-integrity','24h-window','stable-build','pages-lock','manual-gate','zero-traffic']
},null,2));
