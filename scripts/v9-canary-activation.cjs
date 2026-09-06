#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Observation=require('./v9-canary-observation.cjs');
const CanaryPolicy=require('../assets/v9/canary-policy-engine.js');

function readJson(root,relativePath){return JSON.parse(fs.readFileSync(path.join(root,relativePath),'utf8'));}
function validDate(value){const time=Date.parse(value||'');return Number.isFinite(time)?time:null;}

function validateActivation({activation,observation,policy,rollout,readiness,deploymentWorkflow='',now=new Date(),sourceFingerprint,deploymentFingerprint,currentFingerprint}={}){
  const errors=[];
  const checkedAt=new Date(now),nowMs=checkedAt.getTime();
  if(!Number.isFinite(nowMs))errors.push('invalid_validation_time');
  const historicalPolicy={...policy,active:false};
  const historicalRollout={...rollout,stage:'preview',canaryPercent:0};
  const historical=Observation.validateObservation(observation,historicalPolicy,historicalRollout,deploymentWorkflow);
  if(!historical.ok)errors.push(...historical.errors.map(error=>`observation:${error}`));
  if(activation?.schemaVersion!==1||activation?.type!=='tcc-v9-canary-activation')errors.push('invalid_activation_schema');
  if(activation?.status!=='APPROVED_FOR_DEPLOYMENT')errors.push('activation_not_approved');
  if(activation?.stage!=='canary')errors.push('activation_stage_must_be_canary');
  const initialPercent=Number(policy?.initialPercent||1);
  const firstStage=(policy?.stages||[]).find(stage=>Number(stage.percent)===initialPercent);
  if(!firstStage)errors.push('initial_canary_stage_missing');
  if(policy?.active!==true)errors.push('canary_policy_not_active');
  if(rollout?.stage!=='canary')errors.push('rollout_stage_not_canary');
  if(Number(rollout?.canaryPercent)!==initialPercent)errors.push('rollout_percent_not_initial_stage');
  if(Number(activation?.percent)!==initialPercent)errors.push('activation_percent_mismatch');
  if(rollout?.killSwitch===true)errors.push('kill_switch_active');
  if(rollout?.requireReadiness===false)errors.push('readiness_not_required');
  if(readiness?.ready!==true||readiness?.verdict!=='READY')errors.push('readiness_not_ready');
  if(rollout?.v8Path!=='v8-app/')errors.push('v8_control_path_invalid');
  if(rollout?.canaryPath!=='v9-app/'||rollout?.productionPath!=='v9-app/')errors.push('v9_candidate_path_invalid');
  const eligibleMs=validDate(observation?.window?.eligibleAfter),approvedMs=validDate(activation?.approvedAt),preparedMs=validDate(activation?.preparedAt),validationCompletedMs=validDate(activation?.fullWindowValidation?.completedAt);
  if(eligibleMs==null)errors.push('invalid_eligible_time');
  if(approvedMs==null||eligibleMs!=null&&approvedMs<eligibleMs)errors.push('approval_before_full_window');
  if(validationCompletedMs==null||eligibleMs!=null&&validationCompletedMs<eligibleMs)errors.push('full_window_validation_too_early');
  if(preparedMs==null||validationCompletedMs!=null&&preparedMs<validationCompletedMs)errors.push('activation_prepared_before_validation');
  if(preparedMs!=null&&Number.isFinite(nowMs)&&preparedMs>nowMs+5*60*1000)errors.push('activation_prepared_in_future');
  if(!Number.isInteger(Number(activation?.fullWindowValidation?.runId))||Number(activation.fullWindowValidation.runId)<=0)errors.push('full_window_run_missing');
  if(activation?.fullWindowValidation?.conclusion!=='success')errors.push('full_window_run_not_successful');
  if(activation?.candidate?.observationSourceSha!==observation?.candidate?.sourceSha)errors.push('activation_source_sha_mismatch');
  if(activation?.candidate?.runtimeFingerprint!==observation?.candidate?.runtimeFingerprint)errors.push('activation_fingerprint_mismatch');
  const fingerprint=observation?.candidate?.runtimeFingerprint;
  if(sourceFingerprint!==fingerprint)errors.push('source_build_changed');
  if(deploymentFingerprint!==fingerprint)errors.push('deployment_build_changed');
  if(currentFingerprint!==fingerprint)errors.push('current_build_changed');
  const derived=historical.derived||null;
  if(derived){
    const evidence=activation?.evidence||{};
    for(const key of ['runs','passes','failures','sourceErrors','routingErrors','criticalParityErrors','averageLatencyMs','maxLatencyMs'])if(Number(evidence[key])!==Number(derived[key]))errors.push(`activation_evidence_mismatch:${key}`);
    if(firstStage&&Number(derived.runs)<Number(firstStage.minRuns||0))errors.push('minimum_runs_not_met');
    if(firstStage&&eligibleMs!=null&&Number(observation.window.minimumHours)<Number(firstStage.minHours||0))errors.push('minimum_hours_not_met');
    const rollbackSignals=CanaryPolicy.rollbackSignals(policy,derived,{criticalErrors:derived.criticalParityErrors});
    errors.push(...rollbackSignals.filter(signal=>signal.triggered).map(signal=>`rollback:${signal.id}`));
  }
  return{decision:errors.length?'BLOCKED':'CANARY_READY',safe:errors.length===0,errors,checkedAt:Number.isFinite(nowMs)?checkedAt.toISOString():null,stage:'canary',percent:initialPercent,fullWindowRunId:Number(activation?.fullWindowValidation?.runId||0),candidate:{runtimeFingerprint:fingerprint,stableBuild:sourceFingerprint===fingerprint&&deploymentFingerprint===fingerprint&&currentFingerprint===fingerprint},metrics:derived};
}
function parseArgs(argv){const args={now:null,ref:'HEAD',json:false};for(let i=0;i<argv.length;i++){if(argv[i]==='--now')args.now=argv[++i];else if(argv[i]==='--ref')args.ref=argv[++i];else if(argv[i]==='--json')args.json=true;else throw new Error(`unknown argument: ${argv[i]}`);}return args;}
function main(){
  const args=parseArgs(process.argv.slice(2)),root=path.resolve(__dirname,'..');
  const activation=readJson(root,'ops/v9/canary-activation.json'),observation=readJson(root,'ops/v9/canary-observation.json'),policy=readJson(root,'data/v9/canary-policy.json'),rollout=readJson(root,'data/v9/rollout-config.json'),readiness=readJson(root,'data/v9/access-readiness.json');
  const deploymentWorkflow=fs.readFileSync(path.join(root,observation.candidate.deploymentLock.workflowPath),'utf8');
  const sourceFingerprint=Observation.runtimeFingerprint(observation.candidate.sourceSha,root),deploymentFingerprint=Observation.runtimeFingerprint(observation.candidate.deploymentLock.automaticEventSha,root),currentFingerprint=Observation.runtimeFingerprint(args.ref,root);
  const result=validateActivation({activation,observation,policy,rollout,readiness,deploymentWorkflow,now:args.now||new Date(),sourceFingerprint,deploymentFingerprint,currentFingerprint});
  console.log(JSON.stringify(result,null,2));if(!result.safe)process.exitCode=1;
}
if(require.main===module){try{main();}catch(error){console.error(`V9 canary activation blocked: ${error.message}`);process.exitCode=1;}}
module.exports={readJson,validateActivation,validDate};
