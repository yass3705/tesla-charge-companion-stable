(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(require('./offer-engine.js'),require('./pricing-engine.js'));
  }else{
    root.TCCV9SessionEngine=factory(root.TCCV9OfferEngine,root.TCCV9PricingEngine);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(OfferEngine,PricingEngine){
  'use strict';

  if(!OfferEngine)throw new Error('TCC V9 offer engine is required');
  if(!PricingEngine)throw new Error('TCC V9 pricing engine is required');

  const text=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const money=v=>Math.round((Number(v)+Number.EPSILON)*1000000)/1000000;
  const addMinutes=(value,minutes)=>{const d=value instanceof Date?new Date(value.getTime()):new Date(value);if(Number.isNaN(d.getTime()))return null;return new Date(d.getTime()+Number(minutes||0)*60000);};

  function fxRate(currency,targetCurrency,fxRates={}){
    const from=text(currency||targetCurrency||'EUR').toUpperCase(),to=text(targetCurrency||from).toUpperCase();
    if(from===to)return 1;
    const direct=num(fxRates[`${from}_${to}`]??fxRates[`${from}/${to}`]);if(direct!=null&&direct>0)return direct;
    const inverse=num(fxRates[`${to}_${from}`]??fxRates[`${to}/${from}`]);if(inverse!=null&&inverse>0)return 1/inverse;
    const fromEur=num(fxRates[from]),toEur=num(fxRates[to]);
    if(fromEur!=null&&fromEur>0&&toEur!=null&&toEur>0)return toEur/fromEur;
    return null;
  }

  function recoveredKm(session={}){
    const explicit=num(session.recoveredKm);if(explicit!=null&&explicit>0)return explicit;
    const energy=num(session.energyKwh),consumption=num(session.consumptionKwhPer100Km);
    if(energy==null||energy<=0||consumption==null||consumption<=0)return null;
    return energy/(consumption/100);
  }

  function stationSession(station,session={},options={}){
    const id=text(station?.id||station?.canonicalId||station?.stationId);
    const approach=num(options.approachEnergyKwhByStationId?.[id]??session.approachEnergyKwhByStationId?.[id]??station?.route?.approachEnergyKwh)??0;
    const requested=num(session.energyKwh)??0;
    const include=session.includeRouteEnergyInCharge!==false;
    return{...session,requestedEnergyKwh:requested,approachEnergyKwh:approach,energyKwh:money(Math.max(0,requested+(include?approach:0)))};
  }

  function evaluateSessionStartLockedOffer(offer,session={}){
    const pricing=offer?.pricing||{},timeZone=session.timeZone||offer?.metadata?.timeZone||null;
    if(pricing.type!=='rules'||pricing.priceSelectionBasis!=='session_start_local_time')return null;
    const rule=PricingEngine.matchingRule(pricing,session.startAt,timeZone);
    if(!rule)return{complete:false,reason:'no_matching_time_rule',offerId:text(offer?.id||offer?.offerId),timeZone};
    const base=PricingEngine.evaluateRule(rule,session);
    const finalized=PricingEngine.applyMinimumTotal(pricing,base.totalEur,base.components);
    return{
      complete:true,totalEur:finalized.totalEur,components:finalized.components,
      offerId:text(offer?.id||offer?.offerId),currency:offer?.currency||'EUR',matchedRule:rule,
      segmented:false,timeZone,priceSelectionBasis:'session_start_local_time'
    };
  }

  function timelineEnergy(pricing,session,timeZone){
    const rows=Array.isArray(session.chargeTimeline)?session.chargeTimeline:[];
    if(!rows.length||!session.startAt)return null;
    let total=0;const segments=[];
    for(const step of rows){
      const offset=Math.max(0,num(step.offsetMinutes)??0),duration=Math.max(0,num(step.durationMinutes)??0),energy=Math.max(0,num(step.energyKwh)??0);
      if(duration<=1e-9||energy<=0)continue;
      let used=0;
      while(used<duration-1e-9){
        const at=addMinutes(session.startAt,offset+used);if(!at)return{complete:false,reason:'invalid_charge_timeline_start'};
        const rule=PricingEngine.matchingRule(pricing,at,timeZone);if(!rule)return{complete:false,reason:'no_matching_time_rule',segmentStartAt:at.toISOString()};
        if(!PricingEngine.segmentableRule(rule))return{complete:false,reason:'tariff_window_crossing_unsupported_components',segmentStartAt:at.toISOString(),matchedRule:rule};
        let boundary=PricingEngine.minutesUntilRuleBoundary(rule,at,timeZone);if(boundary==null)return{complete:false,reason:'unresolved_tariff_boundary'};
        if(!Number.isFinite(boundary))boundary=duration-used;
        const slice=Math.min(duration-used,Math.max(boundary,1e-6)),sliceEnergy=energy*(slice/duration),rate=num(rule.pricePerKwh),cost=rate==null?0:sliceEnergy*rate;
        total+=cost;
        segments.push({startAt:at.toISOString(),durationMinutes:money(slice),energyKwh:money(sliceEnergy),pricePerKwh:rate,costEur:money(cost),startSoc:num(step.startSoc),endSoc:num(step.endSoc),powerKw:num(step.powerKw),rule});
        used+=slice;
        if(segments.length>4096)return{complete:false,reason:'charge_timeline_segmentation_guard'};
      }
    }
    return{complete:true,totalEur:money(total),segments};
  }

  function evaluateTimelineOffer(offer,session={}){
    const pricing=offer?.pricing||{},timeZone=session.timeZone||offer?.metadata?.timeZone||null;
    if(pricing.type!=='rules'||pricing.priceSelectionBasis==='session_start_local_time'||!Array.isArray(session.chargeTimeline)||!session.chargeTimeline.length||!session.startAt)return null;
    const rule=PricingEngine.matchingRule(pricing,session.startAt,timeZone);if(!rule)return null;
    const duration=Math.max(0,num(session.durationMinutes)??0),boundary=PricingEngine.minutesUntilRuleBoundary(rule,session.startAt,timeZone);
    if(boundary==null||!Number.isFinite(boundary)||duration<=boundary+1e-9)return null;
    const threshold=num(pricing.longConnectionFee?.thresholdMinutes);if(threshold!=null&&duration>threshold)return null;
    const timeBase=PricingEngine.evaluateSegmentedRules(pricing,{...session,energyKwh:0},timeZone);if(timeBase.complete===false)return{...timeBase,offerId:text(offer?.id||offer?.offerId),timeZone};
    const energyBase=timelineEnergy(pricing,session,timeZone);if(!energyBase||energyBase.complete===false)return energyBase?{...energyBase,offerId:text(offer?.id||offer?.offerId),timeZone}:null;
    const conditional=PricingEngine.evaluateConditionalSessionFees(pricing.conditionalSessionFees,session);if(conditional.complete===false)return{complete:false,reason:conditional.reason,offerId:text(offer?.id||offer?.offerId),timeZone};
    const post=PricingEngine.evaluatePostChargeFee(pricing.postChargeFee,session,timeZone);if(post.complete===false)return{complete:false,reason:post.reason,offerId:text(offer?.id||offer?.offerId),timeZone};
    const total=timeBase.totalEur+energyBase.totalEur+conditional.totalEur+post.totalEur;
    const components={...timeBase.components,energyTimeline:{segments:energyBase.segments,costEur:energyBase.totalEur},...(conditional.component?{conditionalSessionFees:conditional.component}:{}),...(post.component?{postCharge:post.component}:{})};
    const finalized=PricingEngine.applyMinimumTotal(pricing,total,components);
    return{complete:true,totalEur:finalized.totalEur,components:finalized.components,offerId:text(offer?.id||offer?.offerId),currency:offer?.currency||'EUR',matchedRule:rule,segmented:true,energyTimelineApplied:true,timeZone};
  }

  function evaluateStation(station,session={},options={}){
    const selectedSubscriptions=options.selectedSubscriptions||session.selectedSubscriptions||[];
    const offers=OfferEngine.eligibleOffers(station,selectedSubscriptions,{countryCode:station?.countryCode});
    const targetCurrency=text(options.targetCurrency||session.targetCurrency||'EUR').toUpperCase();
    const fxRates=options.fxRates||session.fxRates||{};
    const effectiveSession=stationSession(station,session,options),km=recoveredKm(session),evaluations=[];

    for(const offer of offers){
      const postChargeMinutes=Math.max(0,num(effectiveSession.postChargeMinutes)??0);
      const unknownPostCharge=offer?.pricing?.postChargeFeeUnknown===true||offer?.metadata?.postChargeFeeUnknown===true;
      const locked=evaluateSessionStartLockedOffer(offer,effectiveSession);
      const timeline=locked?null:evaluateTimelineOffer(offer,effectiveSession);
      const result=unknownPostCharge&&postChargeMinutes>0
        ?{complete:false,reason:'post_charge_fee_unknown_for_station',offerId:text(offer.id||offer.offerId),postChargeMinutes}
        :(locked||timeline||PricingEngine.evaluateOffer(offer,effectiveSession));
      const currency=text(result.currency||offer.currency||'EUR').toUpperCase();
      const rate=result.complete?fxRate(currency,targetCurrency,fxRates):null;
      const comparable=result.complete&&rate!=null;
      const normalizedTotal=comparable?money(result.totalEur*rate):null;
      evaluations.push({
        offerId:text(offer.id||offer.offerId),provider:text(offer.provider),kind:text(offer.kind),subscriptionId:text(offer.subscriptionId),selectionId:text(offer.selectionId)||null,
        priority:num(offer.priority)??0,currency,result,comparable,targetCurrency,
        total:normalizedTotal,costPerRecoveredKm:normalizedTotal!=null&&km?money(normalizedTotal/km):null
      });
    }

    const comparable=evaluations.filter(x=>x.comparable).sort((a,b)=>{
      if(a.total!==b.total)return a.total-b.total;
      if(a.priority!==b.priority)return b.priority-a.priority;
      return `${a.provider}|${a.offerId}`.localeCompare(`${b.provider}|${b.offerId}`);
    });
    const best=comparable[0]||null;
    return{
      stationId:text(station?.id||station?.canonicalId||station?.stationId),
      eligibleOfferCount:offers.length,comparableOfferCount:comparable.length,targetCurrency,recoveredKm:km,
      requestedEnergyKwh:effectiveSession.requestedEnergyKwh,approachEnergyKwh:effectiveSession.approachEnergyKwh,billedEnergyKwh:effectiveSession.energyKwh,
      best,
      alternatives:comparable.slice(1),
      incomplete:evaluations.filter(x=>!x.comparable)
    };
  }

  function evaluateArea(stations,session={},options={}){
    const rows=(stations||[]).map(station=>({station,evaluation:evaluateStation(station,session,options)}));
    const sortBy=options.sortBy||'total';
    rows.sort((a,b)=>{
      const av=sortBy==='costPerRecoveredKm'?a.evaluation.best?.costPerRecoveredKm:a.evaluation.best?.total;
      const bv=sortBy==='costPerRecoveredKm'?b.evaluation.best?.costPerRecoveredKm:b.evaluation.best?.total;
      if(av==null&&bv==null)return 0;if(av==null)return 1;if(bv==null)return-1;if(av!==bv)return av-bv;
      return a.evaluation.stationId.localeCompare(b.evaluation.stationId);
    });
    return rows;
  }

  return{evaluateStation,evaluateArea,recoveredKm,fxRate,stationSession,evaluateSessionStartLockedOffer,evaluateTimelineOffer,timelineEnergy};
});