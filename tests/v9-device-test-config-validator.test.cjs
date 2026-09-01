const assert = require('node:assert/strict');
const Window = require('../assets/v9/device-test-window-engine.js');
const Validator = require('../scripts/v9-validate-device-test-config.cjs');

const current = Validator.readConfiguration();
const currentResult = Validator.validateConfiguration(current);
assert.equal(currentResult.ok, true, currentResult.errors.join(', '));

const now = new Date('2026-09-01T12:00:00Z');
const closed = {
  rollout: { ...current.rollout, stage: 'preview', canaryPercent: 0, killSwitch: false, canaryPath: 'v9-app/', productionPath: 'v9-app/' },
  selfEnrollment: { ...current.selfEnrollment, enabled: false, readinessApproved: false, tokenSha256: '', expiresAt: null, maxGrantMinutes: 60 },
  readiness: { ...current.readiness, ready: false, verdict: 'BLOCKED' },
  devicePolicy: { ...current.devicePolicy, enabled: false, maxWindowMinutes: 60 }
};
assert.equal(Validator.validateConfiguration(closed, { now }).mode, 'CLOSED');

const openPlan = Window.openPlan({
  tokenSha256: 'a'.repeat(64),
  tokenVersion: 'device-test-validator',
  now,
  windowMinutes: 30,
  selfEnrollment: closed.selfEnrollment,
  readiness: closed.readiness,
  devicePolicy: closed.devicePolicy,
  rollout: closed.rollout
});
const controlled = {
  rollout: closed.rollout,
  selfEnrollment: openPlan.files['data/v9/self-enrollment-config.json'],
  readiness: openPlan.files['data/v9/access-readiness.json'],
  devicePolicy: openPlan.files['data/v9/device-test-policy.json']
};
const controlledResult = Validator.validateConfiguration(controlled, { now: new Date('2026-09-01T12:01:00Z') });
assert.equal(controlledResult.ok, true, controlledResult.errors.join(', '));
assert.equal(controlledResult.mode, 'CONTROLLED_WINDOW');

const invalidHash = structuredClone(controlled);
invalidHash.selfEnrollment.tokenSha256 = 'plaintext-token';
assert.equal(Validator.validateConfiguration(invalidHash, { now }).ok, false);

const expired = structuredClone(controlled);
assert.equal(Validator.validateConfiguration(expired, { now: new Date('2026-09-01T12:31:00Z') }).ok, false);

const mixed = structuredClone(closed);
mixed.selfEnrollment.enabled = true;
assert.equal(Validator.validateConfiguration(mixed, { now }).ok, false);

const canary = structuredClone(controlled);
canary.rollout.canaryPercent = 1;
assert.equal(Validator.validateConfiguration(canary, { now }).ok, false);

console.log(JSON.stringify({
  ok: true,
  module: 'tcc-v9-device-test-config-validator',
  checks: ['closed', 'controlled-window', 'hash-only', 'expiry', 'mixed-state', 'zero-canary']
}, null, 2));
