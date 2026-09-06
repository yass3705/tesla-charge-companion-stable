'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Bootstrap=require('../assets/v9-production-bootstrap.js');
const Rollout=require('../v9-production-runtime/assets/v9/rollout-engine.js');

const control=JSON.parse(fs.readFileSync('v9-production-control.json','utf8'));
const shell=JSON.parse(fs.readFileSync('v9-production-shell/shell-config.json','utf8'));
const siteRoot='https://yass3705.github.io/tesla-charge-companion-stable/';
const scriptSrc=siteRoot+'assets/v9-production-bootstrap.js?v=1';

assert.equal(Bootstrap.validateControl(control).ok,true);
assert.equal(control.active,true);
assert.equal(control.stage,'canary');
assert.equal(control.canaryPercent,1);
assert.equal(control.killSwitch,false);
assert.equal(control.readiness.ready,true);
assert.equal(control.readiness.verdict,'READY');
assert.equal(control.observedCandidateSha,Bootstrap.PINNED_SHA);
assert.equal(control.runtimeFingerprint,Bootstrap.PINNED_FINGERPRINT);
assert.equal(shell.mode,'candidate');
assert.equal(shell.observedCandidateSha,Bootstrap.PINNED_SHA);
assert.equal(shell.runtimeFingerprint,Bootstrap.PINNED_FINGERPRINT);
assert.equal(shell.runtimeBase,'v9-production-runtime');
assert.equal(shell.fallback,'legacy-compare');
assert.deepEqual(shell.engineScopeCountries,['FR','NL','IT']);

assert.equal(Bootstrap.siteRootFromScript(scriptSrc).href,siteRoot);
assert.equal(Bootstrap.isProductionRoot({href:siteRoot},new URL(siteRoot)),true);
assert.equal(Bootstrap.isProductionRoot({href:siteRoot+'index.html'},new URL(siteRoot)),true);
assert.equal(Bootstrap.isProductionRoot({href:siteRoot+'v9-production-shell/'},new URL(siteRoot)),false);
assert.equal(Bootstrap.isProductionRoot({href:siteRoot+'v8-preview/'},new URL(siteRoot)),false);

const badSha={...control,observedCandidateSha:'bad'};
assert.deepEqual(Bootstrap.validateControl(badSha),{ok:false,reason:'candidate_sha_mismatch'});
const badFingerprint={...control,runtimeFingerprint:'bad'};
assert.deepEqual(Bootstrap.validateControl(badFingerprint),{ok:false,reason:'runtime_fingerprint_mismatch'});
assert.equal(Bootstrap.validateControl({...control,canaryPercent:101}).ok,false);
assert.equal(Bootstrap.validateControl({...control,canaryPercent:50}).ok,true,'later stages must be config-only, not require a bootstrap patch');
assert.equal(Bootstrap.validateControl({...control,canaryPath:'v9-app/'}).ok,false);

const identities=Array.from({length:10000},(_,i)=>`production-bootstrap-${i}`);
let v9Count=0;
let v9Identity='';
let controlIdentity='';
for(const identity of identities){
  const first=Rollout.decide({config:control,identity,readiness:control.readiness});
  const second=Rollout.decide({config:control,identity,readiness:control.readiness});
  assert.deepEqual(first,second,'cohort assignment must be deterministic');
  if(first.engine==='v9'){v9Count++;if(!v9Identity)v9Identity=identity;}
  else if(!controlIdentity)controlIdentity=identity;
}
const percent=v9Count/identities.length*100;
assert.ok(percent>=0.8&&percent<=1.2,`1% cohort outside tolerance: ${percent}%`);
assert.ok(v9Identity&&controlIdentity);

function memoryStorage(seed={}){
  const map=new Map(Object.entries(seed));
  return{getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};
}
function mockWindow({href=siteRoot,identity=v9Identity,config=control,fetchFailure=false,storage=null}={}){
  let redirected=null;
  const u=new URL(href);
  const localStorage=storage||memoryStorage({[Bootstrap.IDENTITY_KEY]:identity});
  return{
    location:{href:u.href,search:u.search,hash:u.hash,replace:value=>{redirected=value;}},
    localStorage,
    crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},
    TCCV9RolloutEngine:Rollout,
    fetch:async()=>{if(fetchFailure)throw new Error('offline');return{ok:true,status:200,json:async()=>config};},
    get redirected(){return redirected;}
  };
}

(async()=>{
  const candidateWindow=mockWindow({href:siteRoot+'?from=test#results'});
  const candidateResult=await Bootstrap.routeOnce(candidateWindow,scriptSrc);
  assert.equal(candidateResult.outcome,'v9-redirect');
  assert.equal(candidateWindow.redirected,siteRoot+'v9-production-shell/?from=test#results');

  const stableWindow=mockWindow({identity:controlIdentity});
  const stableResult=await Bootstrap.routeOnce(stableWindow,scriptSrc);
  assert.equal(stableResult.outcome,'control');
  assert.equal(stableWindow.redirected,null);

  const shellWindow=mockWindow({href:siteRoot+'v9-production-shell/'});
  const shellResult=await Bootstrap.routeOnce(shellWindow,scriptSrc);
  assert.equal(shellResult.outcome,'not-production-root','shell-loaded stable HTML must never redirect recursively');
  assert.equal(shellWindow.redirected,null);

  const offlineWindow=mockWindow({fetchFailure:true});
  assert.equal((await Bootstrap.routeOnce(offlineWindow,scriptSrc)).outcome,'control-fetch-failed');
  assert.equal(offlineWindow.redirected,null);

  const killedWindow=mockWindow({config:{...control,killSwitch:true}});
  assert.equal((await Bootstrap.routeOnce(killedWindow,scriptSrc)).outcome,'kill-switch');
  assert.equal(killedWindow.redirected,null);

  const blockedWindow=mockWindow({config:{...control,readiness:{ready:false,verdict:'BLOCKED'}}});
  assert.equal((await Bootstrap.routeOnce(blockedWindow,scriptSrc)).outcome,'readiness-blocked');
  assert.equal(blockedWindow.redirected,null);

  const invalidWindow=mockWindow({config:{...control,runtimeFingerprint:'invalid'}});
  assert.equal((await Bootstrap.routeOnce(invalidWindow,scriptSrc)).outcome,'control-invalid');
  assert.equal(invalidWindow.redirected,null);

  const deniedStorage={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  const noIdentityWindow=mockWindow({storage:deniedStorage});
  assert.equal((await Bootstrap.routeOnce(noIdentityWindow,scriptSrc)).outcome,'identity-unavailable');
  assert.equal(noIdentityWindow.redirected,null);

  console.log(JSON.stringify({ok:true,module:'tcc-v9-production-bootstrap',sampleSize:identities.length,v9Count,percent,loopGuard:true,failClosed:true,configOnlyFutureStages:true},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
