(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9ChargeModelEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const round=v=>Math.round((Number(v)+Number.EPSILON)*1000000)/1000000;
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

  // Relative DC fallback profile. It is intentionally generic and can be
  // replaced per vehicle through session.chargeCurve.
  const GENERIC_DC_CURVE=[
    {soc:0,factor:0.90},{soc:10,factor:1.00},{soc:30,factor:0.96},
    {soc:50,factor:0.82},{soc:70,factor:0.62},{soc:80,factor:0.45},
    {soc:90,factor:0.25},{soc:95,factor:0.14},{soc:100,factor:0.06}
  ];

  function stationPowerKw(station){
    let power=0;
    for(const evse of station?.evses||[])for(const c of evse?.connectors||[])power=Math.max(power,num(c?.powerKw)??0);
    return power||null;
  }

  function normalizeCurve(raw){
    const rows=(raw||[]).map(p=>({soc:num(p?.soc),powerKw:num(p?.powerKw),factor:num(p?.factor)})).filter(p=>p.soc!=null&&(p.powerKw!=null||p.factor!=null)).sort((a,b)=>a.soc-b.soc);
    return rows.length>=2?rows:null;
  }

  function interpolate(curve,soc,basePowerKw){
    const x=clamp(num(soc)??0,0,100),rows=curve;
    let a=rows[0],b=rows[rows.length-1];
    if(x<=a.soc)b=a;
    else if(x>=b.soc)a=b;
    else for(let i=1;i<rows.length;i++)if(x<=rows[i].soc){a=rows[i-1];b=rows[i];break;}
    const value=p=>p.powerKw!=null?p.powerKw:(p.factor??1)*basePowerKw;
    if(a.soc===b.soc)return value(a);
    const t=(x-a.soc)/(b.soc-a.soc);return value(a)+(value(b)-value(a))*t;
  }

  function resolveCurve(session,availablePowerKw){
    const custom=normalizeCurve(session?.chargeCurve);if(custom)return{curve:custom,profile:'custom'};
    if(session?.disableSocCurve===true||availablePowerKw<=22)return{curve:null,profile:'flat'};
    return{curve:GENERIC_DC_CURVE,profile:'generic-dc-conservative'};
  }

  function resolveSoc(session={},energyKwh=null){
    const capacity=num(session.batteryCapacityKwh),start=num(session.arrivalSoc??session.startSoc),target=num(session.targetSoc);
    if(capacity==null||capacity<=0||start==null)return{capacity:null,startSoc:null,targetSoc:null};
    const s=clamp(start,0,100);
    const t=target!=null?clamp(target,s,100):(energyKwh!=null?clamp(s+(energyKwh/capacity)*100,s,100):null);
    return{capacity,startSoc:s,targetSoc:t};
  }

  function estimate(station,session={}){
    const stationPower=stationPowerKw(station),vehicleMax=num(session.vehicleMaxChargeKw);
    let availablePower=stationPower??vehicleMax;
    if(vehicleMax!=null&&vehicleMax>0)availablePower=availablePower?Math.min(availablePower,vehicleMax):vehicleMax;
    const efficiency=clamp(num(session.chargeEfficiency)??0.92,0.01,1);
    let energy=num(session.energyKwh);
    const soc=resolveSoc(session,energy);
    if(soc.capacity&&soc.targetSoc!=null)energy=soc.capacity*(soc.targetSoc-soc.startSoc)/100;
    if(energy==null||energy<=0||!availablePower||availablePower<=0)return{minutes:null,energyKwh:energy,profile:'unavailable',averagePowerKw:null,startSoc:soc.startSoc,targetSoc:soc.targetSoc,stationPowerKw:stationPower,availablePowerKw:availablePower};

    const resolved=resolveCurve(session,availablePower);
    if(!resolved.curve||!soc.capacity||soc.targetSoc==null){
      const minutes=(energy/(availablePower*efficiency))*60;
      return{minutes:round(minutes),energyKwh:round(energy),profile:resolved.profile,averagePowerKw:round(energy/(minutes/60)),startSoc:soc.startSoc,targetSoc:soc.targetSoc,stationPowerKw:stationPower,availablePowerKw:availablePower};
    }

    const stepSoc=clamp(num(session.socStepPercent)??0.25,0.05,2),capacity=soc.capacity;
    let minutes=0,delivered=0,s=soc.startSoc;
    while(s<soc.targetSoc-1e-9){
      const next=Math.min(soc.targetSoc,s+stepSoc),mid=(s+next)/2;
      const batteryEnergy=capacity*(next-s)/100;
      const curvePower=Math.max(0.1,interpolate(resolved.curve,mid,availablePower));
      const power=Math.min(availablePower,curvePower);
      minutes+=(batteryEnergy/(power*efficiency))*60;delivered+=batteryEnergy;s=next;
    }
    return{minutes:round(minutes),energyKwh:round(delivered),profile:resolved.profile,averagePowerKw:round(delivered/(minutes/60)),startSoc:soc.startSoc,targetSoc:soc.targetSoc,stationPowerKw:stationPower,availablePowerKw:availablePower};
  }

  return{estimate,stationPowerKw,normalizeCurve,interpolate,GENERIC_DC_CURVE};
});
