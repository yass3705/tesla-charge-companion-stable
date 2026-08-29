(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9PricingEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const money=v=>Math.round((Number(v)+Number.EPSILON)*1000000)/1000000;
  function minuteOfDay(value,timeZone){
    if(typeof value==='number'&&Number.isFinite(value))return ((Math.floor(value)%1440)+1440)%1440;
    const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return null;
    if(timeZone){
      try{
        const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d);
        const get=t=>Number(parts.find(p=>p.type===t)?.value||0);
        return get('hour')*60+get('minute')+get('second')/60;
      }catch(_){return null;}
    }
    return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;
  }
  function hm(v,fallback){
    if(!v)return fallback;const m=String(v).match(/^(\d{1,2}):(\d{2})$/);if(!m)return fallback;
    const h=Number(m[1]),min=Number(m[2]);if(h===24&&min===0)return 1440;if(h>23||min>59)return fallback;return h*60+min;
  }
  function ruleContains(rule,minute){
    if(rule?.scope==='allDay')return true;
    const start=hm(rule?.start,0),end=hm(rule?.end,1440);
    if(start===end)return true;
    if(end>start)return minute>=start&&minute<end;
    return minute>=start||minute<end;
  }
  function matchingRule(pricing,startAt,timeZone){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
    if(!rules.length)return null;const minute=minuteOfDay(startAt,timeZone);if(minute==null)return rules.find(r=>r.scope==='allDay')||null;
    return rules.find(r=>ruleContains(r,minute))||null;
  }
  function minutesUntilRuleBoundary(rule,startAt,timeZone){
    if(!rule||rule.scope==='allDay')return Infinity;
    const minute=minuteOfDay(startAt,timeZone);if(minute==null)return null;
    const end=hm(rule.end,1440);let delta=end-minute;if(delta<=0)delta+=1440;return delta;
  }
  function evaluateRule(rule,{energyKwh=0,durationMinutes=0}={}){
    const energy=Math.max(0,num(energyKwh)??0),duration=Math.max(0,num(durationMinutes)??0),components={};let total=0;
    const perKwh=num(rule?.pricePerKwh);
    if(perKwh!=null){
      const billedEnergy=rule?.energyRounding==='started_kwh'&&energy>0?Math.ceil(energy):energy;
      components.energy=money(billedEnergy*perKwh);total+=components.energy;
      if(billedEnergy!==energy)components.energyBilling={actualKwh:energy,billedKwh:billedEnergy,rounding:'started_kwh'};
    }
    const blockMinutes=num(rule?.connectedTimeBlockMinutes),blockEur=num(rule?.connectedTimeBlockEur);
    if(blockMinutes>0&&blockEur!=null){
      const blocks=rule?.connectedTimeBlockRounding==='started_block'?Math.ceil(duration/blockMinutes):duration/blockMinutes;
      components.connectedTimeBlocks={blocks,blockMinutes,unitPriceEur:blockEur,costEur:money(blocks*blockEur)};total+=components.connectedTimeBlocks.costEur;
    }
    const perMinute=num(rule?.connectedTimePerMinuteEur);if(perMinute!=null){components.connectedTimePerMinute=money(duration*perMinute);total+=components.connectedTimePerMinute;}
    const freeMinutes=num(rule?.connectedTimeFreeMinutes),afterFree=num(rule?.connectedTimePerMinuteAfterFreeEur);
    if(freeMinutes!=null&&freeMinutes>=0&&afterFree!=null){
      const billableMinutes=Math.max(0,duration-freeMinutes),costEur=money(billableMinutes*afterFree);
      components.connectedTimeAfterFree={freeMinutes,billableMinutes,eurPerMinute:afterFree,costEur};total+=costEur;
    }
    const initialMinutes=num(rule?.connectedTimeInitialMinutes),initialFlat=num(rule?.connectedTimeInitialFlatEur),afterInitial=num(rule?.connectedTimeAfterInitialPerMinuteEur);
    if(initialMinutes>0&&initialFlat!=null&&afterInitial!=null&&duration>0){
      const excessMinutes=Math.max(0,duration-initialMinutes),costEur=money(initialFlat+excessMinutes*afterInitial);
      components.connectedTimeInitialTier={initialMinutes,initialFlatEur:initialFlat,excessMinutes,eurPerMinuteAfterInitial:afterInitial,costEur};total+=costEur;
    }
    const fixed=num(rule?.connectedTimeComponentEur);if(fixed!=null&&fixed!==0){components.connectedTimeComponent=money(fixed);total+=components.connectedTimeComponent;}
    return{totalEur:money(total),components};
  }
  function evaluatePostChargeFee(fee,{postChargeMinutes=0}={}){
    if(!fee)return{totalEur:0,component:null};
    const duration=Math.max(0,num(postChargeMinutes)??0),grace=Math.max(0,num(fee.graceMinutes)??0),billable=Math.max(0,duration-grace);
    if(billable<=0)return{totalEur:0,component:{postChargeMinutes:duration,graceMinutes:grace,billableMinutes:0,costEur:0}};
    const blockMinutes=num(fee.blockMinutes),blockEur=num(fee.blockEur);
    if(blockMinutes>0&&blockEur!=null){
      const blocks=fee.rounding==='started_block'?Math.ceil(billable/blockMinutes):billable/blockMinutes,costEur=money(blocks*blockEur);
      return{totalEur:costEur,component:{postChargeMinutes:duration,graceMinutes:grace,billableMinutes:billable,blocks,blockMinutes,unitPriceEur:blockEur,costEur}};
    }
    const perMinute=num(fee.eurPerMinute);if(perMinute!=null){const costEur=money(billable*perMinute);return{totalEur:costEur,component:{postChargeMinutes:duration,graceMinutes:grace,billableMinutes:billable,eurPerMinute:perMinute,costEur}};}
    return{totalEur:0,component:null,complete:false,reason:'unsupported_post_charge_fee'};
  }
  function evaluateOffer(offer,session={}){
    const pricing=offer?.pricing||{},timeZone=session.timeZone||offer?.metadata?.timeZone||null;
    if(pricing.type!=='rules'){
      const rate=num(pricing.pricePerKwh);if(rate==null)return{complete:false,reason:'unsupported_pricing',offerId:offer?.id||null};
      const energy=Math.max(0,num(session.energyKwh)??0),base=money(rate*energy),post=evaluatePostChargeFee(pricing.postChargeFee,session);
      if(post.complete===false)return{complete:false,reason:post.reason,offerId:offer?.id||null};
      return{complete:true,totalEur:money(base+post.totalEur),components:{energy:base,...(post.component?{postCharge:post.component}:{})},offerId:offer?.id||null,currency:offer?.currency||'EUR'};
    }
    const rule=matchingRule(pricing,session.startAt,timeZone);if(!rule)return{complete:false,reason:'no_matching_time_rule',offerId:offer?.id||null,timeZone};
    const duration=Math.max(0,num(session.durationMinutes)??0),boundary=minutesUntilRuleBoundary(rule,session.startAt,timeZone);
    if(boundary!=null&&Number.isFinite(boundary)&&duration>boundary+1e-9)return{complete:false,reason:'tariff_window_crossing_requires_segmentation',offerId:offer?.id||null,boundaryMinutes:boundary,matchedRule:rule,timeZone};
    const base=evaluateRule(rule,session),longFee=pricing.longConnectionFee;let longConnection=null,total=base.totalEur;
    if(longFee&&duration>(num(longFee.thresholdMinutes)??Infinity)){
      const rate=num(longFee.eurPerHourAfterThreshold);if(rate!=null){const excess=duration-Number(longFee.thresholdMinutes);longConnection={complete:false,reason:'hourly_rounding_unspecified',excessMinutes:excess,rateEurPerHour:rate};}
    }
    const post=evaluatePostChargeFee(pricing.postChargeFee,session);if(post.complete===false)return{complete:false,reason:post.reason,offerId:offer?.id||null,timeZone};
    total+=post.totalEur;const components={...base.components,...(post.component?{postCharge:post.component}:{})};
    return{complete:!longConnection,totalEur:money(total),components,longConnection,offerId:offer?.id||null,currency:offer?.currency||'EUR',matchedRule:rule,timeZone};
  }
  return{evaluateOffer,evaluateRule,evaluatePostChargeFee,matchingRule,ruleContains,minuteOfDay,minutesUntilRuleBoundary};
});
