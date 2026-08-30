(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9ParityEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const uniq=v=>[...new Set((v||[]).filter(Boolean))];
  const round=(v,d=5)=>{const n=number(v);return n==null?null:Number(n.toFixed(d));};

  function operatorId(station){return norm(station?.physicalOperator?.id||station?.physicalOperator?.name||station?.operatorId||station?.operator||station?.network||station?.provider);}
  function coordinates(station){const latitude=number(station?.latitude??station?.lat??station?.location?.lat??station?.location?.latitude);const longitude=number(station?.longitude??station?.lng??station?.lon??station?.location?.lng??station?.location?.longitude);return{latitude,longitude};}
  function stationAliases(station){return uniq([station?.id,station?.canonicalId,station?.stationId,station?.sourceStationId,...(station?.aliases||[])].map(text)).sort();}
  function identityKeys(station){
    const aliases=stationAliases(station).map(v=>`id:${v}`),{latitude,longitude}=coordinates(station),op=operatorId(station),name=norm(station?.name);
    const geo=latitude!=null&&longitude!=null?`geo:${round(latitude,4)},${round(longitude,4)}|${op||name}`:null,named=name&&op?`name:${name}|${op}`:null;
    return uniq([...aliases,geo,named]);
  }
  function statusState(station){
    const raw=norm(station?.status?.state||station?.status||station?.availability||station?.state);if(!raw)return'unknown';
    if(['available','in-service','in-service-','operational','active','open','ok'].includes(raw))return'available';
    if(raw.includes('out-of-service')||raw.includes('outofservice')||raw.includes('inoperative')||raw.includes('unavailable')||raw.includes('hors-service')||raw.includes('suspended'))return'out_of_service';
    return raw;
  }
  function maxPowerKw(station){
    const values=[],push=v=>{const n=number(v);if(n!=null&&n>0)values.push(n>1000?n/1000:n);};push(station?.powerKw);push(station?.maxPowerKw);push(station?.power);
    for(const evse of station?.evses||[]){push(evse?.powerKw);push(evse?.maxPowerKw);push(evse?.power);for(const c of evse?.connectors||[])push(c?.powerKw??c?.maxPowerKw??c?.maxElectricPower);}
    for(const c of station?.connectors||[])push(c?.powerKw??c?.maxPowerKw??c?.power);return values.length?Math.max(...values):null;
  }
  function offerSignature(station){const out=[];for(const offer of station?.offers||[])out.push([norm(offer?.provider),text(offer?.kind),text(offer?.subscriptionId),text(offer?.currency),JSON.stringify(offer?.pricing||{})].join('|'));return uniq(out).sort();}
  function buildIndex(stations){const rows=(stations||[]).map((station,index)=>({station,index,keys:identityKeys(station)})),byKey=new Map();for(const row of rows)for(const key of row.keys)if(!byKey.has(key))byKey.set(key,row);return{rows,byKey};}
  function matchStations(leftStations,rightStations){
    const left=buildIndex(leftStations),right=buildIndex(rightStations),usedRight=new Set(),pairs=[],leftOnly=[];
    for(const row of left.rows){let matched=null,matchedKey=null;for(const key of row.keys){const candidate=right.byKey.get(key);if(candidate&&!usedRight.has(candidate.index)){matched=candidate;matchedKey=key;break;}}if(!matched){leftOnly.push(row.station);continue;}usedRight.add(matched.index);pairs.push({left:row.station,right:matched.station,matchedKey});}
    return{pairs,leftOnly,rightOnly:right.rows.filter(row=>!usedRight.has(row.index)).map(row=>row.station)};
  }

  function comparePair(left,right,options={}){
    const diffs=[],powerToleranceKw=number(options.powerToleranceKw)??1,leftOperator=operatorId(left),rightOperator=operatorId(right);
    if(leftOperator&&rightOperator&&leftOperator!==rightOperator)diffs.push({field:'operator',left:leftOperator,right:rightOperator,severity:'error'});
    const leftStatus=statusState(left),rightStatus=statusState(right);if(leftStatus!==rightStatus&&leftStatus!=='unknown'&&rightStatus!=='unknown')diffs.push({field:'status',left:leftStatus,right:rightStatus,severity:'error'});
    const lp=maxPowerKw(left),rp=maxPowerKw(right);if(lp!=null&&rp!=null&&Math.abs(lp-rp)>powerToleranceKw)diffs.push({field:'maxPowerKw',left:lp,right:rp,severity:'warning',delta:round(rp-lp)});
    const lo=offerSignature(left),ro=offerSignature(right);if(options.compareOffers!==false&&JSON.stringify(lo)!==JSON.stringify(ro))diffs.push({field:'offers',left:lo,right:ro,severity:'warning'});
    return diffs;
  }

  function metricWithin(left,right,absoluteTolerance=0,relativeTolerance=0){
    const a=number(left),b=number(right);if(a==null||b==null)return null;const delta=Math.abs(a-b),scale=Math.max(Math.abs(a),Math.abs(b),1e-9);return delta<=absoluteTolerance||delta/scale<=relativeTolerance;
  }
  function sessionMetricsFromV8(v8Result,station){
    const map=v8Result?.sessionByStationId||{};for(const alias of stationAliases(station)){if(map[alias])return map[alias];}return null;
  }
  function sessionMetricsFromV9(v9Area,station){
    const id=text(station?.id||station?.canonicalId||station?.stationId),plan=v9Area?.sessionPlans?.[id],score=v9Area?.stationScores?.[id],evaluation=v9Area?.sessionEvaluations?.[id];
    if(!plan&&!score&&!evaluation)return null;
    return{
      finalCost:number(score?.finalCost??evaluation?.best?.total),
      reachedSoc:number(plan?.actualTargetSoc??plan?.effectiveSession?.targetSoc),
      targetReached:plan?.targetReached==null?null:!!plan.targetReached,
      totalTimeMinutes:number(score?.totalTimeMinutes),
      costPerRecoveredKm:number(score?.costPerRecoveredKm??evaluation?.best?.costPerRecoveredKm),
      recoveredKm:number(evaluation?.recoveredKm),
      deliveredEnergyKwh:number(plan?.deliveredEnergyKwh??plan?.effectiveSession?.energyKwh),
      billedEnergyKwh:number(evaluation?.billedEnergyKwh??plan?.effectiveSession?.energyKwh),
      chargingMinutes:number(plan?.chargingMinutes??score?.chargingMinutes),
      connectedMinutes:number(plan?.connectedMinutes),
      driveMinutes:number(score?.driveMinutes)
    };
  }
  function compareMetric(field,left,right,{abs=0,rel=0,severity='warning'}={}){
    const a=number(left),b=number(right);if(a==null||b==null)return null;if(metricWithin(a,b,abs,rel))return null;
    return{field,left:round(a,6),right:round(b,6),delta:round(b-a,6),absoluteDelta:round(Math.abs(b-a),6),relativeDelta:a!==0?round((b-a)/Math.abs(a),6):null,severity};
  }
  function compareSessionMetrics(left,right,options={}){
    if(!left||!right)return[];const diffs=[];
    if(left.targetReached!=null&&right.targetReached!=null&&!!left.targetReached!==!!right.targetReached)diffs.push({field:'targetReached',left:!!left.targetReached,right:!!right.targetReached,severity:'error'});
    const price=compareMetric('finalCost',left.finalCost,right.finalCost,{abs:number(options.costTolerance)??0.05,rel:number(options.costRelativeTolerance)??0.01,severity:'error'});if(price)diffs.push(price);
    const soc=compareMetric('reachedSoc',left.reachedSoc,right.reachedSoc,{abs:number(options.socTolerancePoints)??1,rel:0,severity:'error'});if(soc)diffs.push(soc);
    const time=compareMetric('totalTimeMinutes',left.totalTimeMinutes,right.totalTimeMinutes,{abs:number(options.timeToleranceMinutes)??2,rel:number(options.timeRelativeTolerance)??0.03,severity:'warning'});if(time){const critical=number(options.criticalTimeToleranceMinutes)??10;if(Math.abs(time.delta)>critical)time.severity='error';diffs.push(time);}
    const perKm=compareMetric('costPerRecoveredKm',left.costPerRecoveredKm,right.costPerRecoveredKm,{abs:number(options.costPerKmTolerance)??0.001,rel:number(options.costPerKmRelativeTolerance)??0.02,severity:'warning'});if(perKm)diffs.push(perKm);
    const energy=compareMetric('deliveredEnergyKwh',left.deliveredEnergyKwh,right.deliveredEnergyKwh,{abs:number(options.energyToleranceKwh)??0.5,rel:number(options.energyRelativeTolerance)??0.02,severity:'warning'});if(energy)diffs.push(energy);
    return diffs;
  }

  function compareAreas(v8Input,v9Area,options={}){
    const v8Result=Array.isArray(v8Input)?{stations:v8Input}:v8Input||{},v8Stations=v8Result.stations||[],v9Stations=Array.isArray(v9Area)?v9Area:(v9Area?.stations||[]),matched=matchStations(v8Stations,v9Stations),changed=[];
    let sessionComparedCount=0,sessionChangedCount=0;
    for(const pair of matched.pairs){
      const differences=comparePair(pair.left,pair.right,options),leftSession=sessionMetricsFromV8(v8Result,pair.left),rightSession=sessionMetricsFromV9(v9Area,pair.right),sessionDifferences=compareSessionMetrics(leftSession,rightSession,options);
      if(leftSession&&rightSession)sessionComparedCount+=1;if(sessionDifferences.length)sessionChangedCount+=1;
      if(differences.length||sessionDifferences.length)changed.push({leftId:text(pair.left?.id||pair.left?.stationId||pair.left?.name),rightId:text(pair.right?.id||pair.right?.canonicalId||pair.right?.name),matchedKey:pair.matchedKey,differences,sessionDifferences,leftSession,rightSession});
    }
    const allDiffs=changed.flatMap(row=>[...(row.differences||[]),...(row.sessionDifferences||[])]),errors=allDiffs.filter(d=>d.severity==='error').length,warnings=allDiffs.filter(d=>d.severity==='warning').length;
    const sessionDiffs=changed.flatMap(row=>row.sessionDifferences||[]),sessionErrors=sessionDiffs.filter(d=>d.severity==='error').length,sessionWarnings=sessionDiffs.filter(d=>d.severity==='warning').length;
    const summary={v8Count:v8Stations.length,v9Count:v9Stations.length,matchedCount:matched.pairs.length,v8OnlyCount:matched.leftOnly.length,v9OnlyCount:matched.rightOnly.length,changedCount:changed.length,errorCount:errors,warningCount:warnings,sessionComparedCount,sessionChangedCount,sessionErrorCount:sessionErrors,sessionWarningCount:sessionWarnings};
    const gates={noV8Loss:summary.v8OnlyCount===0,noCriticalDifferences:summary.errorCount===0,sessionParity:summary.sessionErrorCount===0,pass:summary.v8OnlyCount===0&&summary.errorCount===0};
    return{summary,gates,changed,v8Only:matched.leftOnly.map(s=>({id:text(s?.id||s?.stationId||s?.name),name:text(s?.name),operatorId:operatorId(s)})),v9Only:matched.rightOnly.map(s=>({id:text(s?.id||s?.canonicalId||s?.name),name:text(s?.name),operatorId:operatorId(s)}))};
  }

  async function shadowQuery({v8Query,v9Engine,query,options={}}={}){
    if(typeof v8Query!=='function')throw new Error('v8Query function is required');if(!v9Engine||typeof v9Engine.queryArea!=='function')throw new Error('v9Engine.queryArea is required');
    const v8Result=await v8Query(query),effectiveQuery=!query?.origin&&v8Result?.origin?{...query,origin:{lat:v8Result.origin.lat,lon:v8Result.origin.lon}}:query,v9Area=await v9Engine.queryArea(effectiveQuery);
    return{query:effectiveQuery,v8Result,v9Area,parity:compareAreas(v8Result,v9Area,options)};
  }

  return{compareAreas,shadowQuery,matchStations,identityKeys,statusState,maxPowerKw,operatorId,compareSessionMetrics,sessionMetricsFromV8,sessionMetricsFromV9,metricWithin};
});
