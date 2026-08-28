// Tesla Charge Companion — OCPI duration restriction pricing extension.
// Test-branch helper: preserves the existing priceWithRules calculation and
// applies exact OCPI session-duration bands per priced dimension.
(function(root){
  'use strict';

  const DIM_ENERGY='ENERGY';
  const DIM_TIME='TIME';
  const DIM_PARKING='PARKING_TIME';

  function number(value,fallback=0){
    const n=Number(value);return Number.isFinite(n)?n:fallback;
  }

  function bandsFor(rule,dimension){
    return (Array.isArray(rule?.ocpiDurationBands)?rule.ocpiDurationBands:[])
      .filter(b=>Array.isArray(b)&&String(b[0]||'').toUpperCase()===dimension);
  }

  function bandRate(rule,dimension,elapsedSeconds,baseRate){
    for(const band of bandsFor(rule,dimension)){
      const min=Math.max(0,number(band[1],0));
      const rawMax=band[2];
      const max=rawMax==null?null:Math.max(0,number(rawMax,0));
      if(elapsedSeconds+1e-9<min)continue;
      if(max!=null&&elapsedSeconds>=max-1e-9)continue;
      return number(band[3],baseRate);
    }
    return baseRate;
  }

  function durationBoundaries(rule,dimension,startMinutes,endMinutes){
    const out=[startMinutes,endMinutes];
    for(const band of bandsFor(rule,dimension)){
      for(const raw of [band[1],band[2]]){
        if(raw==null)continue;
        const m=number(raw,0)/60;
        if(m>startMinutes+1e-9&&m<endMinutes-1e-9)out.push(m);
      }
    }
    return [...new Set(out.map(v=>Number(v.toFixed(9))))].sort((a,b)=>a-b);
  }

  function integrateRate(rule,dimension,startMinutes,endMinutes,baseRate){
    if(endMinutes<=startMinutes)return 0;
    const points=durationBoundaries(rule,dimension,startMinutes,endMinutes);
    let total=0;
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1];
      if(b<=a)continue;
      const probeSeconds=((a+b)/2)*60;
      const rate=bandRate(rule,dimension,probeSeconds,baseRate);
      total+=rate*(b-a);
    }
    return total;
  }

  function hasDurationBands(pricing){
    return (pricing?.rules||[]).some(rule=>Array.isArray(rule?.ocpiDurationBands)&&rule.ocpiDurationBands.length);
  }

  function adjust(baseResult,pricing,startMin,chargeMinutes,billedEnergy,helpers){
    if(!baseResult||baseResult.error||!hasDurationBands(pricing))return baseResult;
    const rules=pricing.rules||[];
    const occupied=Math.max(number(baseResult.occupiedMinutes,chargeMinutes),number(chargeMinutes,0));
    const charge=Math.max(0,number(chargeMinutes,0));
    const energyPerMinute=charge>0?Math.max(0,number(billedEnergy,0))/charge:0;
    const ruleForMinute=helpers.ruleForMinute;
    const minuteOfSession=helpers.minuteOfSession;
    const fxToEur=helpers.fxToEur;
    if(typeof ruleForMinute!=='function'||typeof minuteOfSession!=='function'||typeof fxToEur!=='function')return baseResult;

    let chargeDelta=0;
    let exactParking=0;
    const currencies=new Set(baseResult.currencies||[]);

    // Re-price only the OCPI duration-sensitive dimensions. ENERGY and TIME
    // apply while charging; PARKING_TIME applies only after charging has ended.
    for(let pos=0;pos<charge-1e-9;){
      const next=Math.min(charge,Math.floor(pos+1e-9)+1);
      const minuteIndex=Math.floor(pos+1e-9);
      const rule=ruleForMinute(rules,minuteOfSession(startMin,minuteIndex));
      if(!rule){pos=next;continue;}
      const currency=(rule.currency||'EUR').toUpperCase();currencies.add(currency);
      const span=next-pos;

      const baseTime=Math.max(0,number(rule.chargePerMinute,0));
      const wantedTime=integrateRate(rule,DIM_TIME,pos,next,baseTime);
      chargeDelta+=fxToEur(wantedTime-baseTime*span,currency);

      const baseEnergy=Math.max(0,number(rule.pricePerKwh,0));
      const wantedEnergyPerMinute=integrateRate(rule,DIM_ENERGY,pos,next,baseEnergy)/Math.max(span,1e-12);
      chargeDelta+=fxToEur((wantedEnergyPerMinute-baseEnergy)*energyPerMinute*span,currency);
      pos=next;
    }

    for(let pos=charge;pos<occupied-1e-9;){
      const next=Math.min(occupied,Math.floor(pos+1e-9)+1);
      const minuteIndex=Math.floor(pos+1e-9);
      const rule=ruleForMinute(rules,minuteOfSession(startMin,minuteIndex));
      if(!rule){pos=next;continue;}
      const currency=(rule.currency||'EUR').toUpperCase();currencies.add(currency);
      const baseParking=Math.max(0,number(rule.idlePerMinute,0));
      const wantedParking=integrateRate(rule,DIM_PARKING,pos,next,baseParking);
      exactParking+=fxToEur(wantedParking,currency);
      pos=next;
    }

    const oldIdle=Math.max(0,number(baseResult.idleCost,0));
    const result={...baseResult};
    result.chargeCost=number(baseResult.chargeCost,0)+chargeDelta;
    result.idleCost=exactParking;
    result.ocpiDurationAdjustment=chargeDelta+(exactParking-oldIdle);
    result.total=number(baseResult.total,0)+result.ocpiDurationAdjustment;
    result.currencies=[...currencies];
    return result;
  }

  function install(target){
    if(!target||typeof target.priceWithRules!=='function')return false;
    if(target.priceWithRules.__tccOcpiDurationWrapped)return true;
    const original=target.priceWithRules;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const base=original.call(this,pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments);
      return adjust(base,pp,startMin,chargeMinutes,billedEnergy,{
        ruleForMinute:target.ruleForMinute,
        minuteOfSession:target.minuteOfSession,
        fxToEur:target.fxToEur,
      });
    };
    wrapped.__tccOcpiDurationWrapped=true;
    wrapped.__tccOcpiDurationOriginal=original;
    target.priceWithRules=wrapped;
    return true;
  }

  const api={bandRate,integrateRate,adjust,install};
  root.TCCOcpiDurationPricing=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(typeof root.priceWithRules==='function')install(root);
})(typeof window!=='undefined'?window:globalThis);
