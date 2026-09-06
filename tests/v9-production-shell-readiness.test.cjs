const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));

const shell=read('ops/v9/production-shell-readiness.json');
const policy=read('data/v9/canary-policy.json');
const rollout=read('data/v9/rollout-config.json');
const readiness=read('data/v9/access-readiness.json');
const activation=read('ops/v9/canary-activation.json');

assert.equal(shell.state,'BLOCKED');
assert.equal(shell.ready,false);
assert.equal(shell.controlVersion,'7.3-stable');
assert.equal(shell.controlPath,'./');
assert.equal(shell.candidateKind,'engine-validation-harness');
assert.equal(shell.observedCandidateSha,'8d2c20b7c76004389edd8f4a3b80d6b314900ba0');
assert.equal(shell.fullWindowRunId,33999132520);
assert.equal(policy.active,false,'public canary policy must stay inactive while production shell is blocked');
assert.equal(rollout.stage,'preview');
assert.equal(Number(rollout.canaryPercent),0,'blocked production shell must imply zero public user exposure');
assert.equal(rollout.v8Path,shell.controlPath,'legacy fallback field must resolve to the actual production control root');
assert.equal(rollout.canaryPath,shell.candidatePath);
assert.equal(readiness.ready,true,'engine readiness evidence is retained');
assert.equal(readiness.verdict,'READY');
assert.equal(activation.fullWindowValidation?.conclusion,'success','completed engine validation evidence must be retained');
assert.equal(activation.candidate?.observationSourceSha,shell.observedCandidateSha,'shell gate must reference the observed candidate');
assert.equal(activation.candidate?.runtimeFingerprint,shell.runtimeFingerprint,'shell gate must reference the observed runtime fingerprint');
assert.equal(Number(activation.fullWindowValidation?.runId),Number(shell.fullWindowRunId),'shell gate must reference the completed full-window run');
assert.ok(Array.isArray(shell.reasons)&&shell.reasons.length>=3);
assert.ok(Array.isArray(shell.requiredBeforeUserCanary)&&shell.requiredBeforeUserCanary.length>=5);

console.log(JSON.stringify({ok:true,module:'tcc-v9-production-shell-readiness',state:shell.state,userExposurePercent:0,engineEvidenceRetained:true},null,2));
