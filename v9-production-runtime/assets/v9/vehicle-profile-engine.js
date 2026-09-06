(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9VehicleProfileEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));

  function normalizeProfile(raw={}){
    const id=text(raw.id||raw.profileId);if(!id)return null;
    const battery=raw.battery||{},consumption=raw.consumption||{},charging=raw.charging||{};
    return{
      id,
      label:text(raw.label||raw.name||id),
      make:text(raw.make)||null,
      model:text(raw.model)||null,
      variant:text(raw.variant)||null,
      status:text(raw.status)||'active',
      battery:{usableKwh:num(battery.usableKwh??raw.batteryCapacityKwh)},
      consumption:{kwhPer100Km:num(consumption.kwhPer100Km??raw.consumptionKwhPer100Km)},
      charging:{
        acMaxKw:num(charging.acMaxKw??raw.vehicleMaxAcKw),
        dcMaxKw:num(charging.dcMaxKw??raw.vehicleMaxDcKw??raw.vehicleMaxChargeKw),
        efficiency:num(charging.efficiency??raw.chargeEfficiency),
        curve:Array.isArray(charging.curve)?clone(charging.curve):(Array.isArray(raw.chargeCurve)?clone(raw.chargeCurve):null)
      },
      metadata:clone(raw.metadata)||null
    };
  }

  function createCatalog(raw={}){
    const profiles=Array.isArray(raw)?raw:(raw.profiles||[]),map=new Map();
    for(const item of profiles){const p=normalizeProfile(item);if(p)map.set(p.id,p);}
    return{
      list:()=>[...map.values()].map(clone),
      get:id=>{const p=map.get(text(id));return p?clone(p):null;},
      has:id=>map.has(text(id)),
      size:map.size
    };
  }

  function applyToSession(profile,session={}){
    const p=profile?normalizeProfile(profile):null;if(!p)return{...session};
    const out={...session,vehicleProfileId:p.id};
    if(num(out.batteryCapacityKwh)==null&&p.battery.usableKwh!=null)out.batteryCapacityKwh=p.battery.usableKwh;
    if(num(out.consumptionKwhPer100Km)==null&&p.consumption.kwhPer100Km!=null)out.consumptionKwhPer100Km=p.consumption.kwhPer100Km;
    if(num(out.vehicleMaxAcKw)==null&&p.charging.acMaxKw!=null)out.vehicleMaxAcKw=p.charging.acMaxKw;
    if(num(out.vehicleMaxDcKw)==null&&p.charging.dcMaxKw!=null)out.vehicleMaxDcKw=p.charging.dcMaxKw;
    if(num(out.vehicleMaxChargeKw)==null&&p.charging.dcMaxKw!=null)out.vehicleMaxChargeKw=p.charging.dcMaxKw;
    if(num(out.chargeEfficiency)==null&&p.charging.efficiency!=null)out.chargeEfficiency=p.charging.efficiency;
    if(!Array.isArray(out.chargeCurve)&&Array.isArray(p.charging.curve))out.chargeCurve=clone(p.charging.curve);
    return out;
  }

  function resolve({catalog,profileId,profile,session={}}={}){
    const selected=profile?normalizeProfile(profile):(catalog?.get?catalog.get(profileId):null);
    return{profile:selected,session:applyToSession(selected,session)};
  }

  return{normalizeProfile,createCatalog,applyToSession,resolve};
});
