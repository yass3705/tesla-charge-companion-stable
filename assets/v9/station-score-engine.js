(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(require('./charge-model-engine.js'));
  }else{
    root.TCCV9StationScoreEngine=factory(root.TCCV9ChargeModelEngine);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(ChargeModelEngine){
  'use strict';

  if(!ChargeModelEngine)throw new Error('TCC V9 charge model engine is required');

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
      detourMinutes:num(r.detourMinutes),
      energyToStationKwh:num(r.energyToStationKwh)
    };
  }

  function stationSession(station,session={},route={}){
    const out={...session};
    const explicit=num(session.chargingMinutesByStationId?.[station?.id]??station?.chargingMinutes??session.durationMinutes);
    if(explicit!=null&&explicit>=0)out.explicitChargingMinutes=explicit;
    const capacity=num(session.batteryCapacityKwh),startSoc=num(session.startSoc),routeEnergy=num(route.energyToStationKwh);
    if(capacity!=null&&capacity>0&&startSoc!=null&&routeEnergy!=null&&routeEnergy>=0){
      out.arrivalSoc=Math.max(0,startSoc-(routeEnergy/capacity)*100);
    }
    return out;
  }

  function chargingDetails(station,session={},route={}){
    const prepared=stationSession(station,session,route);
    if(prepared.explicitChargingMinutes!=null)return{minutes:prepared.explicitChargingMinutes,profile:'explicit',energyKwh:num(prepared.energyKwh),startSoc:num(prepared.arrivalSoc??prepared.startSoc),targetSoc:num(prepared.targetSoc)};
    return ChargeModelEngine.estimate(station,prepared);
  }

  function chargingMinutes(station,session={},route={}){return chargingDetails(station,session,route).minutes;}

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
    const charge=chargingDetails(station,session,route),chargeMinutes=charge.minutes;
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
      chargeModel:charge,
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

  return{scoreStation,scoreArea,sortRows,routeMetrics,chargingMinutes,chargingDetails,postChargeMinutes};
});
