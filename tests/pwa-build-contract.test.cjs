'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const index=fs.readFileSync('index.html','utf8');
const update=fs.readFileSync('assets/update.js','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const appVersion=JSON.parse(fs.readFileSync('app-version.json','utf8'));

const meta=index.match(/<meta name="tcc-build" content="([^"]+)">/);
assert.ok(meta,'stable build meta is required');
const build=meta[1];
assert.equal(build,'7310');
assert.equal(String(appVersion.build),build,'app-version and stable HTML build must agree');
assert.ok(index.includes(`assets/update.js?v=${build}`),'stable HTML must request update.js with the current build');
assert.ok(update.includes("const CURRENT_BUILD=String(meta?.content||'').trim();"),'update checker must derive its build from stable HTML');
assert.ok(update.includes('service-worker.js?v=${encodeURIComponent(CURRENT_BUILD)}'),'worker registration must carry the derived build');
assert.ok(update.includes('loadProductionCanaryBootstrap();'),'stable update bootstrap must load the fail-closed canary selector');
assert.ok(!update.includes("CURRENT_BUILD='7306'"),'hard-coded stale update build must not return');
assert.ok(worker.includes("workerUrl.searchParams.get('v')"),'service worker cache version must derive from its registration URL');
assert.ok(worker.includes('const CACHE=`tcc-v${BUILD}-stable`;'));
assert.ok(worker.includes('`./assets/update.js?v=${q}`'));
assert.ok(worker.includes('`./assets/app.js?v=${q}`'));
assert.ok(worker.includes('`./assets/dedupe.js?v=${q}`'));
assert.ok(!worker.includes("const CACHE = 'tcc-v7306-stable'"),'hard-coded stale service-worker cache must not return');

console.log(JSON.stringify({ok:true,module:'tcc-pwa-build-contract',build,derivedUpdateBuild:true,derivedWorkerCache:true},null,2));
