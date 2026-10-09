
  // TCC V9: exact EVSE-level surcharge and Tesla dynamic-minute extension.
  // This code is injected inside pricing-engine factory; evaluateOfferBase is
  // the pinned production implementation, unchanged for unrelated CPOs.
  function afterMinutesHasFee(pricing){
    return pricing?.type==='rules'&&Array.isArray(pricing.rules)&&
      pricing.rules.some(rule=>rule?.afterMinutesRate!=null&&Number(rule.afterMinutesRate)>0);
  }
  function scopedNightGroup(at,timeZone,minute){
    const parts=localDateParts(at,timeZone);
    if(!parts)return null;
    let day=new Date(Date.UTC(parts.year,parts.month-1,parts.day));
    if(minute<480)day=new Date(day.getTime()-86400000);
    return day.toISOString().slice(0,10);
  }
  function applyAfterMinutes(base,offer,session={}){
    if(!base?.complete||base?.components?.afterMinutes||!afterMinutesHasFee(offer?.pricing))return base;
    const pricing=offer.pricing,rules=pricing.rules,timeZone=session.timeZone||offer?.metadata?.timeZone;
    if(!timeZone||!session.startAt)return{complete:false,reason:'after_minutes_requires_start_and_timezone',offerId:offer?.id};
    const start=new Date(session.startAt),duration=num(session.durationMinutes);
    if(Number.isNaN(start.getTime())||duration==null||duration<0||duration>10080)
      return{complete:false,reason:'after_minutes_invalid_session',offerId:offer?.id};
    let regular=0,capped=0,cappedLimit=null,night=new Map(),chargedMinutes=0;
    for(let offset=0;offset<duration-1e-9;offset+=1){
      const slice=Math.min(1,duration-offset),at=new Date(start.getTime()+(offset+slice/2)*60000);
      const matched=matchingRuleDetailed(pricing,at,timeZone,session);
      if(matched.unknown||!matched.rule)return{complete:false,reason:matched.reason||'after_minutes_time_rule_missing',offerId:offer?.id};
      const rule=matched.rule;
      if(rule.afterMinutesRate==null||Number(rule.afterMinutesRate)===0)continue;
      const rate=num(rule.afterMinutesRate),threshold=num(rule.afterMinutesThreshold);
      if(rate==null||rate<0||threshold==null||threshold<0)
        return{complete:false,reason:'after_minutes_bad_rate_or_threshold',offerId:offer?.id};
      const ruleCurrency=String(rule.currency||offer.currency||'EUR').toUpperCase();
      if(ruleCurrency!==String(offer.currency||'EUR').toUpperCase())
        return{complete:false,reason:'after_minutes_mixed_currency',offerId:offer?.id};
      const billable=Math.max(0,offset+slice-Math.max(offset,threshold));
      if(!billable)continue;
      const amount=billable*rate;chargedMinutes+=billable;
      const cap=num(rule.afterMinutesCap);
      if(cap!=null&&cap<0)return{complete:false,reason:'after_minutes_invalid_cap',offerId:offer?.id};
      if(cap==null||cap===0){regular+=amount;continue;}
      const capStart=rule.afterMinutesCapStart||'00:00',capEnd=rule.afterMinutesCapEnd||'24:00';
      if((capStart==='00:00'&&capEnd==='24:00')||capStart===capEnd){
        if(cappedLimit!=null&&Math.abs(cappedLimit-cap)>1e-9)
          return{complete:false,reason:'after_minutes_multiple_all_day_caps',offerId:offer?.id};
        cappedLimit=cap;capped+=amount;continue;
      }
      // SIGEIF 7-22kW official charging guide 2025-10:
      // the 4 EUR cap applies ONLY to 20:00-08:00 parking supplements.
      if(offer?.id!=='sigeif-7-22'||cap!==4||capStart!=='20:00'||capEnd!=='08:00'||
        rate!==0.05||threshold!==180)return{
          complete:false,reason:'after_minutes_unverified_time_cap',offerId:offer?.id};
      const minute=minuteOfDay(at,timeZone);
      if(minute==null)return{complete:false,reason:'after_minutes_missing_local_clock',offerId:offer?.id};
      if(minute>=1200||minute<480){
        const key=scopedNightGroup(at,timeZone,minute);
        if(!key)return{complete:false,reason:'after_minutes_missing_local_date',offerId:offer?.id};
        night.set(key,(night.get(key)||0)+amount);
      }else regular+=amount;
    }
    const nightTotal=[...night.values()].reduce((a,v)=>a+Math.min(v,4),0);
    const extra=money(regular+(cappedLimit==null?capped:Math.min(capped,cappedLimit))+nightTotal);
    return{...base,totalEur:money(base.totalEur+extra),
      components:{...base.components,afterMinutes:{
        costEur:extra,chargedMinutes:money(chargedMinutes),
        dayAndUncappedCost:money(regular),nightCapCost:money(nightTotal),
        source:'actual_source_afterMinutes_rate_threshold_and_official_SIGEIF_cap'
      }}};
  }
  function teslaPowerRate(rule,power){
    const rows=Array.isArray(rule.powerBands)?rule.powerBands:[];
    const max=Math.max(...rows.map(row=>Number(row.maxKw)));
    const valid=rows.filter(row=>{
      const lo=num(row.minKw),hi=num(row.maxKw);
      return lo!=null&&hi!=null&&power>=lo&&(power<hi||(power===max&&hi===max));
    });
    if(valid.length!==1)return null;
    const rate=num(valid[0].ratePerMinute);
    return rate!=null&&rate>=0?rate:null;
  }
  function teslaPowerAt(session,minute){
    const segments=Array.isArray(session.powerSegments)?session.powerSegments:null;
    const timeline=Array.isArray(session.chargeTimeline)?session.chargeTimeline:null;
    const source=segments||timeline;
    if(!source||!source.length)return null;
    const matches=source.filter(row=>{
      const start=num(row.startMin??row.offsetMinutes);
      const end=num(row.endMin)??(start!=null&&num(row.durationMinutes)!=null?start+Number(row.durationMinutes):null);
      return start!=null&&end!=null&&minute>=start&&minute<end;
    });
    if(matches.length!==1)return null;
    const power=num(matches[0].powerKw);
    return power!=null&&power>=0?power:null;
  }
  function evaluateTeslaPowerMinute(offer,session){
    const pricing=offer?.pricing;
    if(pricing?.type!=='rules'||!Array.isArray(pricing.rules))return null;
    const powerRules=pricing.rules.filter(r=>r.billing==='powerMinute');
    if(!powerRules.length)return null;
    if(pricing.rules.some(r=>r.billing!=='powerMinute'))
      return{complete:false,reason:'tesla_mixed_power_minute_billing_modes',offerId:offer?.id};
    const timeZone=session.timeZone||offer?.metadata?.timeZone;
    const duration=num(session.chargingMinutes),start=new Date(session.startAt||'');
    if(duration==null||duration<0||duration>10080||Number.isNaN(start.getTime())||!timeZone)
      return{complete:false,reason:'tesla_power_minute_missing_duration_start_or_timezone',offerId:offer?.id};
    if(duration>0&&!((Array.isArray(session.powerSegments)&&session.powerSegments.length)||
       (Array.isArray(session.chargeTimeline)&&session.chargeTimeline.length)))
      return{complete:false,reason:'tesla_power_curve_required',offerId:offer?.id};
    const zero=pricing.rules.map(rule=>{
      // powerMinute tariffs explicitly bill from delivered power only.
      // Never also bill chargePerMinute or pricePerMinute for the same minute.
      const r={...rule};
      delete r.pricePerMinute;delete r.chargePerMinute;delete r.chargingTimePerMinuteEur;
      delete r.connectedTimePerMinuteEur;
      return r;
    });
    const base=evaluateOfferBase({...offer,pricing:{...pricing,rules:zero}},session);
    if(!base.complete)return base;
    let total=0;
    for(let atMin=0;atMin<duration-1e-9;atMin+=1){
      const slice=Math.min(1,duration-atMin),mid=atMin+slice/2;
      const actualKw=teslaPowerAt(session,mid);
      if(actualKw==null)return{complete:false,reason:'tesla_power_curve_gap_or_overlap',offerId:offer?.id};
      const at=new Date(start.getTime()+mid*60000);
      const match=matchingRuleDetailed(pricing,at,timeZone,session);
      if(match.unknown||!match.rule||match.rule.billing!=='powerMinute')
        return{complete:false,reason:match.reason||'tesla_power_minute_tariff_missing',offerId:offer?.id};
      const rate=teslaPowerRate(match.rule,actualKw);
      if(rate==null)return{complete:false,reason:'tesla_delivered_kw_outside_bands',offerId:offer?.id};
      total+=rate*slice;
    }
    const additional=money(total);
    return{...base,totalEur:money(base.totalEur+additional),
      currency:offer.currency||base.currency,
      components:{...base.components,teslaDynamicPowerMinute:{
        costNative:additional,chargingMinutes:duration,
        source:'time_segmented_delivered_power_profile',approximation:!!session.chargeTimeline
      }}};
  }
  function evaluateOffer(offer,session={}){
    const pricing=offer?.pricing||{};
    const tesla=String(offer?.provider||'').toLowerCase()==='tesla';
    if(tesla&&Array.isArray(pricing.rules)){
      for(const r of pricing.rules){
        if(r.billing==='minute'&&num(r.chargePerMinute)!=null&&num(r.pricePerMinute)!=null){
          // Two fields may describe two different kinds of fees. If provenance
          // cannot prove independent fees, never charge both automatically.
          if(num(r.chargePerMinute)!==num(r.pricePerMinute))
            return{complete:false,reason:'tesla_minute_fee_source_ambiguous',offerId:offer?.id};
          // The adapter must remove duplicate fields, not the calculator.
          return{complete:false,reason:'tesla_minute_duplicate_source_fields',offerId:offer?.id};
        }
      }
      const dynamic=evaluateTeslaPowerMinute(offer,session);
      if(dynamic)return applyAfterMinutes(dynamic,offer,session);
    }
    return applyAfterMinutes(evaluateOfferBase(offer,session),offer,session);
  }
