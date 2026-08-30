(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9RolloutEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const STAGES=['preview','canary','production'];
  const text=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
  function hash(value){let h=2166136261;for(const ch of text(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function bucket(identity,salt='tcc-v9'){return hash(`${salt}|${text(identity)||'anonymous'}`)%10000/100;}
  function normalizeConfig(raw={}){
    const stage=STAGES.includes(raw.stage)?raw.stage:'preview',canaryPercent=clamp(num(raw.canaryPercent)??0,0,100);
    return{stage,canaryPercent,killSwitch:raw.killSwitch===true,requireReadiness:raw.requireReadiness!==false,salt:text(raw.salt)||'tcc-v9-rollout',previewPath:text(raw.previewPath)||'v9-preview/',v8Path:text(raw.v8Path)||'./',productionPath:text(raw.productionPath)||'v9-preview/'};
  }
  function readinessState(readiness){if(readiness?.ready===true||readiness?.verdict==='READY')return'READY';if(readiness?.ready===false||readiness?.verdict==='BLOCKED')return'BLOCKED';return'UNKNOWN';}
  function decide({config={},identity='',readiness=null,requestedStage=null}={}){
    const c=normalizeConfig(config),requested=STAGES.includes(requestedStage)?requested:c.stage,ready=readinessState(readiness),b=bucket(identity,c.salt);
    if(c.killSwitch)return{engine:'v8',stage:'fallback',reason:'kill_switch',bucket:b,readiness:ready,path:c.v8Path};
    if(requested==='preview')return{engine:'v9',stage:'preview',reason:'preview_isolated',bucket:b,readiness:ready,path:c.previewPath};
    if(c.requireReadiness&&ready!=='READY')return{engine:'v8',stage:'fallback',reason:ready==='BLOCKED'?'readiness_blocked':'readiness_missing',bucket:b,readiness:ready,path:c.v8Path};
    if(requested==='canary'){
      if(b<c.canaryPercent)return{engine:'v9',stage:'canary',reason:'canary_bucket',bucket:b,readiness:ready,path:c.previewPath};
      return{engine:'v8',stage:'canary-control',reason:'canary_control_bucket',bucket:b,readiness:ready,path:c.v8Path};
    }
    if(requested==='production')return{engine:'v9',stage:'production',reason:'readiness_green',bucket:b,readiness:ready,path:c.productionPath};
    return{engine:'v8',stage:'fallback',reason:'invalid_stage',bucket:b,readiness:ready,path:c.v8Path};
  }
  function promotionAllowed(from,to,readiness){const a=STAGES.indexOf(from),b=STAGES.indexOf(to),ready=readinessState(readiness);if(a<0||b<0||b!==a+1)return false;if(to==='preview')return true;return ready==='READY';}
  function rollback(config={},reason='manual_rollback'){const c=normalizeConfig(config);return{...c,killSwitch:true,rollbackReason:text(reason)||'manual_rollback'};}
  return{STAGES,normalizeConfig,readinessState,decide,promotionAllowed,rollback,bucket,hash};
});
