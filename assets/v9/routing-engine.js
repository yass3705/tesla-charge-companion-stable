(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9RoutingEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const round=v=>Math.round((Number(v)+Number.EPSILON)*1000000)/1000000;

  function stationId(station){return text(station?.id||station?.canonicalId||station?.stationId);}
  function coordinate(value){const n=num(value);return n!=null?n:null;}
  function endpoint(station){
    const lat=coordinate(station?.latitude),lon=coordinate(station?.longitude);
    return lat!=null&&lon!=null?{lat,lon}:null;
  }
  function normalizeRoute(raw={}){
    const distanceKm=num(raw.distanceKm??raw.distance_km??(num(raw.distanceMeters)!=null?Number(raw.distanceMeters)/1000:null));
    const driveMinutes=num(raw.driveMinutes??raw.durationMinutes??raw.duration_min??(num(raw.durationSeconds)!=null?Number(raw.durationSeconds)/60:null));
    return{
      distanceKm:distanceKm!=null?round(distanceKm):null,
      driveMinutes:driveMinutes!=null?round(driveMinutes):null,
      detourKm:num(raw.detourKm)!=null?round(raw.detourKm):null,
      detourMinutes:num(raw.detourMinutes)!=null?round(raw.detourMinutes):null,
      provider:text(raw.provider)||null,
      rawId:text(raw.rawId||raw.routeId)||null
    };
  }
  function energyForRoute(route,session={}){
    const consumption=num(session.consumptionKwhPer100Km);if(consumption==null||consumption<=0)return null;
    const mode=session.routeEnergyMode==='detour'?'detour':'distance';
    const km=mode==='detour'&&num(route?.detourKm)!=null?num(route.detourKm):num(route?.distanceKm);
    if(km==null||km<0)return null;
    return round(km*consumption/100);
  }

  async function routeCandidates(stations,{origin,provider,session={},concurrency=6}={}){
    if(typeof provider!=='function')return{byStationId:{},errors:[],routedCount:0,requestedCount:0};
    const rows=(stations||[]).map(station=>({station,id:stationId(station),destination:endpoint(station)})).filter(x=>x.id&&x.destination);
    const byStationId={},errors=[];let cursor=0;
    async function worker(){
      while(cursor<rows.length){
        const index=cursor++,row=rows[index];
        try{
          const raw=await provider({origin,destination:row.destination,station:row.station,stationId:row.id,index});
          const route=normalizeRoute(raw||{});route.approachEnergyKwh=energyForRoute(route,session);byStationId[row.id]=route;
        }catch(err){errors.push({stationId:row.id,message:String(err?.message||err)});}
      }
    }
    const workers=Array.from({length:Math.max(1,Math.min(Number(concurrency)||1,rows.length||1))},()=>worker());
    await Promise.all(workers);
    return{byStationId,errors,routedCount:Object.keys(byStationId).length,requestedCount:rows.length};
  }

  function energyByStationId(routeResult){
    return Object.fromEntries(Object.entries(routeResult?.byStationId||{}).map(([id,route])=>[id,num(route?.approachEnergyKwh)]).filter(([,v])=>v!=null));
  }

  return{routeCandidates,normalizeRoute,energyForRoute,energyByStationId,endpoint,stationId};
});
