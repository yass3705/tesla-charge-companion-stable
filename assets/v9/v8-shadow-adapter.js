(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9V8ShadowAdapter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const round=v=>{const n=num(v);return n==null?null:Math.round((n+Number.EPSILON)*1000000)/1000000;};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function dateTimeParts(value){
    if(!value)return{date:null,time:null};
    const raw=text(value),local=raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if(local&&!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw))return{date:local[1],time:local[2]};
    const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return{date:null,time:null};
    const pad=n=>String(n).padStart(2,'0');return{date:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,time:`${pad(d.getHours())}:${pad(d.getMinutes())}`};
  }
  function addMinutes(value,minutes){const d=new Date(value);if(Number.isNaN(d.getTime()))return null;return new Date(d.getTime()+(num(minutes)??0)*60000);}
  function stationId(station){return text(station?.baseStationId||station?.id||station?.stationId||station?.name);}
  function legacyStation(base,configIds=[]){
    const id=stationId(base),aliases=[id,...configIds.map(text)].filter(Boolean);
    return{...base,id,stationId:id,aliases:[...new Set([...(base?.aliases||[]),...aliases])],operator:base?.operator||base?.network||null,latitude:num(base?.latitude),longitude:num(base?.longitude)};
  }
  function recoveredKm(deliveredEnergyKwh,consumptionKwhPer100Km){const energy=num(deliveredEnergyKwh),consumption=num(consumptionKwhPer100Km);return energy!=null&&energy>0&&consumption!=null&&consumption>0?round(energy/(consumption/100)):null;}

  function normalizeLegacyRows(rows=[],options={}){
    const consumption=num(options.consumptionKwhPer100Km)??15,groups=new Map();
    for(const row of rows){const st=row?.station||row?.st||{},id=stationId(st);if(!id)continue;if(!groups.has(id))groups.set(id,{base:row?.baseStation||st,rows:[]});groups.get(id).rows.push({...row,station:st});}
    const stations=[],sessionByStationId={};
    for(const [id,group] of groups){
      const usable=group.rows.filter(row=>Number.isFinite(Number(row?.result?.total??row?.r?.total))&&!row?.result?.unavailable&&!row?.r?.unavailable),pool=usable.length?usable:group.rows;
      pool.sort((a,b)=>{const ar=a?.result||a?.r||{},br=b?.result||b?.r||{},ac=num(ar.total),bc=num(br.total);if(ac!=null&&bc!=null&&ac!==bc)return ac-bc;if(ac==null&&bc!=null)return 1;if(ac!=null&&bc==null)return-1;return(num(ar.allowed)??Infinity)-(num(br.allowed)??Infinity);});
      const best=pool[0]||{},r=best.result||best.r||{},route=best.route||{},occupied=num(r?.pricingDetails?.occupiedMinutes)??num(r?.occupiedMinutes)??num(r?.allowed),drive=num(route.durationMin??route.driveMinutes)??0,delivered=num(r.deliveredBatt??r.deliveredEnergyKwh),km=recoveredKm(delivered,consumption),total=num(r.total);
      stations.push(legacyStation(group.base,group.rows.map(x=>x.station?.id)));
      const reached=num(r.reached??r.reachedSoc),targetReached=r.targetReached!=null?!!r.targetReached:(r.truncated===true?false:(reached!=null?true:null));
      sessionByStationId[id]={finalCost:total,reachedSoc:reached,targetReached,totalTimeMinutes:occupied!=null?round(drive+occupied):null,driveMinutes:drive,chargingMinutes:num(r.allowed??r.chargingMinutes),connectedMinutes:occupied,costPerRecoveredKm:total!=null&&km?round(total/km):null,recoveredKm:km,deliveredEnergyKwh:delivered,billedEnergyKwh:num(r.deliveredBilled??r.billedEnergyKwh),configurationId:text(best.station?.id)||null,configurationLabel:text(best.station?.configurationLabel)||null,chargeStartAt:best.chargeStartAt||null,unknown:!!r.unknown,unavailable:!!r.unavailable};
    }
    return{stations,sessionByStationId};
  }

  function createBrowserAdapter(frameOrWindow,{readyTimeoutMs=20000}={}){
    const getWindow=()=>frameOrWindow?.contentWindow||frameOrWindow;
    async function ready(){
      const deadline=Date.now()+readyTimeoutMs;let lastError=null;
      while(Date.now()<deadline){
        try{const win=getWindow();if(win&&typeof win.simulate==='function'&&typeof win.candidateStations==='function'&&typeof win.expandConfigurations==='function'){const count=win.eval('stations.length');if(Number.isFinite(count)&&count>0)return win;}}catch(err){lastError=err;}
        await sleep(100);
      }
      throw new Error(`V8 shadow runtime not ready${lastError?`: ${lastError.message}`:''}`);
    }
    async function query(query={}){
      const win=await ready(),session=query.session||{},departure=session.startAt||query.startAt,parts=dateTimeParts(departure),disconnect=dateTimeParts(session.disconnectAt||query.disconnectAt);
      if(!query.originText)throw new Error('V8 shadow query requires originText');if(!parts.date||!parts.time)throw new Error('V8 shadow query requires a valid session.startAt');
      const doc=win.document,originInput=doc.getElementById('simOrigin');if(originInput)originInput.value=query.originText;
      const filterMode=query.v8FilterMode||'all',radius=num(query.radiusKm)??0,prepared=await win.candidateStations(filterMode,radius),expanded=win.expandConfigurations(prepared.stations||[]),routes=win.eval('routeResults'),now=num(session.startSoc),target=num(session.targetSoc);
      if(now==null||target==null||target<=now)throw new Error('V8 shadow query requires startSoc < targetSoc');
      const condition=query.v8Condition||'normal',profile=query.v8Profile||'realistic',unplugTime=disconnect.time||'',baseById=new Map((prepared.stations||[]).map(st=>[stationId(st),st]));
      const rows=expanded.map(st=>{
        const baseId=st.baseStationId||stationId(st),route=routes?.[baseId]||{},arrivalDate=addMinutes(departure,num(route.durationMin)??0),arrival=dateTimeParts(arrivalDate||departure);
        return{station:st,baseStation:baseById.get(baseId)||st,route,chargeStartAt:arrivalDate?.toISOString?.()||null,result:win.simulate(st,arrival.date,arrival.time,now,target,condition,profile,unplugTime)};
      });
      const normalized=normalizeLegacyRows(rows,{consumptionKwhPer100Km:session.consumptionKwhPer100Km});
      return{...normalized,origin:{lat:num(prepared.origin?.lat),lon:num(prepared.origin?.lon),label:text(prepared.origin?.label)},rawRows:rows,engine:'v8-live-browser',v8Profile:profile,v8Condition:condition};
    }
    return{ready,query};
  }

  return{createBrowserAdapter,normalizeLegacyRows,recoveredKm,dateTimeParts,addMinutes,legacyStation};
});
