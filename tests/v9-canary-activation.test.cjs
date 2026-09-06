'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Activation=require('../scripts/v9-canary-activation.cjs');
const activation=require('../ops/v9/canary-activation.json');
const observation=require('../ops/v9/canary-observation.json');
const repositoryPolicy=require('../data/v9/canary-policy.json');
const repositoryRollout=require('../data/v9/rollout-config.json');
const readiness=require('../data/v9/access-readiness.json');
const shell=require('../ops/v9/production-shell-readiness.json');
const clone=value=>JSON.parse(JSON.stringify(value));
const fingerprint=observation.candidate.runtimeFingerprint;
const deploymentWorkflow=fs.readFileSync('.github/workflows/v9-device-test-pages.yml','utf8');
const now='2026-09-05T23:55:00Z';

// The activation artifact is historical evidence for the already-approved
// initial engine canary package. Reconstruct that package to test its integrity
// without asserting that public user exposure is active today.
const policy={...repositoryPolicy,active:true};
const rollout={...repositoryRollout,stage:'canary',canaryPercent:1,v8Path:'v8-app/'};
let result=Activation.validateActivation({activation,observation,policy,rollout,readiness,deploymentWorkflow,now,sourceFingerprint:fingerprint,deploymentFingerprint:fingerprint,currentFingerprint:fingerprint});
assert.equal(result.safe,true,result.errors.join(', '));assert.equal(result.decision,'CANARY_READY');assert.equal(result.percent,1);assert.equal(result.fullWindowRunId,33999132520);assert.equal(result.candidate.stableBuild,true);assert.equal(result.metrics.runs,30);assert.equal(result.metrics.failures,0);
const zeroTraffic=clone(rollout);zeroTraffic.stage='preview';zeroTraffic.canaryPercent=0;result=Activation.validateActivation({activation,observation,policy,rollout:zeroTraffic,readiness,deploymentWorkflow,now,sourceFingerprint:fingerprint,deploymentFingerprint:fingerprint,currentFingerprint:fingerprint});assert.equal(result.safe,false);assert(result.errors.includes('rollout_stage_not_canary'));
const blocked=clone(readiness);blocked.ready=false;blocked.verdict='BLOCKED';result=Activation.validateActivation({activation,observation,policy,rollout,readiness:blocked,deploymentWorkflow,now,sourceFingerprint:fingerprint,deploymentFingerprint:fingerprint,currentFingerprint:fingerprint});assert.equal(result.safe,false);assert(result.errors.includes('readiness_not_ready'));
const changed='sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';result=Activation.validateActivation({activation,observation,policy,rollout,readiness,deploymentWorkflow,now,sourceFingerprint:fingerprint,deploymentFingerprint:fingerprint,currentFingerprint:changed});assert.equal(result.safe,false);assert(result.errors.includes('current_build_changed'));
const badRun=clone(activation);badRun.fullWindowValidation.conclusion='failure';result=Activation.validateActivation({activation:badRun,observation,policy,rollout,readiness,deploymentWorkflow,now,sourceFingerprint:fingerprint,deploymentFingerprint:fingerprint,currentFingerprint:fingerprint});assert.equal(result.safe,false);assert(result.errors.includes('full_window_run_not_successful'));
const badEvidence=clone(activation);badEvidence.evidence.failures=1;result=Activation.validateActivation({activation:badEvidence,observation,policy,rollout,readiness,deploymentWorkflow,now,sourceFingerprint:fingerprint,deploymentFingerprint:fingerprint,currentFingerprint:fingerprint});assert.equal(result.safe,false);assert(result.errors.includes('activation_evidence_mismatch:failures'));
assert.equal(repositoryPolicy.active,false,'historical activation evidence must not force current public exposure on');
assert.equal(repositoryRollout.stage,'preview');assert.equal(Number(repositoryRollout.canaryPercent),0);
assert.equal(shell.ready,false);assert.equal(shell.state,'BLOCKED');
console.log(JSON.stringify({ok:true,module:'tcc-v9-canary-activation',checks:['historical-approved-one-percent','full-window-run','ready-engine-state','stable-runtime','zero-rollbacks','blocked-readiness','changed-build','failed-validation','evidence-integrity','current-user-exposure-decoupled']},null,2));
