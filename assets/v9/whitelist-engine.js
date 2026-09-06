(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9WhitelistEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const normalize=v=>text(v).toLowerCase();
  function normalizeConfig(raw={}){
    return{
      enabled:raw.enabled===true,
      requireReadiness:raw.requireReadiness!==false,
      identities:[...new Set((raw.identities||[]).map(normalize).filter(Boolean))],
      candidatePath:text(raw.candidatePath)||'v9-app/',
      fallbackPath:text(raw.fallbackPath)||'./'
    };
  }
  function readinessState(readiness){if(readiness?.ready===true||readiness?.verdict==='READY')return'READY';if(readiness?.ready===false||readiness?.verdict==='BLOCKED')return'BLOCKED';return'UNKNOWN';}
  function isAllowed(identity,config={}){const c=normalizeConfig(config);return c.enabled&&c.identities.includes(normalize(identity));}
  function decide({identity='',config={},readiness=null,killSwitch=false}={}){
    const c=normalizeConfig(config),ready=readinessState(readiness),allowed=isAllowed(identity,c);
    if(killSwitch)return{engine:'v8',reason:'kill_switch',allowed:false,readiness:ready,path:c.fallbackPath};
    if(!c.enabled)return{engine:'v8',reason:'whitelist_disabled',allowed:false,readiness:ready,path:c.fallbackPath};
    if(!allowed)return{engine:'v8',reason:'identity_not_whitelisted',allowed:false,readiness:ready,path:c.fallbackPath};
    if(c.requireReadiness&&ready!=='READY')return{engine:'v8',reason:ready==='BLOCKED'?'readiness_blocked':'readiness_missing',allowed:true,readiness:ready,path:c.fallbackPath};
    return{engine:'v9',reason:'whitelist_allowed',allowed:true,readiness:ready,path:c.candidatePath};
  }
  return{normalizeConfig,readinessState,isAllowed,decide};
});
