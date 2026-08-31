(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.TCCV9AccessRouterEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
const text=v=>String(v==null?'':v).trim();
function readinessState(readiness){if(readiness?.ready===true||readiness?.verdict==='READY')return'READY';if(readiness?.ready===false||readiness?.verdict==='BLOCKED')return'BLOCKED';return'UNKNOWN';}
function route({identity='',grant=null,selfConfig={},whitelistConfig={},rolloutConfig={},readiness=null,requestedStage=null,killSwitch=null,now=new Date(),engines={}}={}){
  const Self=engines.selfEnrollment||(typeof globalThis!=='undefined'?globalThis.TCCV9SelfEnrollmentEngine:null),White=engines.whitelist||(typeof globalThis!=='undefined'?globalThis.TCCV9WhitelistEngine:null),Roll=engines.rollout||(typeof globalThis!=='undefined'?globalThis.TCCV9RolloutEngine:null);
  if(!Self||!White||!Roll)throw new Error('access router dependencies unavailable');
  const ready=readinessState(readiness),roll=Roll.normalizeConfig(rolloutConfig),off=killSwitch==null?roll.killSwitch:killSwitch===true;
  if(off)return{engine:'v8',source:'safety',reason:'kill_switch',readiness:ready,path:roll.v8Path};
  const selfState=Self.evaluate({grant,identity,config:selfConfig,killSwitch:false,now});
  if(selfState.active){
    if(ready!=='READY')return{engine:'v8',source:'self_enroll',reason:ready==='BLOCKED'?'readiness_blocked':'readiness_missing',readiness:ready,path:roll.v8Path};
    return{engine:'v9',source:'self_enroll',reason:'temporary_grant',readiness:ready,path:text(whitelistConfig?.candidatePath)||roll.productionPath,expiresAt:selfState.expiresAt};
  }
  const white=White.decide({identity,config:whitelistConfig,readiness,killSwitch:false});
  if(white.engine==='v9')return{...white,source:'whitelist'};
  const activeStage=requestedStage||(roll.stage==='canary'||roll.stage==='production'?roll.stage:'canary');
  const random=Roll.decide({config:rolloutConfig,identity,readiness,requestedStage:activeStage});
  if(random.engine==='v9')return{...random,source:'rollout'};
  return{engine:'v8',source:'control',reason:selfState.reason||white.reason||random.reason||'v8_control',readiness:ready,path:roll.v8Path,details:{selfEnroll:selfState.reason,whitelist:white.reason,rollout:random.reason}};
}
return{route,readinessState};
});