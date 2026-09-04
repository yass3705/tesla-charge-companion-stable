(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9ReadinessEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const ratio=(a,b)=>{const x=num(a),y=num(b);return x!=null&&y!=null&&y>0?x/y:null;};
  const round=v=>v==null?null:Math.round((Number(v)+Number.EPSILON)*10000)/10000;
  function check(id,label,pass,{required=true,value=null,threshold=null,detail='',severity='blocker'}={}){
    const known=pass===true||pass===false;
    return{id,label,required,known,pass:known?!!pass:false,value,threshold,detail,severity,status:!known?(required?'missing':'unknown'):(pass?'pass':severity==='warning'?'warning':'fail')};
  }
  function runtimeChecks(area={},options={}){
    const d=area?.diagnostics||{},evaluated=num(d.sessionEvaluatedStationCount)??Object.keys(area?.sessionEvaluations||{}).length,comparable=num(d.sessionComparableStationCount)??Object.values(area?.sessionEvaluations||{}).filter(x=>x?.best).length,scored=num(d.scoredStationCount)??Object.keys(area?.stationScores||{}).length,fullyScored=num(d.fullyScoredStationCount)??Object.values(area?.stationScores||{}).filter(x=>x?.complete?.pricing&&x?.complete?.route&&x?.complete?.charging).length;
    const routed=num(d.routedStationCount)??num(area?.routeResult?.routedCount),requested=num(d.routingRequestedCount)??num(area?.routeResult?.requestedCount),routingErrors=num(d.routingErrorCount)??(Array.isArray(area?.routeResult?.errors)?area.routeResult.errors.length:null);
    const comparableRatio=ratio(comparable,evaluated),scoreRatio=ratio(fullyScored,scored),routingRatio=requested===0?1:ratio(routed,requested);
    const minComparable=num(options.minComparableSessionRatio)??0.95,minFullyScored=num(options.minFullyScoredRatio)??0.95,minRouting=num(options.minRoutingSuccessRatio)??0.95,maxRoutingErrors=num(options.maxRoutingErrors)??0;
    return[
      check('runtime-session-comparable','Sessions tarifaires comparables',comparableRatio==null?null:comparableRatio>=minComparable,{value:round(comparableRatio),threshold:minComparable,detail:`${comparable}/${evaluated}`}),
      check('runtime-fully-scored','Stations entièrement scorées',scoreRatio==null?null:scoreRatio>=minFullyScored,{value:round(scoreRatio),threshold:minFullyScored,detail:`${fullyScored}/${scored}`}),
      check('runtime-routing-success','Routage réussi',routingRatio==null?null:routingRatio>=minRouting,{required:requested!==0,value:round(routingRatio),threshold:minRouting,detail:`${routed??0}/${requested??0}`}),
      check('runtime-routing-errors','Erreurs de routage',routingErrors==null?null:routingErrors<=maxRoutingErrors,{required:requested!==0,value:routingErrors,threshold:maxRoutingErrors,detail:`${routingErrors??'—'} erreur(s)`})
    ];
  }
  function parityChecks(parity){
    const g=parity?.gates||{},s=parity?.summary||{};
    return[
      check('parity-no-v8-loss','Aucune station V8 perdue',g.noV8Loss,{value:s.v8OnlyCount,threshold:0,detail:`${s.v8OnlyCount??'—'} station(s) V8 absente(s)`}),
      check('parity-no-critical','Aucun écart critique V8↔V9',g.noCriticalDifferences,{value:s.errorCount,threshold:0,detail:`${s.errorCount??'—'} erreur(s) critique(s)`}),
      check('parity-session','Parité session critique',g.sessionParity,{value:s.sessionErrorCount,threshold:0,detail:`${s.sessionErrorCount??'—'} erreur(s) session`})
    ];
  }
  function matrixChecks(matrix){const s=matrix?.summary||{};return[check('matrix-strict','Matrice stricte V8↔V9',s.matrixPass,{value:s.strictFailedCount,threshold:0,detail:`${s.strictPassedCount??'—'}/${s.strictScenarioCount??'—'} scénario(s) strict(s) passent`})];}
  function ciChecks(ci,options={}){
    if(!ci)return[check('ci-required','CI de readiness disponible',null,{required:options.requireCi===true,detail:'Aucun état CI fourni'})];
    const rows=Array.isArray(ci)?ci:(ci.checks||[]),requiredNames=options.requiredCiChecks||[],selected=requiredNames.length?requiredNames.map(name=>rows.find(x=>x?.name===name)||{name,status:'missing'}):rows;
    const failures=selected.filter(x=>!['success','passed','pass'].includes(String(x?.conclusion||x?.status||'').toLowerCase())),pass=selected.length>0&&failures.length===0;
    return[check('ci-green','CI requise au vert',pass,{required:options.requireCi!==false,value:failures.length,threshold:0,detail:failures.length?failures.map(x=>x.name||'check').join(', '):`${selected.length} check(s) vert(s)`})];
  }
  function assess({parity=null,matrix=null,area=null,ci=null}={},options={}){
    const checks=[...parityChecks(parity),...matrixChecks(matrix),...runtimeChecks(area||{},options),...ciChecks(ci,options)];
    const required=checks.filter(x=>x.required),blockers=required.filter(x=>x.status==='fail'||x.status==='missing'),warnings=checks.filter(x=>x.status==='warning'||(!x.required&&x.status==='unknown'));
    const verdict=blockers.length?'BLOCKED':'READY';
    return{generatedAt:new Date().toISOString(),verdict,ready:verdict==='READY',summary:{checkCount:checks.length,passedCount:checks.filter(x=>x.status==='pass').length,blockerCount:blockers.length,warningCount:warnings.length},checks,blockers,warnings};
  }
  return{assess,runtimeChecks,parityChecks,matrixChecks,ciChecks,ratio};
});
