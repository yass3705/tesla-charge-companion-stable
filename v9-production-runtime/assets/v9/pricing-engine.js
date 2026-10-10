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
  function ruleThresholdStatus(rule,session={},timeZone=null){
    const energy=num(session.energyKwh),power=num(session.powerKw),soc=num(session.vehicleSoc),congestion=num(session.congestionPct),duration=num(session.durationMinutes);
    const bound=(v,min,max)=>{if(min==null&&max==null)return'match';if(v==null)return'unknown';if(min!=null&&v<Number(min))return'no_match';if(max!=null&&v>Number(max))return'no_match';return'match';};
    for(const [v,min,max] of [[energy,rule?.minEnergyKwh,rule?.maxEnergyKwh],[power,rule?.minPowerKw,rule?.maxPowerKw],[duration,rule?.minDurationMinutes,rule?.maxDurationMinutes],[soc,rule?.minVehicleSoc,rule?.maxVehicleSoc],[congestion,rule?.minCongestionPct,rule?.maxCongestionPct]]){const s=bound(v,min,max);if(s!=='match')return s;}
    const reservation=rule?.reservationState;if(reservation!=null){const actual=String(session.reservationState||'').toUpperCase();if(!actual)return'no_match';if(actual!==String(reservation).toUpperCase())return'no_match';}
    const startDate=rule?.validFromDate,endDate=rule?.validThroughDate;if(startDate!=null||endDate!=null){const parts=localDateParts(session.startAt,timeZone||session.timeZone||null);if(!parts)return'unknown';if(startDate!=null&&parts.key<String(startDate))return'no_match';if(endDate!=null&&parts.key>String(endDate))return'no_match';}
    return'match';
  }
  function ruleThresholdMatches(rule,session={},timeZone=null){return ruleThresholdStatus(rule,session,timeZone)==='match';}
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
  function matchingRuleDetailed(pricing,startAt,timeZone,session={}){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];if(!rules.length)return{rule:null,unknown:false};
    const minute=minuteOfDay(startAt,timeZone);
    const ordered=minute==null?rules:rules.filter(rule=>rule.scope!=='allDay').concat(rules.filter(rule=>rule.scope==='allDay'));
    for(const rule of ordered){if(minute==null&&rule.scope!=='allDay')continue;if(!ruleDayMatches(rule,startAt,timeZone,pricing))continue;if(minute!=null&&!ruleContains(rule,minute))continue;const status=ruleThresholdStatus(rule,session,timeZone);if(status==='unknown')return{rule:null,unknown:true,reason:'missing_rule_context'};if(status==='match')return{rule,unknown:false};}
    return{rule:null,unknown:false};
  }
  function matchingRule(pricing,startAt,timeZone,session={}){return matchingRuleDetailed(pricing,startAt,timeZone,session).rule;}

  function minutesUntilRuleBoundary(rule,startAt,timeZone){
    if(!rule)return Infinity;
    const minute=minuteOfDay(startAt,timeZone);if(minute==null)return null;
    let delta=Infinity;
    if(rule.scope!=='allDay'){
      const end=hm(rule.end,1440);delta=end-minute;if(delta<=0)delta+=1440;
    }
    const daySensitive=Array.isArray(rule?.daysOfWeek)&&rule.daysOfWeek.length||rule?.holidayOnly===true||rule?.excludeHolidays===true||rule?.mustEndSameLocalDay===true;
    if(daySensitive)delta=Math.min(delta,1440-minute);
    return delta;
  }
  function durationBands(rule,dimension){
    const dim=String(dimension||'').toUpperCase();
    return (Array.isArray(rule?.ocpiDurationBands)?rule.ocpiDurationBands:[])
      .filter(b=>Array.isArray(b)&&String(b[0]||'').toUpperCase()===dim)
      .map(b=>[dim,Math.max(0,num(b[1])??0),b[2]==null?null:Math.max(0,num(b[2])??0),num(b[3])??0]);
  }
  function durationBandRate(rule,dimension,elapsedSeconds,baseRate=0){
    for(const band of durationBands(rule,dimension)){
      const min=band[1],max=band[2];
      if(elapsedSeconds+1e-9<min)continue;
      if(max!=null&&elapsedSeconds>=max-1e-9)continue;
      return band[3];
    }
    return baseRate;
  }
  function durationBoundaries(rule,dimension,startMinutes,endMinutes){
    const out=[startMinutes,endMinutes];
    for(const band of durationBands(rule,dimension)){
      for(const raw of [band[1],band[2]]){
        if(raw==null)continue;
        const m=raw/60;
        if(m>startMinutes+1e-9&&m<endMinutes-1e-9)out.push(m);
      }
    }
    return [...new Set(out.map(v=>Number(v.toFixed(9))))].sort((a,b)=>a-b);
  }
  function integrateDurationRate(rule,dimension,startMinutes,endMinutes,baseRate=0){
    if(endMinutes<=startMinutes)return 0;
    const points=durationBoundaries(rule,dimension,startMinutes,endMinutes);
    let total=0;
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1];if(b<=a)continue;
      total+=durationBandRate(rule,dimension,((a+b)/2)*60,baseRate)*(b-a);
    }
    return total;
  }
  function durationFlatRate(rule,durationMinutes,baseRate=0){
    return durationBandRate(rule,'FLAT',Math.max(0,durationMinutes)*60,baseRate);
  }
  function evaluateCongestion(rule,session,charging,elapsed,duration){
    const base=num(rule?.congestionTimePerMinute)??0;
    const bands=Array.isArray(rule?.ocpiCongestionDurationBands)?rule.ocpiCongestionDurationBands:[];
    if(base<=0&&!bands.length)return{complete:true,costEur:0,minutes:0};
    if(session?.includeCongestionFees===false||session?.includeCongestion===false||session?.applyCongestionFees===false)
      return{complete:true,costEur:0,minutes:0,excludedByUser:true};
    const electraPolicy=rule?.electraCongestionPolicy;
    if(electraPolicy?.dcOnly===true&&session?.chargingKind==='AC')
      return{complete:true,costEur:0,minutes:0,excludedByAc:true};
    if(electraPolicy?.requiresSaturation===true&&session?.assumeStationSaturated!==true)
      return{complete:false,costEur:null,reason:'electra_congestion_saturation_unconfirmed'};
    const threshold=num(rule?.congestionStartSoc)??80;
    const from=num(session?.arrivalSoc??session?.startSoc??session?.vehicleSoc);
    const to=num(session?.targetSoc??session?.endSoc);
    let crossing=null;
    const totalCharging=Math.max(0,num(session?.totalChargingMinutes)??charging);
    const timeline=session?.chargeTimeline??session?.socTimeline??session?.timeline;
    if(Array.isArray(timeline)&&timeline.length){
      for(const segment of timeline){
        const a=num(segment?.startSoc),b=num(segment?.endSoc);
        const start=num(segment?.offsetMinutes)??0,len=num(segment?.durationMinutes)??0;
        if(a==null||b==null||len<0)continue;
        if(a>=threshold){crossing=start;break;}
        if(b>threshold&&b>a){crossing=start+len*(threshold-a)/(b-a);break;}
      }
    }
    if(crossing==null&&from!=null&&from>=threshold)crossing=0;
    if(crossing==null&&from!=null&&to!=null){
      if(to<=threshold)return{complete:true,costEur:0,minutes:0};
      if(to>from&&totalCharging>0)crossing=totalCharging*(threshold-from)/(to-from);
    }
    if(crossing==null){
      const explicit=num(session?.congestionMinutes);
      if(explicit!=null&&explicit>=0)crossing=Math.max(0,elapsed+duration-explicit);
      else return{complete:false,reason:'congestion_soc_context_unavailable'};
    }
    const a=Math.max(elapsed,crossing),b=elapsed+duration;
    if(b<=a)return{complete:true,costEur:0,minutes:0,startAfterMinutes:crossing};
    if(electraPolicy){
      // Official Electra-app terms: only a *simulated saturated station* incurs
      // occupancy costs, five grace minutes after crossing SOC 80%, DC only.
      // Its OCPI duration bands are not assumed to describe time since SOC 80.
      const grace=Math.max(0,num(electraPolicy.graceMinutes)??0);
      const billable=Math.max(0,b-Math.max(elapsed,crossing+grace));
      const rate=Math.max(0,num(electraPolicy.rateEurPerMinute)??0);
      const cap=num(electraPolicy.capEur);
      const gross=billable*rate,charge=cap!=null?Math.min(gross,Math.max(0,cap)):gross;
      return{complete:true,costEur:money(charge),minutes:money(billable),startAfterMinutes:crossing,
        graceMinutes:grace,capEur:cap,assumedSaturated:true,dcOnly:electraPolicy.dcOnly===true};
    }
    const rateAt=seconds=>{
      for(const band of bands){
        if(!Array.isArray(band)||band.length<3)continue;
        const lo=Math.max(0,num(band[0])??0),hi=num(band[1]),rate=num(band[2]);
        if(rate==null||rate<0)continue;
        if(seconds+1e-9>=lo&&(hi==null||seconds<hi-1e-9))return rate;
      }
      return base;
    };
    const cuts=[a,b];
    for(const band of bands){
      if(!Array.isArray(band))continue;
      for(const v of [band[0],band[1]]){
        const n=num(v);if(n==null)continue;const m=n/60;
        if(m>a+1e-9&&m<b-1e-9)cuts.push(m);
      }
    }
    cuts.sort((x,y)=>x-y);
    let total=0;
    for(let i=0;i<cuts.length-1;i++){
      const x=cuts[i],y=cuts[i+1];if(y>x)total+=(y-x)*rateAt(((x+y)/2)*60);
    }
    return{complete:true,costEur:money(total),minutes:money(b-a),startAfterMinutes:crossing,defaultSoc:threshold};
  }
  function evaluateRule(rule,{energyKwh=0,durationMinutes=0,chargingMinutes=null,elapsedMinutes=0,...context}={}){
    const energy=Math.max(0,num(energyKwh)??0),duration=Math.max(0,num(durationMinutes)??0),
      charging=Math.max(0,Math.min(duration,num(chargingMinutes)??duration)),elapsed=Math.max(0,num(elapsedMinutes)??0),components={};let total=0;
    const perKwh=num(rule?.pricePerKwh);
    if(perKwh!=null||durationBands(rule,'ENERGY').length){
      const stepWh=num(rule?.energyStepWh);const billedEnergy=stepWh>0&&energy>0?Math.ceil((energy*1000)/stepWh)*stepWh/1000:rule?.energyRounding==='started_kwh'&&energy>0?Math.ceil(energy):energy;
      const baseRate=perKwh??0;
      let effectiveRate=baseRate;
      if(durationBands(rule,'ENERGY').length&&charging>0)effectiveRate=integrateDurationRate(rule,'ENERGY',elapsed,elapsed+charging,baseRate)/charging;
      components.energy=money(billedEnergy*effectiveRate);total+=components.energy;
      if(durationBands(rule,'ENERGY').length)components.energyDurationBands={effectiveRatePerKwh:money(effectiveRate),chargingMinutes:charging,elapsedMinutes:elapsed};
      if(billedEnergy!==energy)components.energyBilling={actualKwh:energy,billedKwh:billedEnergy,rounding:stepWh>0?'started_step':'started_kwh',stepWh:stepWh>0?stepWh:undefined};
    }
    const blockMinutes=num(rule?.connectedTimeBlockMinutes),blockEur=num(rule?.connectedTimeBlockEur);
    if(blockMinutes>0&&blockEur!=null){
      const blocks=rule?.connectedTimeBlockRounding==='started_block'?Math.ceil(duration/blockMinutes):duration/blockMinutes;
      components.connectedTimeBlocks={blocks,blockMinutes,unitPriceEur:blockEur,costEur:money(blocks*blockEur)};total+=components.connectedTimeBlocks.costEur;
    }
    const genericPerMinute=num(rule?.pricePerMinute),legacyPerMinute=num(rule?.connectedTimePerMinuteEur),perMinute=genericPerMinute??legacyPerMinute;
    if(perMinute!=null){const step=num(rule?.connectedTimeStepSeconds),billed=step>0&&duration>0?Math.ceil(duration*60/step)*step/60:duration;components.connectedTimePerMinute=money(billed*perMinute);total+=components.connectedTimePerMinute;if(billed!==duration)components.connectedTimeBilling={actualMinutes:duration,billedMinutes:billed,stepSeconds:step};}
    const chargingPerMinute=num(rule?.chargePerMinute)??num(rule?.chargingTimePerMinuteEur);
    if(chargingPerMinute!=null||durationBands(rule,'TIME').length){
      const step=num(rule?.chargingTimeStepSeconds),billed=step>0&&charging>0?Math.ceil(charging*60/step)*step/60:charging,baseRate=chargingPerMinute??0;
      const cost=durationBands(rule,'TIME').length?integrateDurationRate(rule,'TIME',elapsed,elapsed+billed,baseRate):billed*baseRate;
      components.chargingTime=money(cost);total+=components.chargingTime;
      if(billed!==charging)components.chargingTimeBilling={actualMinutes:charging,billedMinutes:billed,stepSeconds:step};
    }
    const parkingExcluded=rule?.parkingIsCongestion===true&&(
      context.includeCongestionFees===false||context.includeCongestion===false||context.applyCongestionFees===false);
    const idlePerMinute=num(rule?.idlePerMinute);
    if(!parkingExcluded&&(idlePerMinute!=null||durationBands(rule,'PARKING_TIME').length)){
      const idle=Math.max(0,duration-charging),baseRate=idlePerMinute??0;
      const cost=durationBands(rule,'PARKING_TIME').length?integrateDurationRate(rule,'PARKING_TIME',elapsed+charging,elapsed+duration,baseRate):idle*baseRate;
      components.parkingTime=money(cost);total+=components.parkingTime;
    }
    const connectionFee=num(rule?.connectionFee);
    if(connectionFee!=null||durationBands(rule,'FLAT').length){
      const fee=durationFlatRate(rule,elapsed+duration,connectionFee??0);
      if(fee!==0){components.connectionFee=money(fee);total+=components.connectionFee;}
    }
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
    const congestion=evaluateCongestion(rule,context,charging,elapsed,duration);
    if(!congestion.complete)return{complete:false,reason:congestion.reason,totalEur:null,components};
    if(congestion.costEur>0){components.congestionTime={...congestion};total+=congestion.costEur;}
    const minimum=num(rule?.minimumSessionEur);if(minimum!=null&&total<minimum){components.minimumSession={minimumEur:minimum,preMinimumTotalEur:money(total),topUpEur:money(minimum-total)};total=minimum;}
    return{totalEur:money(total),components};
  }
  function segmentableRule(rule){
    if(!rule)return false;
    if(rule.mustEndSameLocalDay===true||rule.holidayOnly===true||rule.excludeHolidays===true||(Array.isArray(rule.daysOfWeek)&&rule.daysOfWeek.length))return false;
    if(rule.energyRounding==='started_kwh'||num(rule.energyStepWh)>0||num(rule.connectedTimeStepSeconds)>0||num(rule.chargingTimeStepSeconds)>0)return false;
    if((num(rule.connectionFee)??0)!==0||durationBands(rule,'FLAT').length)return false;
    if(num(rule.connectedTimeBlockMinutes)>0||num(rule.connectedTimeBlockEur)!=null)return false;
    if(num(rule.connectedTimeFreeMinutes)!=null||num(rule.connectedTimePerMinuteAfterFreeEur)!=null)return false;
    if(num(rule.connectedTimeInitialMinutes)!=null||num(rule.connectedTimeInitialFlatEur)!=null||num(rule.connectedTimeAfterInitialPerMinuteEur)!=null)return false;
    if(num(rule.connectedTimeComponentEur)!=null&&num(rule.connectedTimeComponentEur)!==0)return false;
    if(num(rule.sessionFeeEur)!=null&&num(rule.sessionFeeEur)!==0)return false;
    if(num(rule.minimumSessionEur)!=null)return false;
    return true;
  }
  function addMinutes(value,minutes){
    const d=value instanceof Date?new Date(value.getTime()):new Date(value);if(Number.isNaN(d.getTime()))return null;
    return new Date(d.getTime()+Number(minutes||0)*60000);
  }
  function evaluateSegmentedRules(pricing,session={},timeZone=null){
    const duration=Math.max(0,num(session.durationMinutes)??0),energy=Math.max(0,num(session.energyKwh)??0),charging=Math.max(0,Math.min(duration,num(session.chargingMinutes)??duration));
    if(!session.startAt)return{complete:false,reason:'segmentation_requires_start_time'};
    if(duration<=0){
      const rule=matchingRule(pricing,session.startAt,timeZone,session);if(!rule)return{complete:false,reason:'no_matching_time_rule'};
      if(!segmentableRule(rule))return{complete:false,reason:'tariff_window_crossing_unsupported_components'};
      const evaluated=evaluateRule(rule,{energyKwh:energy,durationMinutes:0,chargingMinutes:0,elapsedMinutes:0});
      return{complete:true,totalEur:evaluated.totalEur,components:{segmentedPricing:{segments:[{startAt:new Date(session.startAt).toISOString(),durationMinutes:0,energyKwh:energy,totalEur:evaluated.totalEur,rule}]}}};
    }
    let elapsed=0,total=0;const segments=[];
    while(elapsed<duration-1e-9){
      const at=addMinutes(session.startAt,elapsed);if(!at)return{complete:false,reason:'invalid_segmentation_start_time'};
      const rule=matchingRule(pricing,at,timeZone,session);if(!rule)return{complete:false,reason:'no_matching_time_rule',segmentStartAt:at.toISOString()};
      if(!segmentableRule(rule))return{complete:false,reason:'tariff_window_crossing_unsupported_components',segmentStartAt:at.toISOString(),matchedRule:rule};
      let boundary=minutesUntilRuleBoundary(rule,at,timeZone);if(boundary==null)return{complete:false,reason:'unresolved_tariff_boundary'};
      if(!Number.isFinite(boundary))boundary=duration-elapsed;
      const slice=Math.min(duration-elapsed,Math.max(boundary,1e-6));
      const chargeOverlap=Math.max(0,Math.min(charging,elapsed+slice)-elapsed),segmentEnergy=charging>0?energy*(chargeOverlap/charging):0;
      const evaluated=evaluateRule(rule,{...session,energyKwh:segmentEnergy,durationMinutes:slice,chargingMinutes:chargeOverlap,elapsedMinutes:elapsed,totalChargingMinutes:charging});
      if(evaluated.complete===false)return{complete:false,reason:evaluated.reason};
      total+=evaluated.totalEur;
      segments.push({startAt:at.toISOString(),durationMinutes:money(slice),chargingMinutes:money(chargeOverlap),energyKwh:money(segmentEnergy),totalEur:evaluated.totalEur,components:evaluated.components,rule});
      elapsed+=slice;
      if(segments.length>96)return{complete:false,reason:'tariff_segmentation_guard'};
    }
    return{complete:true,totalEur:money(total),components:{segmentedPricing:{segments,totalEur:money(total)}}};
  }
  function evaluateConditionalSessionFees(fees,session={}){
    if(fees==null)return{complete:true,totalEur:0,component:null};
    if(!Array.isArray(fees))return{complete:false,totalEur:0,component:null,reason:'invalid_conditional_session_fees'};
    const energy=Math.max(0,num(session.energyKwh)??0),duration=Math.max(0,num(session.durationMinutes)??0),items=[];let total=0;
    for(const fee of fees){
      const amount=num(fee?.amountEur),conditions=fee?.conditions;
      if(amount==null||amount<0||!Array.isArray(conditions)||!conditions.length)return{complete:false,totalEur:0,component:null,reason:'invalid_conditional_session_fee'};
      let applies=true;const evaluated=[];
      for(const condition of conditions){
        const threshold=num(condition?.value);if(threshold==null||threshold<0)return{complete:false,totalEur:0,component:null,reason:'invalid_conditional_fee_threshold'};
        let matched=false,detail=null;
        if(condition?.kind==='energy_above_kwh'){
          matched=energy>threshold;detail={kind:'energy_above_kwh',value:threshold,actualEnergyKwh:energy,matched};
        }else if(condition?.kind==='session_duration_after_minutes'){
          matched=duration>threshold;detail={kind:'session_duration_after_minutes',value:threshold,actualDurationMinutes:duration,matched};
        }else return{complete:false,totalEur:0,component:null,reason:'unsupported_conditional_fee_condition',conditionKind:condition?.kind||null};
        evaluated.push(detail);if(!matched)applies=false;
      }
      const costEur=applies?money(amount):0;if(applies)total+=costEur;
      items.push({amountEur:amount,applied:applies,costEur,conditions:evaluated});
    }
    return{complete:true,totalEur:money(total),component:{fees:items,costEur:money(total)}};
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
  function applyMinimumTotal(pricing,total,components){
    const minimum=num(pricing?.minimumTotalEur);if(minimum==null||total>=minimum)return{totalEur:money(total),components};
    const topUp=money(minimum-total);return{totalEur:money(minimum),components:{...components,minimumTotal:{minimumEur:minimum,preMinimumTotalEur:money(total),topUpEur:topUp}}};
  }
  function evaluateComponentGroups(pricing,session={},timeZone=null){
    const groups=Array.isArray(pricing?.componentGroups)?pricing.componentGroups:[];if(!groups.length)return{complete:false,reason:'missing_component_groups'};
    let total=0;const components={componentGroups:[]};
    for(const group of groups){
      const rules=Array.isArray(group?.rules)?group.rules:[];if(!rules.length)continue;
      const localPricing={...pricing,rules};const match=matchingRuleDetailed(localPricing,session.startAt,timeZone,session);if(match.unknown)return{complete:false,reason:match.reason,componentKind:group.kind||null};const rule=match.rule;
      if(!rule){components.componentGroups.push({kind:group.kind||null,matched:false,costEur:0});continue;}
      const evaluated=evaluateRule(rule,session);if(evaluated.complete===false)return{complete:false,reason:evaluated.reason};total+=evaluated.totalEur;components.componentGroups.push({kind:group.kind||null,matched:true,costEur:evaluated.totalEur,components:evaluated.components,rule});
    }
    return{complete:true,totalEur:money(total),components};
  }
  function evaluateOffer(offer,session={}){
    const pricing=offer?.pricing||{},timeZone=session.timeZone||offer?.metadata?.timeZone||null;
    if(pricing.type==='component_groups'){
      const base=evaluateComponentGroups(pricing,session,timeZone);if(base.complete===false)return{...base,offerId:offer?.id||null,timeZone};
      const finalized=applyMinimumTotal(pricing,base.totalEur,base.components);return{complete:true,totalEur:finalized.totalEur,components:finalized.components,offerId:offer?.id||null,currency:offer?.currency||'EUR',timeZone};
    }
    if(pricing.type!=='rules'){
      const rate=num(pricing.pricePerKwh);if(rate==null)return{complete:false,reason:'unsupported_pricing',offerId:offer?.id||null};
      const energy=Math.max(0,num(session.energyKwh)??0),base=money(rate*energy),conditional=evaluateConditionalSessionFees(pricing.conditionalSessionFees,session);
      if(conditional.complete===false)return{complete:false,reason:conditional.reason,offerId:offer?.id||null,conditionKind:conditional.conditionKind||null};
      const post=evaluatePostChargeFee(pricing.postChargeFee,session,timeZone);if(post.complete===false)return{complete:false,reason:post.reason,offerId:offer?.id||null};
      const components={energy:base,...(conditional.component?{conditionalSessionFees:conditional.component}:{}),...(post.component?{postCharge:post.component}:{})};
      const finalized=applyMinimumTotal(pricing,base+conditional.totalEur+post.totalEur,components);
      return{complete:true,totalEur:finalized.totalEur,components:finalized.components,offerId:offer?.id||null,currency:offer?.currency||'EUR'};
    }
    const match=matchingRuleDetailed(pricing,session.startAt,timeZone,session);if(match.unknown)return{complete:false,reason:match.reason,offerId:offer?.id||null,timeZone};const rule=match.rule;if(!rule)return{complete:false,reason:'no_matching_time_rule',offerId:offer?.id||null,timeZone};
    const duration=Math.max(0,num(session.durationMinutes)??0),boundary=minutesUntilRuleBoundary(rule,session.startAt,timeZone);
    let base,segmented=false;
    if(boundary!=null&&Number.isFinite(boundary)&&duration>boundary+1e-9){
      base=evaluateSegmentedRules(pricing,session,timeZone);if(base.complete===false)return{...base,offerId:offer?.id||null,timeZone,boundaryMinutes:boundary};segmented=true;
    }else base=evaluateRule(rule,session);
    if(base.complete===false)return{complete:false,reason:base.reason,offerId:offer?.id||null};
    const longFee=pricing.longConnectionFee;let longConnection=null,total=base.totalEur;
    if(longFee&&duration>(num(longFee.thresholdMinutes)??Infinity)){
      const rate=num(longFee.eurPerHourAfterThreshold);if(rate!=null){const excess=duration-Number(longFee.thresholdMinutes);longConnection={complete:false,reason:'hourly_rounding_unspecified',excessMinutes:excess,rateEurPerHour:rate};}
    }
    const conditional=evaluateConditionalSessionFees(pricing.conditionalSessionFees,session);if(conditional.complete===false)return{complete:false,reason:conditional.reason,offerId:offer?.id||null,timeZone,conditionKind:conditional.conditionKind||null};
    total+=conditional.totalEur;
    const post=evaluatePostChargeFee(pricing.postChargeFee,session,timeZone);if(post.complete===false)return{complete:false,reason:post.reason,offerId:offer?.id||null,timeZone};
    total+=post.totalEur;
    const components={...base.components,...(conditional.component?{conditionalSessionFees:conditional.component}:{}),...(post.component?{postCharge:post.component}:{})};
    const finalized=applyMinimumTotal(pricing,total,components);
    return{complete:!longConnection,totalEur:finalized.totalEur,components:finalized.components,longConnection,offerId:offer?.id||null,currency:offer?.currency||'EUR',matchedRule:rule,segmented,timeZone};
  }
  return{evaluateOffer,evaluateRule,evaluateCongestion,evaluateSegmentedRules,evaluateComponentGroups,segmentableRule,durationBands,durationBandRate,integrateDurationRate,durationFlatRate,ruleThresholdStatus,ruleThresholdMatches,matchingRuleDetailed,evaluateConditionalSessionFees,evaluatePostChargeFee,postChargeBillableMinutes,exemptWindowContains,matchingRule,ruleContains,ruleDayMatches,localDateParts,isHoliday,italianHolidayKeys,minuteOfDay,minutesUntilRuleBoundary,applyMinimumTotal};
});