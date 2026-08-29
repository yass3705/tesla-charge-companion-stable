(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9StationScoreEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const round=v=>Math.round((Number(v)+Number.EPSILON)*1000000)/1000000;
  const text=v=>String(v==null?'':v).trim();

  function routeMetrics(station,route={}){
    const stationId=text(station?.id||station?.canonicalId||station?.stationId);
    const r=route?.byStationId?.[stationId]||route?.[stationId]||station?.route||{};
    return{
      distanceKm:num(r.distanceKm??r.distance_km??r.km),
      driveMinutes:num(r.driveMinutes??r.durationMinutes??r.duration_min),
      detourKm:num(r.detourKm),
      detourMinutes:num(r.detourMinutes)
    };
  }

  function chargingMinutes(station,session={}){
    const explicit=num(session.chargingMinutesByStationId?.[station?.id]??station?.chargingMinutes??session.durationMinutes);
    if(explicit!=null&&explicit>=0)return explicit;
    const energy=num(session.energyKwh);if(energy==null||energy<=0)return null;
    let power=0;
    for(const evse of station?.evses||[])for(const c of evse?.connectors||[])power=Math.max(power,num(c.powerKw)??0);
    const vehicleMax=num(session.vehicleMaxChargeKw);
    if(vehicleMax!=null&&vehicleMax>0)power=power?Math.min(power,vehicleMax):vehicleMax;
    if(power<=0)return null;
    const efficiency=num(session.chargeEfficiency)??0.92;
    return round((energy/(power*Math.max(0.01,efficiency)))*60);
  }

  function postChargeMinutes(session={},chargeMinutes=null){
    const explicit=num(session.postChargeMinutes);if(explicit!=null&&explicit>=0)return explicit;
    if(!session.disconnectAt||!session.startAt||chargeMinutes==null)return 0;
    const start=new Date(session.startAt),end=new Date(session.disconnectAt);
    if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime()))return 0;
    const total=(end-start)/60000;
    return Math.max(0,total-chargeMinutes);
  }

  function scoreStation(station,evaluation,session={},options={}){
    const route=routeMetrics(station,options.route||session.route||{});
    const chargeMinutes=chargingMinutes(station,session);
    const dwellAfterCharge=postChargeMinutes(session,chargeMinutes);
    const price=evaluation?.best?.total;
    const distanceKm=route.distanceKm;
    const driveMinutes=route.driveMinutes;
    const totalTimeMinutes=(driveMinutes!=null?driveMinutes:0)+(chargeMinutes!=null?chargeMinutes:0)+dwellAfterCharge;
    const recoveredKm=num(evaluation?.recoveredKm);
    const costPerRecoveredKm=price!=null&&recoveredKm?round(price/recoveredKm):null;
    return{
      stationId:text(station?.id||station?.canonicalId||station?.stationId),
      route,
      chargingMinutes:chargeMinutes,
      postChargeMinutes:dwellAfterCharge,
      totalTimeMinutes:round(totalTimeMinutes),
      finalCost:price,
      costPerRecoveredKm,
      distanceKm,
      driveMinutes,
      bestOffer:evaluation?.best||null,
      complete:{
        pricing:price!=null,
        route:distanceKm!=null&&driveMinutes!=null,
        charging:chargeMinutes!=null
      }
    };
  }

  function sortRows(rows,sortBy='finalCost'){
    const field=sortBy==='totalTime'?'totalTimeMinutes':sortBy==='distance'?'distanceKm':sortBy==='costPerRecoveredKm'?'costPerRecoveredKm':'finalCost';
    return [...(rows||[])].sort((a,b)=>{
      const av=a.score?.[field],bv=b.score?.[field];
      if(av==null&&bv==null)return a.score.stationId.localeCompare(b.score.stationId);
      if(av==null)return 1;if(bv==null)return-1;if(av!==bv)return av-bv;
      return a.score.stationId.localeCompare(b.score.stationId);
    });
  }

  function scoreArea(stations,evaluations={},session={},options={}){
    const rows=(stations||[]).map(station=>({station,score:scoreStation(station,evaluations?.[station?.id],session,options)}));
    return sortRows(rows,options.sortBy||session.sortBy||'finalCost');
  }

  return{scoreStation,scoreArea,sortRows,routeMetrics,chargingMinutes,postChargeMinutes};
});
