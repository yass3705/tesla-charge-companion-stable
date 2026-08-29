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

  function operatorId(station){
    return norm(station?.physicalOperator?.id||station?.physicalOperator?.name||station?.operatorId||station?.operator||station?.network||station?.provider);
  }

  function coordinates(station){
    const latitude=number(station?.latitude??station?.lat??station?.location?.lat??station?.location?.latitude);
    const longitude=number(station?.longitude??station?.lng??station?.lon??station?.location?.lng??station?.location?.longitude);
    return{latitude,longitude};
  }

  function stationAliases(station){
    return uniq([
      station?.id,station?.canonicalId,station?.stationId,station?.sourceStationId,
      ...(station?.aliases||[])
    ].map(text)).sort();
  }

  function identityKeys(station){
    const aliases=stationAliases(station).map(v=>`id:${v}`);
    const {latitude,longitude}=coordinates(station),op=operatorId(station),name=norm(station?.name);
    const geo=latitude!=null&&longitude!=null?`geo:${round(latitude,4)},${round(longitude,4)}|${op||name}`:null;
    const named=name&&op?`name:${name}|${op}`:null;
    return uniq([...aliases,geo,named]);
  }

  function statusState(station){
    const raw=norm(station?.status?.state||station?.status||station?.availability||station?.state);
    if(!raw)return'unknown';
    if(['available','in-service','in-service-','operational','active','open','ok'].includes(raw))return'available';
    if(raw.includes('out-of-service')||raw.includes('outofservice')||raw.includes('inoperative')||raw.includes('unavailable')||raw.includes('hors-service')||raw.includes('suspended'))return'out_of_service';
    return raw;
  }

  function maxPowerKw(station){
    const values=[];
    const push=v=>{const n=number(v);if(n!=null&&n>0)values.push(n>1000?n/1000:n);};
    push(station?.powerKw);push(station?.maxPowerKw);push(station?.power);
    for(const evse of station?.evses||[]){
      push(evse?.powerKw);push(evse?.maxPowerKw);push(evse?.power);
      for(const c of evse?.connectors||[])push(c?.powerKw??c?.maxPowerKw??c?.maxElectricPower);
    }
    for(const c of station?.connectors||[])push(c?.powerKw??c?.maxPowerKw??c?.power);
    return values.length?Math.max(...values):null;
  }

  function offerSignature(station){
    const out=[];
    for(const offer of station?.offers||[]){
      out.push([
        norm(offer?.provider),text(offer?.kind),text(offer?.subscriptionId),text(offer?.currency),
        JSON.stringify(offer?.pricing||{})
      ].join('|'));
    }
    return uniq(out).sort();
  }

  function buildIndex(stations){
    const rows=(stations||[]).map((station,index)=>({station,index,keys:identityKeys(station)}));
    const byKey=new Map();
    for(const row of rows)for(const key of row.keys)if(!byKey.has(key))byKey.set(key,row);
    return{rows,byKey};
  }

  function matchStations(leftStations,rightStations){
    const left=buildIndex(leftStations),right=buildIndex(rightStations),usedRight=new Set(),pairs=[],leftOnly=[];
    for(const row of left.rows){
      let matched=null,matchedKey=null;
      for(const key of row.keys){const candidate=right.byKey.get(key);if(candidate&&!usedRight.has(candidate.index)){matched=candidate;matchedKey=key;break;}}
      if(!matched){leftOnly.push(row.station);continue;}
      usedRight.add(matched.index);pairs.push({left:row.station,right:matched.station,matchedKey});
    }
    const rightOnly=right.rows.filter(row=>!usedRight.has(row.index)).map(row=>row.station);
    return{pairs,leftOnly,rightOnly};
  }

  function comparePair(left,right,options={}){
    const diffs=[],powerToleranceKw=number(options.powerToleranceKw)??1;
    const leftOperator=operatorId(left),rightOperator=operatorId(right);
    if(leftOperator&&rightOperator&&leftOperator!==rightOperator)diffs.push({field:'operator',left:leftOperator,right:rightOperator,severity:'error'});
    const leftStatus=statusState(left),rightStatus=statusState(right);
    if(leftStatus!==rightStatus&&leftStatus!=='unknown'&&rightStatus!=='unknown')diffs.push({field:'status',left:leftStatus,right:rightStatus,severity:'error'});
    const lp=maxPowerKw(left),rp=maxPowerKw(right);
    if(lp!=null&&rp!=null&&Math.abs(lp-rp)>powerToleranceKw)diffs.push({field:'maxPowerKw',left:lp,right:rp,severity:'warning'});
    const lo=offerSignature(left),ro=offerSignature(right);
    if(options.compareOffers!==false&&JSON.stringify(lo)!==JSON.stringify(ro))diffs.push({field:'offers',left:lo,right:ro,severity:'warning'});
    return diffs;
  }

  function compareAreas(v8Stations,v9Area,options={}){
    const v9Stations=Array.isArray(v9Area)?v9Area:(v9Area?.stations||[]);
    const matched=matchStations(v8Stations||[],v9Stations||[]),changed=[];
    for(const pair of matched.pairs){
      const differences=comparePair(pair.left,pair.right,options);
      if(differences.length)changed.push({
        leftId:text(pair.left?.id||pair.left?.stationId||pair.left?.name),
        rightId:text(pair.right?.id||pair.right?.canonicalId||pair.right?.name),
        matchedKey:pair.matchedKey,differences
      });
    }
    const errors=changed.reduce((n,row)=>n+row.differences.filter(d=>d.severity==='error').length,0);
    const warnings=changed.reduce((n,row)=>n+row.differences.filter(d=>d.severity==='warning').length,0);
    const summary={
      v8Count:(v8Stations||[]).length,v9Count:(v9Stations||[]).length,matchedCount:matched.pairs.length,
      v8OnlyCount:matched.leftOnly.length,v9OnlyCount:matched.rightOnly.length,changedCount:changed.length,
      errorCount:errors,warningCount:warnings
    };
    const gates={
      noV8Loss:summary.v8OnlyCount===0,
      noCriticalDifferences:summary.errorCount===0,
      pass:summary.v8OnlyCount===0&&summary.errorCount===0
    };
    return{
      summary,gates,changed,
      v8Only:matched.leftOnly.map(s=>({id:text(s?.id||s?.stationId||s?.name),name:text(s?.name),operatorId:operatorId(s)})),
      v9Only:matched.rightOnly.map(s=>({id:text(s?.id||s?.canonicalId||s?.name),name:text(s?.name),operatorId:operatorId(s)}))
    };
  }

  async function shadowQuery({v8Query,v9Engine,query,options={}}={}){
    if(typeof v8Query!=='function')throw new Error('v8Query function is required');
    if(!v9Engine||typeof v9Engine.queryArea!=='function')throw new Error('v9Engine.queryArea is required');
    const [v8Result,v9Area]=await Promise.all([v8Query(query),v9Engine.queryArea(query)]);
    const v8Stations=Array.isArray(v8Result)?v8Result:(v8Result?.stations||[]);
    return{query,v8Result,v9Area,parity:compareAreas(v8Stations,v9Area,options)};
  }

  return{compareAreas,shadowQuery,matchStations,identityKeys,statusState,maxPowerKw,operatorId};
});