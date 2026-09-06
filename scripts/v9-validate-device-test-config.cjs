#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const FILES={
  rollout:'data/v9/rollout-config.json',
  selfEnrollment:'data/v9/self-enrollment-config.json',
  readiness:'data/v9/access-readiness.json',
  devicePolicy:'data/v9/device-test-policy.json',
  canaryPolicy:'data/v9/canary-policy.json',
  productionShell:'ops/v9/production-shell-readiness.json'
};
function readConfiguration(root=process.cwd()){
  const out={};
  for(const [key,relativePath] of Object.entries(FILES)){
    const absolute=path.join(root,relativePath);
    out[key]=fs.existsSync(absolute)?JSON.parse(fs.readFileSync(absolute,'utf8')):null;
  }
  return out;
}
function failed(checks){return checks.filter(([,valid])=>!valid).map(([message])=>message);}
function validateConfiguration(configuration,{now=new Date(),maximumWindowMinutes=60}={}){
  const rollout=configuration?.rollout||{},self=configuration?.selfEnrollment||{},readiness=configuration?.readiness||{},policy=configuration?.devicePolicy||{},canaryPolicy=configuration?.canaryPolicy||{},shell=configuration?.productionShell||null;
  const checkedAt=new Date(now),nowMs=checkedAt.getTime(),maximumWindowMs=Number(maximumWindowMinutes)*60*1000;
  const selfClosed=self.enabled===false&&self.readinessApproved===false&&!String(self.tokenSha256||'').trim()&&self.expiresAt==null;
  const deviceTestsClosed=policy.enabled===false;
  const commonErrors=failed([
    ['validation time must be valid',Number.isFinite(nowMs)],
    ['rollout stage must be preview or canary',['preview','canary'].includes(rollout.stage)],
    ['kill switch must remain off for a deployable configuration',rollout.killSwitch!==true],
    ['rollout must require readiness',rollout.requireReadiness!==false],
    ['candidate routes must target v9-app/',rollout.canaryPath==='v9-app/'&&rollout.productionPath==='v9-app/']
  ]);

  const closedErrors=failed([
    ['closed rollout stage must be preview',rollout.stage==='preview'],
    ['closed random canary must be 0%',Number(rollout.canaryPercent)===0],
    ['closed canary policy must be inactive',canaryPolicy.active===false],
    ['access readiness must be BLOCKED',readiness.ready===false&&readiness.verdict==='BLOCKED'],
    ['self-enrollment must be disabled',selfClosed],
    ['device-test policy must be disabled',deviceTestsClosed],
    ['production shell must not be READY',!shell||shell.ready!==true]
  ]);
  if(commonErrors.length===0&&closedErrors.length===0)return{ok:true,mode:'CLOSED',checkedAt:checkedAt.toISOString(),errors:[]};

  const shellBlockedErrors=failed([
    ['production-shell gate must exist',Boolean(shell)],
    ['production-shell gate must be BLOCKED',shell?.state==='BLOCKED'&&shell?.ready===false],
    ['production-shell control path must be explicit',Boolean(String(shell?.controlPath||'').trim())],
    ['blocked-shell rollout must remain preview',rollout.stage==='preview'],
    ['blocked-shell random canary must be 0%',Number(rollout.canaryPercent)===0],
    ['blocked-shell canary policy must be inactive',canaryPolicy.active===false],
    ['validated engine readiness must remain READY',readiness.ready===true&&readiness.verdict==='READY'],
    ['blocked-shell fallback must match the actual production control path',Boolean(shell)&&rollout.v8Path===shell.controlPath],
    ['self-enrollment must stay disabled while shell is blocked',selfClosed],
    ['device-test policy must stay disabled while shell is blocked',deviceTestsClosed]
  ]);
  if(commonErrors.length===0&&shellBlockedErrors.length===0)return{ok:true,mode:'ENGINE_READY_SHELL_BLOCKED',checkedAt:checkedAt.toISOString(),publicUserExposurePercent:0,errors:[]};

  const expiresAtMs=Date.parse(self.expiresAt),openedAtMs=Date.parse(readiness.updatedAt),configuredWindowMinutes=Number(policy.maxWindowMinutes),maximumGrantMinutes=Number(self.maxGrantMinutes);
  const controlledErrors=failed([
    ['controlled device window requires no blocked production-shell gate',!shell||shell.ready!==false],
    ['controlled rollout stage must remain preview',rollout.stage==='preview'],
    ['controlled random canary must remain 0%',Number(rollout.canaryPercent)===0],
    ['controlled canary policy must remain inactive',canaryPolicy.active===false],
    ['access readiness must be READY',readiness.ready===true&&readiness.verdict==='READY'],
    ['self-enrollment must be enabled',self.enabled===true],
    ['self-enrollment must require readiness',self.requireReadiness!==false],
    ['self-enrollment readiness must be approved',self.readinessApproved===true],
    ['active token must be represented by one SHA-256 hash',/^[a-f0-9]{64}$/i.test(String(self.tokenSha256||'').trim())],
    ['active token version must be set',Boolean(String(self.tokenVersion||'').trim())],
    ['active window expiry must be valid',Number.isFinite(expiresAtMs)],
    ['active window must not be expired',Number.isFinite(expiresAtMs)&&expiresAtMs>nowMs],
    ['readiness update time must be valid',Number.isFinite(openedAtMs)],
    ['readiness update time must not be in the future',Number.isFinite(openedAtMs)&&openedAtMs<=nowMs+5*60*1000],
    ['active expiry must follow readiness approval',Number.isFinite(expiresAtMs)&&Number.isFinite(openedAtMs)&&expiresAtMs>openedAtMs],
    ['active window must be bounded to 60 minutes',Number.isFinite(expiresAtMs)&&Number.isFinite(openedAtMs)&&expiresAtMs-openedAtMs<=maximumWindowMs],
    ['grant duration must be between 1 and 60 minutes',Number.isFinite(maximumGrantMinutes)&&maximumGrantMinutes>=1&&maximumGrantMinutes<=maximumWindowMinutes],
    ['device-test policy must be enabled',policy.enabled===true],
    ['device-test policy must require readiness',policy.requireReadiness===true],
    ['device-test policy must require canary 0%',policy.requireCanaryPercentZero===true],
    ['device-test policy must auto-close on rollback',policy.autoCloseOnRollback===true],
    ['device-test policy window must be between 1 and 60 minutes',Number.isFinite(configuredWindowMinutes)&&configuredWindowMinutes>=1&&configuredWindowMinutes<=maximumWindowMinutes],
    ['grant duration must not exceed the policy window',Number.isFinite(maximumGrantMinutes)&&Number.isFinite(configuredWindowMinutes)&&maximumGrantMinutes<=configuredWindowMinutes],
    ['configured policy must cover the active window',Number.isFinite(expiresAtMs)&&Number.isFinite(openedAtMs)&&Number.isFinite(configuredWindowMinutes)&&expiresAtMs-openedAtMs<=configuredWindowMinutes*60*1000],
    ['device test must require at least 10 runs',Number(policy.minimumRuns)>=10],
    ['device test must require at least 10 successful runs',Number(policy.minimumSuccessfulRuns)>=10]
  ]);
  if(commonErrors.length===0&&controlledErrors.length===0)return{ok:true,mode:'CONTROLLED_WINDOW',checkedAt:checkedAt.toISOString(),expiresAt:new Date(expiresAtMs).toISOString(),tokenVersion:String(self.tokenVersion).trim(),errors:[]};

  const initialPercent=Number(canaryPolicy.initialPercent||1);
  const canaryErrors=failed([
    ['production-shell gate must be READY before public canary',Boolean(shell)&&shell.ready===true&&shell.state==='READY'],
    ['canary rollout stage must be canary',rollout.stage==='canary'],
    ['canary percent must equal the initial policy stage',Number(rollout.canaryPercent)===initialPercent&&initialPercent>0&&initialPercent<=100],
    ['canary policy must be active',canaryPolicy.active===true],
    ['canary policy must contain the active stage',(canaryPolicy.stages||[]).some(stage=>Number(stage.percent)===initialPercent)],
    ['access readiness must be READY',readiness.ready===true&&readiness.verdict==='READY'],
    ['canary control path must match the production-shell control path',Boolean(shell)&&rollout.v8Path===shell.controlPath],
    ['self-enrollment must stay disabled during random canary',selfClosed],
    ['device-test policy must stay disabled during random canary',deviceTestsClosed]
  ]);
  if(commonErrors.length===0&&canaryErrors.length===0)return{ok:true,mode:'CANARY',checkedAt:checkedAt.toISOString(),canaryPercent:initialPercent,controlPath:shell.controlPath,errors:[]};

  const candidates=[
    {mode:'CLOSED',errors:[...commonErrors,...closedErrors]},
    {mode:'ENGINE_READY_SHELL_BLOCKED',errors:[...commonErrors,...shellBlockedErrors]},
    {mode:'CONTROLLED_WINDOW',errors:[...commonErrors,...controlledErrors]},
    {mode:'CANARY',errors:[...commonErrors,...canaryErrors]}
  ].sort((a,b)=>a.errors.length-b.errors.length);
  return{ok:false,mode:'INVALID',checkedAt:Number.isFinite(nowMs)?checkedAt.toISOString():null,errors:candidates[0].errors};
}
function run(){const result=validateConfiguration(readConfiguration());if(!result.ok){console.error(`BLOCKED: invalid V9 access configuration\n- ${result.errors.join('\n- ')}`);process.exitCode=1;return;}console.log(`PASS V9 access configuration: ${result.mode}`);if(result.expiresAt)console.log(`expiresAt=${result.expiresAt}`);if(result.canaryPercent)console.log(`canaryPercent=${result.canaryPercent}`);if(result.publicUserExposurePercent===0)console.log('publicUserExposurePercent=0');}
if(require.main===module)run();
module.exports={FILES,readConfiguration,validateConfiguration};
