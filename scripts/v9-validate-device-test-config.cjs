#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILES = {
  rollout: 'data/v9/rollout-config.json',
  selfEnrollment: 'data/v9/self-enrollment-config.json',
  readiness: 'data/v9/access-readiness.json',
  devicePolicy: 'data/v9/device-test-policy.json'
};

function readConfiguration(root = process.cwd()) {
  return Object.fromEntries(Object.entries(FILES).map(([key, relativePath]) => [
    key,
    JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
  ]));
}

function validateConfiguration(configuration, { now = new Date(), maximumWindowMinutes = 60 } = {}) {
  const rollout = configuration?.rollout || {};
  const self = configuration?.selfEnrollment || {};
  const readiness = configuration?.readiness || {};
  const policy = configuration?.devicePolicy || {};
  const checkedAt = new Date(now);
  const nowMs = checkedAt.getTime();
  const maximumWindowMs = Number(maximumWindowMinutes) * 60 * 1000;
  const commonErrors = [];

  if (!Number.isFinite(nowMs)) commonErrors.push('validation time must be valid');
  if (rollout.stage !== 'preview') commonErrors.push('rollout stage must remain preview');
  if (Number(rollout.canaryPercent) !== 0) commonErrors.push('random canary must remain 0%');
  if (rollout.killSwitch === true) commonErrors.push('kill switch must remain off for the controlled test contract');
  if (rollout.canaryPath !== 'v9-app/' || rollout.productionPath !== 'v9-app/') {
    commonErrors.push('candidate routes must target v9-app/');
  }

  const closedChecks = [
    ['access readiness must be BLOCKED', readiness.ready === false && readiness.verdict === 'BLOCKED'],
    ['self-enrollment must be disabled', self.enabled === false],
    ['self-enrollment readiness approval must be false', self.readinessApproved === false],
    ['closed state must not retain a token hash', !String(self.tokenSha256 || '').trim()],
    ['closed state must not retain an expiry', self.expiresAt == null],
    ['device-test policy must be disabled', policy.enabled === false]
  ];
  const closedErrors = closedChecks.filter(([, valid]) => !valid).map(([message]) => message);
  if (closedErrors.length === 0 && commonErrors.length === 0) {
    return { ok: true, mode: 'CLOSED', checkedAt: checkedAt.toISOString(), errors: [] };
  }

  const expiresAtMs = Date.parse(self.expiresAt);
  const openedAtMs = Date.parse(readiness.updatedAt);
  const configuredWindowMinutes = Number(policy.maxWindowMinutes);
  const maximumGrantMinutes = Number(self.maxGrantMinutes);
  const controlledChecks = [
    ['access readiness must be READY', readiness.ready === true && readiness.verdict === 'READY'],
    ['self-enrollment must be enabled', self.enabled === true],
    ['self-enrollment must require readiness', self.requireReadiness !== false],
    ['self-enrollment readiness must be approved', self.readinessApproved === true],
    ['active token must be represented by one SHA-256 hash', /^[a-f0-9]{64}$/i.test(String(self.tokenSha256 || '').trim())],
    ['active token version must be set', Boolean(String(self.tokenVersion || '').trim())],
    ['active window expiry must be valid', Number.isFinite(expiresAtMs)],
    ['active window must not be expired', Number.isFinite(expiresAtMs) && expiresAtMs > nowMs],
    ['readiness update time must be valid', Number.isFinite(openedAtMs)],
    ['readiness update time must not be in the future', Number.isFinite(openedAtMs) && openedAtMs <= nowMs + 5 * 60 * 1000],
    ['active expiry must follow readiness approval', Number.isFinite(expiresAtMs) && Number.isFinite(openedAtMs) && expiresAtMs > openedAtMs],
    ['active window must be bounded to 60 minutes', Number.isFinite(expiresAtMs) && Number.isFinite(openedAtMs) && expiresAtMs - openedAtMs <= maximumWindowMs],
    ['grant duration must be between 1 and 60 minutes', Number.isFinite(maximumGrantMinutes) && maximumGrantMinutes >= 1 && maximumGrantMinutes <= maximumWindowMinutes],
    ['device-test policy must be enabled', policy.enabled === true],
    ['device-test policy must require readiness', policy.requireReadiness === true],
    ['device-test policy must require canary 0%', policy.requireCanaryPercentZero === true],
    ['device-test policy must auto-close on rollback', policy.autoCloseOnRollback === true],
    ['device-test policy window must be between 1 and 60 minutes', Number.isFinite(configuredWindowMinutes) && configuredWindowMinutes >= 1 && configuredWindowMinutes <= maximumWindowMinutes],
    ['grant duration must not exceed the policy window', Number.isFinite(maximumGrantMinutes) && Number.isFinite(configuredWindowMinutes) && maximumGrantMinutes <= configuredWindowMinutes],
    ['configured policy must cover the active window', Number.isFinite(expiresAtMs) && Number.isFinite(openedAtMs) && Number.isFinite(configuredWindowMinutes) && expiresAtMs - openedAtMs <= configuredWindowMinutes * 60 * 1000],
    ['device test must require at least 10 runs', Number(policy.minimumRuns) >= 10],
    ['device test must require at least 10 successful runs', Number(policy.minimumSuccessfulRuns) >= 10]
  ];
  const controlledErrors = controlledChecks.filter(([, valid]) => !valid).map(([message]) => message);
  const errors = [...commonErrors, ...controlledErrors];
  if (errors.length === 0) {
    return {
      ok: true,
      mode: 'CONTROLLED_WINDOW',
      checkedAt: checkedAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      tokenVersion: String(self.tokenVersion).trim(),
      errors: []
    };
  }

  return { ok: false, mode: 'INVALID', checkedAt: Number.isFinite(nowMs) ? checkedAt.toISOString() : null, errors };
}

function run() {
  const result = validateConfiguration(readConfiguration());
  if (!result.ok) {
    console.error(`BLOCKED: invalid V9 device-test configuration\n- ${result.errors.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS V9 device-test configuration: ${result.mode}`);
  if (result.expiresAt) console.log(`expiresAt=${result.expiresAt}`);
}

if (require.main === module) run();

module.exports = { FILES, readConfiguration, validateConfiguration };
