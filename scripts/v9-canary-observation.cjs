#!/usr/bin/env node
'use strict';

const crypto=require('node:crypto');
const cp=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const CanaryPolicy=require('../assets/v9/canary-policy-engine.js');

const RUNTIME_PATHS=Object.freeze([
  'v9-app',
  'v9-gate',
  'assets/v9',
  'data/v9',
  'data/tesla_stations.json',
  'data/ionity_direct_stations_france.json.gz',
  'data/atlante_direct_stations_france.json.gz',
  'data/powerdot_direct_france.json.gz',
  'data/netherlands_direct_tariffs_v1.json',
  'data/non_tesla_netherlands'
]);
const PROMOTION_CONTROL_PATHS=new Set([
  'data/v9/access-readiness.json',
  'data/v9/canary-policy.json',
  'data/v9/rollout-config.json',
  'data/v9/self-enrollment-config.json',
  'data/v9/device-test-policy.json',
  'data/v9/whitelist-config.json'
]);

function readJson(root,relativePath){
  return JSON.parse(fs.readFileSync(path.join(root,relativePath),'utf8'));
}

function fingerprintTree(tree){
  if(!tree.trim())throw new Error('no deployed runtime entries found');
  const payload=tree.trimEnd().split('\n').filter(line=>{
    const separator=line.indexOf('\t');
    return separator>=0&&!PROMOTION_CONTROL_PATHS.has(line.slice(separator+1));
  }).join('\n')+'\n';
  return `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
}

function runtimeFingerprint(ref='HEAD',root=process.cwd()){
  const tree=cp.execFileSync('git',['ls-tree','-r','--full-tree',ref,'--',...RUNTIME_PATHS],{cwd:root,encoding:'utf8'});
  if(!tree.trim())throw new Error(`no deployed runtime entries found at ${ref}`);
  return fingerprintTree(tree);
}

function deriveEvidence(evidence={}){
  const packs=Array.isArray(evidence.packs)?evidence.packs:[];
  if(!packs.length)throw new Error('observation evidence must contain at least one pack');
  const scenarios=packs.flatMap(pack=>Array.isArray(pack.scenarios)?pack.scenarios:[]);
  const runs=scenarios.length;
  const passes=scenarios.filter(row=>row.status==='PASS').length;
  const failures=runs-passes;
  const sourceErrors=packs.reduce((sum,pack)=>sum+Number(pack.sourceErrors||0),0);
  const routingErrors=packs.reduce((sum,pack)=>sum+Number(pack.routingErrors||0),0);
  const routeAttempts=scenarios.reduce((sum,row)=>sum+Number(row.stationsSelected||0),0);
  const routesSucceeded=scenarios.reduce((sum,row)=>sum+Number(row.routesSucceeded||0),0);
  const stationsScored=scenarios.reduce((sum,row)=>sum+Number(row.stationsScored||0),0);
  const totalDurationMs=scenarios.reduce((sum,row)=>sum+Number(row.durationMs||0),0);
  const maxLatencyMs=Math.max(...scenarios.map(row=>Number(row.durationMs||0)));
  return{
    packs:packs.length,
    runs,
    passes,
    failures,
    sourceErrors,
    routingErrors,
    routeAttempts,
    routesSucceeded,
    stationsScored,
    totalDurationMs,
    averageLatencyMs:runs?Math.round(totalDurationMs/runs):0,
    maxLatencyMs,
    criticalParityErrors:Number(evidence.aggregate?.criticalParityErrors||0)
  };
}

function sameAggregate(expected={},actual={}){
  const keys=['packs','runs','passes','failures','sourceErrors','routingErrors','routeAttempts','routesSucceeded','stationsScored','totalDurationMs','averageLatencyMs','maxLatencyMs','criticalParityErrors'];
  return keys.every(key=>Number(expected[key])===Number(actual[key]));
}

function validateObservation(observation,policy,rollout,deploymentWorkflow=''){
  const errors=[];
  if(observation?.schemaVersion!==1||observation?.type!=='tcc-v9-precanary-observation')errors.push('invalid_observation_schema');
  if(observation?.state!=='OBSERVING')errors.push('observation_not_active');
  if(!/^[a-f0-9]{40}$/.test(String(observation?.candidate?.sourceSha||'')))errors.push('invalid_candidate_sha');
  if(!/^sha256:[a-f0-9]{64}$/.test(String(observation?.candidate?.runtimeFingerprint||'')))errors.push('invalid_runtime_fingerprint');
  const start=Date.parse(observation?.window?.startedAt||'');
  const eligible=Date.parse(observation?.window?.eligibleAfter||'');
  if(!Number.isFinite(start)||!Number.isFinite(eligible))errors.push('invalid_observation_window');
  const firstStage=(policy?.stages||[]).find(row=>Number(row.percent)===Number(policy?.initialPercent||1));
  if(!firstStage)errors.push('missing_initial_canary_stage');
  if(Number(observation?.window?.minimumHours)!==Number(firstStage?.minHours))errors.push('minimum_hours_policy_mismatch');
  if(Number(observation?.window?.minimumRuns)!==Number(firstStage?.minRuns))errors.push('minimum_runs_policy_mismatch');
  if(Number.isFinite(start)&&Number.isFinite(eligible)&&eligible-start!==Number(observation?.window?.minimumHours)*3600000)errors.push('eligible_after_mismatch');
  if(Number(observation?.window?.trafficPercent)!==0)errors.push('observation_traffic_not_zero');
  if(policy?.active!==false)errors.push('canary_policy_must_remain_inactive');
  if(rollout?.stage!=='preview'||Number(rollout?.canaryPercent)!==0)errors.push('rollout_must_remain_preview_zero');
  if(observation?.approval?.status!=='RECORDED'||observation?.approval?.scope!=='begin_precanary_observation')errors.push('observation_approval_missing');
  const lock=observation?.candidate?.deploymentLock||{};
  if(lock.workflowPath!=='.github/workflows/v9-device-test-pages.yml'||lock.automaticPushSha!==observation?.candidate?.sourceSha||lock.manualReplacementRequired!==true)errors.push('invalid_pages_deployment_lock');
  if(!String(deploymentWorkflow).includes(`github.sha == '${observation?.candidate?.sourceSha}'`))errors.push('pages_deployment_lock_missing');
  let derived=null;
  try{derived=deriveEvidence(observation?.evidence);}catch(error){errors.push(error.message);}
  if(derived&&!sameAggregate(observation?.evidence?.aggregate,derived))errors.push('aggregate_evidence_mismatch');
  if(derived){
    for(const pack of observation.evidence.packs){
      const scenarios=Array.isArray(pack.scenarios)?pack.scenarios:[];
      const passCount=scenarios.filter(row=>row.status==='PASS').length;
      const total=scenarios.reduce((sum,row)=>sum+Number(row.durationMs||0),0);
      if(Number(pack.runs)!==scenarios.length||Number(pack.passes)!==passCount||Number(pack.failures)!==scenarios.length-passCount)errors.push(`pack_count_mismatch:${pack.id}`);
      if(Math.abs(Number(pack.averageLatencyMs)-Math.round(total/Math.max(1,scenarios.length)))>1)errors.push(`pack_latency_mismatch:${pack.id}`);
      if(scenarios.some(row=>Number(row.routesSucceeded)>Number(row.stationsSelected)))errors.push(`pack_routes_invalid:${pack.id}`);
    }
  }
  return{ok:errors.length===0,errors,derived,firstStage,start,eligible};
}

function evaluateObservation({observation,policy,rollout,readiness,deploymentWorkflow='',now=new Date(),sourceFingerprint,currentFingerprint}){
  const validation=validateObservation(observation,policy,rollout,deploymentWorkflow);
  if(!validation.ok)return{decision:'INVALID',safe:false,reasons:validation.errors};
  const nowMs=new Date(now).getTime();
  if(!Number.isFinite(nowMs))return{decision:'INVALID',safe:false,reasons:['invalid_evaluation_time']};
  const observedHours=Math.max(0,(nowMs-validation.start)/3600000);
  const fingerprint=observation.candidate.runtimeFingerprint;
  const stableBuild=sourceFingerprint===fingerprint&&currentFingerprint===fingerprint;
  const metrics={...validation.derived,observedHours};
  const promotion=CanaryPolicy.evaluate({
    policy,
    currentPercent:0,
    metrics,
    readiness,
    parity:{criticalErrors:validation.derived.criticalParityErrors},
    build:{startedSha:fingerprint,currentSha:currentFingerprint,stable:stableBuild}
  });
  const rollbackReasons=promotion.signals.filter(signal=>signal.triggered).map(signal=>signal.id);
  let decision='WINDOW_COMPLETE';
  const reasons=[];
  if(!stableBuild){decision='RESET_REQUIRED';reasons.push('build_changed');}
  else if(rollbackReasons.length){decision='ROLLBACK';reasons.push(...rollbackReasons);}
  else{
    if(observedHours<Number(observation.window.minimumHours))reasons.push('minimum_observation_not_met');
    if(validation.derived.runs<Number(observation.window.minimumRuns))reasons.push('minimum_runs_not_met');
    if(reasons.length)decision='OBSERVING';
  }
  return{
    decision,
    safe:!['INVALID','RESET_REQUIRED','ROLLBACK'].includes(decision),
    reasons,
    candidate:{sourceSha:observation.candidate.sourceSha,runtimeFingerprint:fingerprint,stableBuild},
    window:{startedAt:observation.window.startedAt,eligibleAfter:observation.window.eligibleAfter,observedHours:Number(observedHours.toFixed(3)),trafficPercent:0},
    metrics:validation.derived,
    promotion
  };
}

function parseArgs(argv){
  const args={now:null,ref:'HEAD',json:false};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--now')args.now=argv[++i];
    else if(argv[i]==='--ref')args.ref=argv[++i];
    else if(argv[i]==='--json')args.json=true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

function main(){
  const args=parseArgs(process.argv.slice(2));
  const root=path.resolve(__dirname,'..');
  const observation=readJson(root,'ops/v9/canary-observation.json');
  const policy=readJson(root,'data/v9/canary-policy.json');
  const rollout=readJson(root,'data/v9/rollout-config.json');
  const readiness=readJson(root,'data/v9/access-readiness.json');
  const deploymentWorkflow=fs.readFileSync(path.join(root,observation.candidate.deploymentLock.workflowPath),'utf8');
  const sourceFingerprint=runtimeFingerprint(observation.candidate.sourceSha,root);
  const currentFingerprint=runtimeFingerprint(args.ref,root);
  const result=evaluateObservation({observation,policy,rollout,readiness,deploymentWorkflow,now:args.now||new Date(),sourceFingerprint,currentFingerprint});
  console.log(JSON.stringify(result,null,2));
  if(!result.safe)process.exitCode=1;
}

if(require.main===module){
  try{main();}catch(error){console.error(`V9 pre-canary observation blocked: ${error.message}`);process.exitCode=1;}
}

module.exports={PROMOTION_CONTROL_PATHS,RUNTIME_PATHS,deriveEvidence,evaluateObservation,fingerprintTree,runtimeFingerprint,sameAggregate,validateObservation};
