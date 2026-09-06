(function(root,factory){
  if(typeof module==='object'&&module.exports){module.exports=factory(require('./charge-model-engine.js'));}
  else{root.TCCV9SessionPlannerEngine=factory(root.TCCV9ChargeModelEngine);}
})(typeof globalThis!=='undefined'?globalThis:this,function(ChargeModelEngine){
  'use strict';
  if(!ChargeModelEngine)throw new Error('TCC V9 charge model engine is required');
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const round=v=>Math.round((Number(v)+Number.EPSILON)*1000000)/1000000;
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
  const addMinutes=(value,minutes)=>{if(!value||num(minutes)==null)return null;const d=new Date(value);if(Number.isNaN(d.getTime()))return null;return new Date(d.getTime()+Number(minutes)*60000).toISOString();};
  const minutesBetween=(a,b)=>{if(!a||!b)return null;const x=new Date(a),y=new Date(b);if(Number.isNaN(x.getTime())||Number.isNaN(y.getTime()))return null;return Math.max(0,(y-x)/60000);};

  function routeFor(station,route={}){const id=String(station?.id||station?.canonicalId||station?.stationId||'').trim();return route?.byStationId?.[id]||route?.[id]||station?.route||{};}
  function arrivalSoc(session={},route={}){
    const capacity=num(session.batteryCapacityKwh),start=num(session.startSoc),energy=num(route.approachEnergyKwh??route.energyToStationKwh)??0;
    if(capacity==null||capacity<=0||start==null)return null;
    return clamp(start-(Math.max(0,energy)/capacity)*100,0,100);
  }
  function targetSoc(session={},arrival=null){
    const direct=num(session.targetSoc);if(direct!=null)return clamp(direct,arrival??0,100);
    const energy=num(session.energyKwh),capacity=num(session.batteryCapacityKwh);
    if(energy!=null&&energy>=0&&capacity!=null&&capacity>0&&arrival!=null)return clamp(arrival+(energy/capacity)*100,arrival,100);
    return null;
  }
  function energyBetweenSoc(capacity,start,target){return capacity!=null&&capacity>0&&start!=null&&target!=null?round(capacity*Math.max(0,target-start)/100):null;}

  function reachableSoc(station,session,arrival,target,minutes){
    if(minutes==null||minutes<0||arrival==null||target==null)return arrival;
    if(minutes===0)return arrival;
    let lo=arrival,hi=target;
    for(let i=0;i<24;i++){
      const mid=(lo+hi)/2,estimate=ChargeModelEngine.estimate(station,{...session,arrivalSoc:arrival,targetSoc:mid,energyKwh:null});
      if(estimate.minutes==null||estimate.minutes>minutes)hi=mid;else lo=mid;
    }
    return round(lo);
  }

  function planStation(station,session={},options={}){
    const route=routeFor(station,options.route||session.route||{}),driveMinutes=num(route.driveMinutes??route.durationMinutes)??0;
    const capacity=num(session.batteryCapacityKwh),arrival=arrivalSoc(session,route),target=targetSoc(session,arrival);
    const chargeStartAt=addMinutes(session.startAt,driveMinutes)||session.chargeStartAt||session.startAt||null;
    const available=minutesBetween(chargeStartAt,session.disconnectAt);
    const requestedEnergy=energyBetweenSoc(capacity,arrival,target)??Math.max(0,num(session.energyKwh)??0);
    const desired=ChargeModelEngine.estimate(station,{...session,arrivalSoc:arrival,targetSoc:target,energyKwh:requestedEnergy});
    let actualSoc=target,chargingMinutes=desired.minutes,targetReached=true;
    if(available!=null&&chargingMinutes!=null&&chargingMinutes>available+1e-9){
      actualSoc=reachableSoc(station,session,arrival,target,available);
      targetReached=false;
    }
    const actualEnergy=energyBetweenSoc(capacity,arrival,actualSoc)??requestedEnergy;
    const actualModel=ChargeModelEngine.estimate(station,{...session,arrivalSoc:arrival,targetSoc:actualSoc,energyKwh:actualEnergy});
    if(actualModel.minutes!=null)chargingMinutes=actualModel.minutes;
    if(available!=null&&!targetReached)chargingMinutes=Math.min(available,chargingMinutes??available);
    const delivered=actualModel.energyKwh??actualEnergy;
    const postChargeMinutes=available!=null&&chargingMinutes!=null?Math.max(0,available-chargingMinutes):Math.max(0,num(session.postChargeMinutes)??0);
    const postChargeStartAt=chargeStartAt&&chargingMinutes!=null?addMinutes(chargeStartAt,chargingMinutes):null;
    const connectedMinutes=chargingMinutes!=null?chargingMinutes+postChargeMinutes:null;
    const effectiveSession={...session,startAt:chargeStartAt,chargeStartAt,arrivalSoc:arrival,targetSoc:actualSoc,requestedTargetSoc:target,energyKwh:round(Math.max(0,delivered??0)),requestedEnergyKwh:requestedEnergy,includeRouteEnergyInCharge:false,durationMinutes:connectedMinutes,chargingMinutes,postChargeMinutes,postChargeStartAt,targetReached,chargeTimeline:Array.isArray(actualModel.timeline)?actualModel.timeline:[]};
    return{stationId:String(station?.id||''),arrivalSoc:arrival,requestedTargetSoc:target,actualTargetSoc:actualSoc,requestedEnergyKwh:requestedEnergy,deliveredEnergyKwh:effectiveSession.energyKwh,desiredChargingMinutes:desired.minutes,chargingMinutes,postChargeMinutes,connectedMinutes,chargeStartAt,postChargeStartAt,disconnectAt:session.disconnectAt||null,targetReached,effectiveSession,chargeModel:actualModel,desiredChargeModel:desired};
  }

  function planArea(stations,session={},options={}){return Object.fromEntries((stations||[]).map(st=>{const p=planStation(st,session,options);return[p.stationId,p];}));}
  return{planStation,planArea,arrivalSoc,targetSoc,reachableSoc,energyBetweenSoc,minutesBetween,addMinutes};
});
