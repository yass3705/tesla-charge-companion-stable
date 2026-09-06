(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){
    root.TCCV9ProductionBootstrap=api;
    if(root.document&&root.location){
      api.autoStart(root).catch(err=>console.warn('[TCC V9 bootstrap] fail closed:',err?.message||err));
    }
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const PINNED_SHA='8d2c20b7c76004389edd8f4a3b80d6b314900ba0';
  const PINNED_FINGERPRINT='sha256:455b371c14342a83d55fdfde0e3f2a63e7e3f967c2c84fb3fc31b6fe7bffd697';
  const IDENTITY_KEY='tccV9CanaryIdentityV1';
  const BOOTSTRAP_FILE='assets/v9-production-bootstrap.js';
  const CONTROL_FILE='v9-production-control.json';
  const ROLLOUT_ENGINE_FILE='v9-production-runtime/assets/v9/rollout-engine.js';

  const text=value=>String(value==null?'':value).trim();

  function siteRootFromScript(src){
    const scriptUrl=new URL(src);
    if(!scriptUrl.pathname.endsWith('/'+BOOTSTRAP_FILE))throw new Error('bootstrap source path mismatch');
    return new URL('../',scriptUrl);
  }

  function isProductionRoot(locationLike,siteRoot){
    const loc=new URL(locationLike?.href||String(locationLike),siteRoot);
    const rootPath=siteRoot.pathname.endsWith('/')?siteRoot.pathname:siteRoot.pathname+'/';
    return loc.origin===siteRoot.origin&&(loc.pathname===rootPath||loc.pathname===rootPath+'index.html');
  }

  function validateControl(raw){
    const c=raw&&typeof raw==='object'?raw:null;
    if(!c)return{ok:false,reason:'control_missing'};
    if(c.schemaVersion!==1)return{ok:false,reason:'schema_mismatch'};
    if(c.observedCandidateSha!==PINNED_SHA)return{ok:false,reason:'candidate_sha_mismatch'};
    if(c.runtimeFingerprint!==PINNED_FINGERPRINT)return{ok:false,reason:'runtime_fingerprint_mismatch'};
    if(!['preview','canary','production'].includes(c.stage))return{ok:false,reason:'stage_invalid'};
    const percent=Number(c.canaryPercent);
    if(!Number.isFinite(percent)||percent<0||percent>100)return{ok:false,reason:'percent_invalid'};
    if(text(c.v8Path)!=='./')return{ok:false,reason:'control_path_invalid'};
    if(text(c.canaryPath)!=='v9-production-shell/'||text(c.productionPath)!=='v9-production-shell/')return{ok:false,reason:'candidate_path_invalid'};
    if(!text(c.salt))return{ok:false,reason:'salt_missing'};
    if(c.requireReadiness!==true)return{ok:false,reason:'readiness_gate_required'};
    return{ok:true,control:{...c,canaryPercent:percent}};
  }

  function persistentIdentity(w){
    try{
      const storage=w.localStorage;
      let identity=text(storage.getItem(IDENTITY_KEY));
      if(identity&&identity.length>=8&&identity.length<=160)return identity;
      if(!w.crypto||typeof w.crypto.randomUUID!=='function')return null;
      identity='tcc-'+w.crypto.randomUUID();
      storage.setItem(IDENTITY_KEY,identity);
      return storage.getItem(IDENTITY_KEY)===identity?identity:null;
    }catch(_){return null;}
  }

  function loadRolloutEngine(w,siteRoot){
    if(w.TCCV9RolloutEngine&&typeof w.TCCV9RolloutEngine.decide==='function')return Promise.resolve(w.TCCV9RolloutEngine);
    return new Promise((resolve,reject)=>{
      const script=w.document.createElement('script');
      script.src=new URL(ROLLOUT_ENGINE_FILE,siteRoot).href;
      script.async=true;
      script.dataset.tccV9RolloutEngine='1';
      script.onload=()=>w.TCCV9RolloutEngine&&typeof w.TCCV9RolloutEngine.decide==='function'?resolve(w.TCCV9RolloutEngine):reject(new Error('rollout engine unavailable after load'));
      script.onerror=()=>reject(new Error('rollout engine load failed'));
      w.document.head.appendChild(script);
    });
  }

  function candidateTarget(w,siteRoot,path){
    const target=new URL(path,siteRoot);
    target.search=w.location.search||'';
    target.hash=w.location.hash||'';
    return target.href;
  }

  async function routeOnce(w,scriptSrc){
    const siteRoot=siteRootFromScript(scriptSrc);
    if(!isProductionRoot(w.location,siteRoot))return{outcome:'not-production-root'};

    let response;
    try{
      response=await w.fetch(new URL(CONTROL_FILE,siteRoot).href,{cache:'no-store'});
    }catch(err){return{outcome:'control-fetch-failed',reason:err?.message||String(err)};}
    if(!response?.ok)return{outcome:'control-fetch-failed',status:response?.status||0};

    let raw;
    try{raw=await response.json();}catch(err){return{outcome:'control-invalid-json',reason:err?.message||String(err)};}
    const checked=validateControl(raw);
    if(!checked.ok)return{outcome:'control-invalid',reason:checked.reason};
    const control=checked.control;

    if(control.active!==true)return{outcome:'inactive'};
    if(control.killSwitch===true)return{outcome:'kill-switch'};
    if(control.readiness?.ready!==true||control.readiness?.verdict!=='READY')return{outcome:'readiness-blocked'};

    const identity=persistentIdentity(w);
    if(!identity)return{outcome:'identity-unavailable'};

    let engine;
    try{engine=await loadRolloutEngine(w,siteRoot);}catch(err){return{outcome:'rollout-engine-failed',reason:err?.message||String(err)};}
    const decision=engine.decide({config:control,identity,readiness:control.readiness});
    if(decision?.engine!=='v9')return{outcome:'control',decision};
    if(decision.path!=='v9-production-shell/')return{outcome:'unsafe-decision-path',decision};

    const target=candidateTarget(w,siteRoot,decision.path);
    w.location.replace(target);
    return{outcome:'v9-redirect',decision,target};
  }

  function currentScriptSource(w){
    const current=w.document.currentScript;
    if(current?.src&&current.src.includes(BOOTSTRAP_FILE))return current.src;
    const scripts=Array.from(w.document.scripts||[]);
    const found=scripts.find(script=>script.src&&script.src.includes(BOOTSTRAP_FILE));
    return found?.src||'';
  }

  async function autoStart(w){
    const src=currentScriptSource(w);
    if(!src)return{outcome:'bootstrap-script-unresolved'};
    return routeOnce(w,src);
  }

  return{
    PINNED_SHA,
    PINNED_FINGERPRINT,
    IDENTITY_KEY,
    BOOTSTRAP_FILE,
    CONTROL_FILE,
    ROLLOUT_ENGINE_FILE,
    siteRootFromScript,
    isProductionRoot,
    validateControl,
    persistentIdentity,
    candidateTarget,
    routeOnce,
    autoStart
  };
});
