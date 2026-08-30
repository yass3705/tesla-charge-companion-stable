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
  function localDateParts(value,timeZone){
    const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return null;
    try{
      if(timeZone){
        const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(d);
        const get=t=>parts.find(p=>p.type===t)?.value;
        const weekdays={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
        const weekday=weekdays[get('weekday')];
        const year=Number(get('year')),month=Number(get('month')),day=Number(get('day'));
        if(!Number.isFinite(year)||!Number.isFinite(month)||!Number.isFinite(day)||weekday==null)return null;
        return{year,month,day,weekday,key:`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`};
      }
      return{year:d.getFullYear(),month:d.getMonth()+1,day:d.getDate(),weekday:d.getDay(),key:`${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
    }catch(_){return null;}
  }
  function easterSundayUtc(year){
    const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
    return new Date(Date.UTC(year,month-1,day));
  }
  function italianHolidayKeys(year){
    const fixed=['01-01','01-06','04-25','05-01','06-02','08-15','11-01','12-08','12-25','12-26'].map(md=>`${year}-${md}`);
    const easter=easterSundayUtc(year),monday=new Date(easter.getTime()+86400000);
    fixed.push(`${monday.getUTCFullYear()}-${String(monday.getUTCMonth()+1).padStart(2,'0')}-${String(monday.getUTCDate()).padStart(2,'0')}`);
    return new Set(fixed);
  }
  function isHoliday(calendar,value,timeZone){
    if(!calendar)return false;const p=localDateParts(value,timeZone);if(!p)return null;
    if(String(calendar).toUpperCase()==='IT')return italianHolidayKeys(p.year).has(p.key);
    return false;
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
  function ruleDayMatches(rule,startAt,timeZone,pricing){
    const days=Array.isArray(rule?.daysOfWeek)?rule.daysOfWeek.map(Number).filter(n=>n>=0&&n<=6):null;
    const constrained=Boolean(days?.length||rule?.holidayOnly===true||rule?.excludeHolidays===true);
    if(!constrained)return true;
    if(!startAt)return false;
    const parts=localDateParts(startAt,timeZone);if(!parts)return false;
    const holiday=isHoliday(pricing?.holidayCalendar,startAt,timeZone);
    if(rule?.holidayOnly===true&&holiday!==true)return false;
    if(rule?.excludeHolidays===true&&holiday===true)return false;
    if(days?.length&&!days.includes(parts.weekday))return false;
    return true;
  }
  function matchingRule(pricing,startAt,timeZone){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
    if(!rules.length)return null;const minute=minuteOfDay(startAt,timeZone);if(minute==null)return rules.find(r=>r.scope==='allDay'&&ruleDayMatches(r,startAt,timeZone,pricing))||null;
    return rules.find(r=>ruleDayMatches(r,startAt,timeZone,pricing)&&ruleContains(r,minute))||null;
  }
  function minutesUntilRuleBoundary(rule,startAt,timeZone){
    if(!rule)return Infinity;
    const minute=minuteOfDay(startAt,timeZone);if(minute==null)return null;
    let delta=Infinity;
    if(rule.scope!=='allDay'){
      const end=hm(rule.end,1440);delta=end-minute;if(delta<=0)delta+=1440;
    }
    if(rule.mustEndSameLocalDay===true)delta=Math.min(delta,1440-minute);
    return delta;
  }
  function evaluateRule(rule,{energyKwh=0,durationMinutes=0}={}){
    const energy=Math.max(0,num(energyKwh)??0),duration=Math.max(0,num(durationMinutes)??0),components={};let total=0;
    const perKwh=num(rule?.pricePerKwh);
    if(perKwh!=null){
      const billedEnergy=rule?.energyRounding==='started_kwh'&&energy>0?Math.ceil(energy):energy;
      components.energy=money(billedEnergy*perKwh);total+=components.energy;
      if(billedEnergy!==energy)components.energyBilling={actualKwh:energy,billedKwh:billedEnergy,rounding:'started_kwh'};
    }
    const pricePerMinute=num(rule?.pricePerMinute);
    if(pricePerMinute!=null){components.connectedTimePerMinute=money(duration*pricePerMinute);total+=components.connectedTimePerMinute;}
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
    const sessionFee=num(rule?.sessionFeeEur);if(sessionFee!=null&&sessionFee!==0){components.sessionFee=money(sessionFee);total+=components.sessionFee;}
    const minimum=num(rule?.minimumSessionEur);if(minimum!=null&&total<minimum){components.minimumSession={minimumEur:minimum,preMinimumTotalEur:money(total),topUpEur:money(minimum-total)};total=minimum;}
    return{totalEur:money(total),components};
  }
  function exemptWindowContains(window,minute){
    const start=hm(window?.start,null),end=hm(window?.end,null);if(start==null||end==null)return false;
    if(start===end)return true;
    if(end>start)return minute>=start&&minute<end;
    return minute>=start||minute<end;
  }
  function postChargeBillableMinutes(fee,{postChargeMinutes=0,postChargeStartAt=null}={},timeZone=null){
    const duration=Math.max(0,num(postChargeMinutes)??0),grace=Math.max(0,num(fee?.graceMinutes)??0),afterGrace=Math.max(0,duration-grace);
    const windows=Array.isArray(fee?.exemptLocalWindows)?fee.exemptLocalWindows.filter(Boolean):[];
    if(afterGrace<=0)return{complete:true,duration,grace,afterGrace,billableMinutes:0,exemptMinutes:0};
    if(!windows.length)return{complete:true,duration,grace,afterGrace,billableMinutes:afterGrace,exemptMinutes:0};
    if(!postChargeStartAt)return{complete:false,reason:'post_charge_exemption_requires_start_time',duration,grace,afterGrace};
    const start=new Date(postChargeStartAt);if(Number.isNaN(start.getTime()))return{complete:false,reason:'invalid_post_charge_start_time',duration,grace,afterGrace};
    const billableStartMs=start.getTime()+grace*60000;let remaining=afterGrace,offset=0,billable=0,exempt=0;
    while(remaining>1e-9){
      const slice=Math.min(1,remaining),mid=new Date(billableStartMs+(offset+slice/2)*60000),minute=minuteOfDay(mid,timeZone);
      if(minute==null)return{complete:false,reason:'post_charge_exemption_timezone_unresolved',duration,grace,afterGrace};
      if(windows.some(w=>exemptWindowContains(w,minute)))exempt+=slice;else billable+=slice;
      remaining-=slice;offset+=slice;
    }
    return{complete:true,duration,grace,afterGrace,billableMinutes:money(billable),exemptMinutes:money(exempt)};
  }
  function evaluatePostChargeFee(fee,session={},timeZone=null){
    if(!fee)return{totalEur:0,component:null};
    const span=postChargeBillableMinutes(fee,session,timeZone);if(span.complete===false)return{totalEur:0,component:null,complete:false,reason:span.reason};
    const duration=span.duration,grace=span.grace,billable=span.billableMinutes,exemptMinutes=span.exemptMinutes;
    const baseComponent={postChargeMinutes:duration,graceMinutes:grace,billableMinutes:billable,exemptMinutes,costEur:0};
    if(billable<=0)return{totalEur:0,component:baseComponent};
    const blockMinutes=num(fee.blockMinutes),blockEur=num(fee.blockEur);
    if(blockMinutes>0&&blockEur!=null){
      const blocks=fee.rounding==='started_block'?Math.ceil(billable/blockMinutes):billable/blockMinutes,costEur=money(blocks*blockEur);
      return{totalEur:costEur,component:{...baseComponent,blocks,blockMinutes,unitPriceEur:blockEur,costEur}};
    }
    const perMinute=num(fee.eurPerMinute);if(perMinute!=null){const costEur=money(billable*perMinute);return{totalEur:costEur,component:{...baseComponent,eurPerMinute:perMinute,costEur}};}
    return{totalEur:0,component:null,complete:false,reason:'unsupported_post_charge_fee'};
  }
  function evaluateOffer(offer,session={}){
    const pricing=offer?.pricing||{},timeZone=session.timeZone||offer?.metadata?.timeZone||null;
    if(pricing.type!=='rules'){
      const rate=num(pricing.pricePerKwh);if(rate==null)return{complete:false,reason:'unsupported_pricing',offerId:offer?.id||null};
      const energy=Math.max(0,num(session.energyKwh)??0),base=money(rate*energy),post=evaluatePostChargeFee(pricing.postChargeFee,session,timeZone);
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
    const post=evaluatePostChargeFee(pricing.postChargeFee,session,timeZone);if(post.complete===false)return{complete:false,reason:post.reason,offerId:offer?.id||null,timeZone};
    total+=post.totalEur;const components={...base.components,...(post.component?{postCharge:post.component}:{})};
    return{complete:!longConnection,totalEur:money(total),components,longConnection,offerId:offer?.id||null,currency:offer?.currency||'EUR',matchedRule:rule,timeZone};
  }
  return{evaluateOffer,evaluateRule,evaluatePostChargeFee,postChargeBillableMinutes,exemptWindowContains,matchingRule,ruleContains,ruleDayMatches,localDateParts,isHoliday,italianHolidayKeys,minuteOfDay,minutesUntilRuleBoundary};
});
