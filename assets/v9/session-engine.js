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

  function connectorKind(connector={}){
    const raw=text(connector.kind||connector.currentType||connector.powerType).toUpperCase();
    if(raw.includes('DC')||raw.includes('CCS')||raw.includes('CHADEMO'))return'DC';
    if(raw.includes('AC')||raw.includes('TYPE2')||raw.includes('TYPE 2'))return'AC';
    const power=num(connector.powerKw);return power!=null&&power>22?'DC':'AC';
  }
  function stationChargingKind(station){
    let selected=null;
    for(const evse of station?.evses||[])for(const connector of evse?.connectors||[]){
      const power=num(connector?.powerKw);if(power==null||power<=0)continue;
      if(!selected||power>selected.powerKw)selected={powerKw:power,kind:connectorKind(connector)};
    }
    if(selected)return selected.kind;
    for(const evse of station?.evses||[])for(const connector of evse?.connectors||[])return connectorKind(connector);
    return null;
  }
  function offerMatchesChargingKind(offer,chargingKind){
    const allowed=Array.isArray(offer?.connectorKinds)?offer.connectorKinds.map(v=>text(v).toUpperCase()).filter(Boolean):[];
    return !chargingKind||!allowed.length||allowed.includes(chargingKind);
  }

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

  function evaluateStation(station,session={},options={}){
    const selectedSubscriptions=options.selectedSubscriptions||session.selectedSubscriptions||[];
    const chargingKind=stationChargingKind(station);
    const offers=OfferEngine.eligibleOffers(station,selectedSubscriptions,{countryCode:station?.countryCode}).filter(offer=>offerMatchesChargingKind(offer,chargingKind));
    const targetCurrency=text(options.targetCurrency||session.targetCurrency||'EUR').toUpperCase();
    const fxRates=options.fxRates||session.fxRates||{};
    const effectiveSession=stationSession(station,session,options),km=recoveredKm(session),evaluations=[];

    for(const offer of offers){
      const postChargeMinutes=Math.max(0,num(effectiveSession.postChargeMinutes)??0);
      const unknownPostCharge=offer?.pricing?.postChargeFeeUnknown===true||offer?.metadata?.postChargeFeeUnknown===true;
      const result=unknownPostCharge&&postChargeMinutes>0
        ?{complete:false,reason:'post_charge_fee_unknown_for_station',offerId:text(offer.id||offer.offerId),postChargeMinutes}
        :PricingEngine.evaluateOffer(offer,effectiveSession);
      const currency=text(result.currency||offer.currency||'EUR').toUpperCase();
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
      stationId:text(station?.id||station?.canonicalId||station?.stationId),chargingKind,
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

  return{evaluateStation,evaluateArea,recoveredKm,fxRate,stationSession,stationChargingKind,offerMatchesChargingKind,connectorKind};
});
