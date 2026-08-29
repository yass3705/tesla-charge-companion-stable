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

  function evaluateStation(station,session={},options={}){
    const selectedSubscriptions=options.selectedSubscriptions||session.selectedSubscriptions||[];
    const offers=OfferEngine.eligibleOffers(station,selectedSubscriptions,{countryCode:station?.countryCode});
    const targetCurrency=text(options.targetCurrency||session.targetCurrency||'EUR').toUpperCase();
    const fxRates=options.fxRates||session.fxRates||{};
    const km=recoveredKm(session),evaluations=[];

    for(const offer of offers){
      const result=PricingEngine.evaluateOffer(offer,session),currency=text(result.currency||offer.currency||'EUR').toUpperCase();
      const rate=result.complete?fxRate(currency,targetCurrency,fxRates):null;
      const comparable=result.complete&&rate!=null;
      const normalizedTotal=comparable?money(result.totalEur*rate):null;
      evaluations.push({
        offerId:text(offer.id||offer.offerId),provider:text(offer.provider),kind:text(offer.kind),subscriptionId:text(offer.subscriptionId)||null,
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

  return{evaluateStation,evaluateArea,recoveredKm,fxRate};
});