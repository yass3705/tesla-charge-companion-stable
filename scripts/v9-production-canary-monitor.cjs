'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE_URL = (process.env.BASE_URL || 'https://yass3705.github.io/tesla-charge-companion-stable').replace(/\/$/, '');
const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE || 10000);
const ALLOWED_STAGES = new Set([1, 5, 10, 25, 50, 100]);
const RESULT_PATH = process.env.RESULT_PATH || 'v9-canary-monitor-result.json';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(relative, attempts = 12) {
  const url = `${BASE_URL}/${relative.replace(/^\//, '')}${relative.includes('?') ? '&' : '?'}monitorTs=${Date.now()}`;
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (i < attempts) await sleep(5000);
    }
  }
  throw lastError;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function countV9(Rollout, config, readiness, prefix) {
  let count = 0;
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const identity = `${prefix}-${i}`;
    const first = Rollout.decide({ config, identity, readiness });
    const second = Rollout.decide({ config, identity, readiness });
    assert(JSON.stringify(first) === JSON.stringify(second), `non-deterministic routing for ${identity}`);
    if (first.engine === 'v9') count++;
  }
  return count;
}

function allowedTolerance(percent) {
  return Math.max(0.2, percent * 0.15);
}

async function main() {
  const startedAt = new Date().toISOString();
  const localControl = readJson('v9-production-control.json');
  const localShell = readJson('v9-production-shell/shell-config.json');

  assert(localControl.active === true, 'production canary is not active');
  assert(localControl.stage === 'canary', `unexpected production stage: ${localControl.stage}`);
  assert(ALLOWED_STAGES.has(localControl.canaryPercent), `unsupported canary percent: ${localControl.canaryPercent}`);
  assert(localControl.killSwitch === false, 'kill switch is active');
  assert(localControl.requireReadiness === true, 'readiness gate is not required');
  assert(localControl.readiness?.ready === true && localControl.readiness?.verdict === 'READY', 'local readiness is not READY');

  const [rootHtml, liveControlText, liveShellText, liveRolloutText, liveRuntimeText, liveLoaderText, liveRegistryText] = await Promise.all([
    fetchText(''),
    fetchText('v9-production-control.json'),
    fetchText('v9-production-shell/shell-config.json'),
    fetchText('v9-production-runtime/assets/v9/rollout-engine.js'),
    fetchText('v9-production-runtime/assets/v9/runtime-engine.js'),
    fetchText('v9-production-runtime/assets/v9/browser-loaders.js'),
    fetchText('v9-production-runtime/data/v9/source-registry.json'),
  ]);

  const liveControl = parseJson(liveControlText, 'live control');
  const liveShell = parseJson(liveShellText, 'live shell config');
  const liveRegistry = parseJson(liveRegistryText, 'live source registry');

  assert(/<meta\s+name=["']tcc-build["']\s+content=["'][^"']+["']/.test(rootHtml), 'stable root build marker is missing');
  assert(liveControl.active === true, 'live canary is not active');
  assert(liveControl.stage === 'canary', `unexpected live stage: ${liveControl.stage}`);
  assert(liveControl.canaryPercent === localControl.canaryPercent, `live/local canary percent mismatch: ${liveControl.canaryPercent}/${localControl.canaryPercent}`);
  assert(liveControl.killSwitch === false, 'live kill switch is active');
  assert(liveControl.requireReadiness === true, 'live readiness gate is not required');
  assert(liveControl.readiness?.ready === true && liveControl.readiness?.verdict === 'READY', 'live readiness is not READY');
  assert(liveControl.observedCandidateSha === localControl.observedCandidateSha, 'live/local candidate SHA mismatch');
  assert(liveControl.runtimeFingerprint === localControl.runtimeFingerprint, 'live/local runtime fingerprint mismatch');

  assert(liveShell.mode === 'candidate', `live shell mode is ${liveShell.mode}, expected candidate`);
  assert(liveShell.observedCandidateSha === liveControl.observedCandidateSha, 'shell/control candidate SHA mismatch');
  assert(liveShell.runtimeFingerprint === liveControl.runtimeFingerprint, 'shell/control runtime fingerprint mismatch');
  assert(liveShell.runtimeBase === 'v9-production-runtime', 'shell runtime namespace is not isolated');
  assert(liveShell.fallback === 'legacy-compare', 'shell fallback is not legacy-compare');
  assert(localShell.observedCandidateSha === liveShell.observedCandidateSha, 'local/live shell candidate mismatch');
  assert(localShell.runtimeFingerprint === liveShell.runtimeFingerprint, 'local/live shell fingerprint mismatch');

  const localRolloutPath = 'v9-production-runtime/assets/v9/rollout-engine.js';
  const localRuntimePath = 'v9-production-runtime/assets/v9/runtime-engine.js';
  const localLoaderPath = 'v9-production-runtime/assets/v9/browser-loaders.js';
  assert(fs.readFileSync(localRolloutPath, 'utf8') === liveRolloutText, 'live rollout engine differs from pinned repository payload');
  assert(fs.readFileSync(localRuntimePath, 'utf8') === liveRuntimeText, 'live runtime engine differs from pinned repository payload');
  assert(fs.readFileSync(localLoaderPath, 'utf8') === liveLoaderText, 'live browser loaders differ from pinned repository payload');
  new vm.Script(liveRolloutText, { filename: 'live-rollout-engine.js' });
  new vm.Script(liveRuntimeText, { filename: 'live-runtime-engine.js' });
  new vm.Script(liveLoaderText, { filename: 'live-browser-loaders.js' });
  assert(Array.isArray(liveRegistry.sources) && liveRegistry.sources.length > 0, 'live source registry is empty');

  const Rollout = require(path.resolve(localRolloutPath));
  const target = liveControl.canaryPercent;
  const readyV9 = countV9(Rollout, liveControl, liveControl.readiness, `prod-${target}pct-ready`);
  const readyPercent = (readyV9 / SAMPLE_SIZE) * 100;
  const tolerance = allowedTolerance(target);
  assert(readyPercent >= target - tolerance && readyPercent <= target + tolerance,
    `live ${target}% routing distribution outside tolerance: ${readyPercent.toFixed(3)}% (±${tolerance.toFixed(3)})`);

  const blockedReadiness = { ready: false, verdict: 'BLOCKED' };
  const blockedV9 = countV9(Rollout, liveControl, blockedReadiness, 'blocked');
  assert(blockedV9 === 0, `readiness BLOCKED routed ${blockedV9} identities to V9`);

  const killed = { ...liveControl, killSwitch: true };
  const killedV9 = countV9(Rollout, killed, liveControl.readiness, 'killed');
  assert(killedV9 === 0, `kill switch routed ${killedV9} identities to V9`);

  const result = {
    ok: true,
    module: 'tcc-v9-production-canary-monitor',
    startedAt,
    completedAt: new Date().toISOString(),
    activationId: liveControl.activationId || null,
    canaryPercent: target,
    sampleSize: SAMPLE_SIZE,
    readyV9,
    readyPercent,
    tolerance,
    blockedV9,
    killedV9,
    readiness: liveControl.readiness,
    killSwitch: liveControl.killSwitch,
    observedCandidateSha: liveControl.observedCandidateSha,
    runtimeFingerprint: liveControl.runtimeFingerprint,
    shellMode: liveShell.mode,
    sourceCount: liveRegistry.sources.length,
    rollbackSignals: [],
  };

  fs.writeFileSync(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const result = {
    ok: false,
    module: 'tcc-v9-production-canary-monitor',
    completedAt: new Date().toISOString(),
    error: error.stack || String(error),
    rollbackSignals: [String(error.message || error)],
  };
  try { fs.writeFileSync(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`); } catch (_) {}
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
