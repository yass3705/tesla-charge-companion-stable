(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9CanaryPolicyEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const text=v=>String(v==null?'':v).trim();
  function stageFor(policy,percent){return (policy?.stages||[]).find(x=>num(x.percent)===num(percent))||null;}
  function nextStage(policy,percent){const rows=[...(policy?.stages||[])].sort((a,b)=>Number(a.percent)-Number(b.percent));return rows.find(x=>Number(x.percent)>Number(percent))||null;}
  function rollbackSignals(policy={},metrics={},parity={}){
    const r=policy.rollback||{},runs=num(metrics.runs)??0,failures=num(metrics.failures)??0,sourceErrors=num(metrics.sourceErrors)??0,routingErrors=num(metrics.routingErrors)??0,avgLatency=num(metrics.averageLatencyMs),critical=num(parity.criticalErrors??parity.errorCount)??0;
    const rate=(v)=>runs>0?v/runs:0;
    return[
      {id:'failure_rate',triggered:rate(failures)>(num(r.maxFailureRate)??.05),value:rate(failures),threshold:num(r.maxFailureRate)??.05},
      {id:'source_error_rate',triggered:rate(sourceErrors)>(num(r.maxSourceErrorRate)??.01),value:rate(sourceErrors),threshold:num(r.maxSourceErrorRate)??.01},
      {id:'routing_error_rate',triggered:rate(routingErrors)>(num(r.maxRoutingErrorRate)??.05),value:rate(routingErrors),threshold:num(r.maxRoutingErrorRate)??.05},
      {id:'average_latency',triggered:avgLatency!=null&&avgLatency>(num(r.maxAverageLatencyMs)??12000),value:avgLatency,threshold:num(r.maxAverageLatencyMs)??12000},
      {id:'critical_parity',triggered:critical>(num(r.maxCriticalParityErrors)??0),value:critical,threshold:num(r.maxCriticalParityErrors)??0}
    ];
  }
  function evaluate({policy={},currentPercent=0,metrics={},readiness=null,parity={},build={}}={}){
    const current=stageFor(policy,currentPercent),next=nextStage(policy,currentPercent),signals=rollbackSignals(policy,metrics,parity),triggered=signals.filter(x=>x.triggered),hours=num(metrics.observedHours)??0,runs=num(metrics.runs)??0,ready=readiness?.ready===true||readiness?.verdict==='READY',stableBuild=build.stable!==false&&(!build.startedSha||!build.currentSha||text(build.startedSha)===text(build.currentSha));
    if(triggered.length)return{decision:'ROLLBACK',promote:false,nextPercent:null,reasons:triggered.map(x=>x.id),signals};
    if(!next)return{decision:'HOLD',promote:false,nextPercent:null,reasons:['final_stage'],signals};
    const reasons=[];
    if(policy.promotion?.requireReadiness!==false&&!ready)reasons.push('readiness_not_ready');
    if(policy.promotion?.requireStableBuild!==false&&!stableBuild)reasons.push('build_changed');
    if(hours<Number(next.minHours||0))reasons.push('minimum_observation_not_met');
    if(runs<Number(next.minRuns||0))reasons.push('minimum_runs_not_met');
    if(reasons.length)return{decision:'HOLD',promote:false,nextPercent:Number(next.percent),reasons,signals};
    return{decision:'PROMOTE_ELIGIBLE',promote:true,nextPercent:Number(next.percent),manualApprovalRequired:policy.promotion?.manualApprovalRequired!==false,reasons:[],signals};
  }
  return{evaluate,rollbackSignals,stageFor,nextStage};
});
