(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9CrossBorderSubscriptions=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const cc=v=>text(v).toUpperCase();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const norm=v=>text(typeof v==='object'?(v?.id||v?.name):v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  function operatorId(v){const n=norm(v);if(n.includes('fastned'))return'fastned';if(n.includes('ionity'))return'ionity';if(n.includes('enbw'))return'enbw';return n||'unknown';}
  function policyMap(config){return new Map((config?.policy?.subscriptions||[]).map(s=>[text(s.id),s]));}
  function unavailable(id,country,reason){return{subscriptionId:id,country,status:'unavailable',rankable:false,usedFallback:false,reason};}
  function exact(id,country,price,currency,semantics,source){return{subscriptionId:id,country,status:'exact',rankable:true,usedFallback:false,pricePerKwh:Number(price),currency:cc(currency),priceSemantics:semantics,source};}
  function resolve({subscriptionId,countryCode,physicalOperator,exactStationPrice=null,exactStationCurrency=null}={},config={}){
    const id=text(subscriptionId),country=cc(countryCode),op=operatorId(physicalOperator),subs=policyMap(config),policy=subs.get(id);
    if(!id||!country)return unavailable(id,country,'subscription and country required');
    if(!policy)return unavailable(id,country,'subscription not active in cross-border policy');
    const coverage=(policy.coverageCountries||[]).map(cc);if(!coverage.includes(country))return unavailable(id,country,'country outside subscription coverage');
    const stationPrice=num(exactStationPrice);
    if(stationPrice!=null){if(!exactStationCurrency)return unavailable(id,country,'exact station currency required with exact station price');return exact(id,country,stationPrice,exactStationCurrency,'station-specific','exact-station-override');}
    if(id==='fastned-gold'){
      if(op!=='fastned')return unavailable(id,country,'Fastned Gold only applies to Fastned physical stations');
      const p=config?.fastned?.prices?.[country];if(!p)return unavailable(id,country,'country absent from Fastned Gold matrix');
      return exact(id,country,p.pricePerKwh,p.currency,'exact-country','fastned-gold-country-prices');
    }
    if(id==='ionity-motion'||id==='ionity-power'){
      if(op!=='ionity')return unavailable(id,country,'IONITY subscription only applies to IONITY physical stations');
      const p=config?.ionity?.subscriptions?.[id]?.[country];if(!p)return unavailable(id,country,'country absent from IONITY matrix');
      return{subscriptionId:id,country,status:'minimum',rankable:false,usedFallback:false,pricePerKwh:Number(p.pricePerKwh),currency:cc(p.currency),priceSemantics:'country-minimum',source:'ionity-monthly-country-prices',reason:'IONITY publishes a country minimum; station price may be higher'};
    }
    if(policy.pricingMode==='station-specific-roaming')return{subscriptionId:id,country,status:'station-specific-required',rankable:false,usedFallback:false,priceSemantics:'station-specific',reason:'exact charging-point roaming price required before ranking'};
    return unavailable(id,country,'no exact cross-border pricing rule');
  }
  function toOffer(resolved,subscription,station){
    if(!resolved||resolved.status==='unavailable')return null;
    const base={id:`cross-border-${resolved.subscriptionId}-${resolved.country}-${station?.id||station?.canonicalId||'station'}`,provider:subscription?.provider||resolved.subscriptionId,kind:'subscription',subscriptionId:resolved.subscriptionId,countries:[resolved.country],operatorIds:station?.physicalOperator?[operatorId(station.physicalOperator)]:[],sourceId:'v9-cross-border-resolver',priority:105,currency:resolved.currency||null,metadata:{crossBorderResolved:true,rankable:resolved.rankable===true,priceSemantics:resolved.priceSemantics||null,usedFallback:false,resolutionStatus:resolved.status,reason:resolved.reason||null}};
    if(resolved.pricePerKwh!=null)base.pricing={pricePerKwh:resolved.pricePerKwh};
    return base;
  }
  function subscriptionOptions(config={}){return(config?.policy?.subscriptions||[]).map(s=>({id:s.id,provider:s.provider||s.id,providerId:operatorId(s.network||s.provider),label:s.provider||s.id,countries:[...(s.coverageCountries||[])].map(cc).sort(),countryCount:(s.coverageCountries||[]).length,globalCoverage:false,operatorIds:s.network?[operatorId(s.network)]:[],sourceIds:['v9-cross-border-policy'],stationCount:0,stationIds:[],pricingMode:s.pricingMode||null}));}
  return{resolve,toOffer,subscriptionOptions,operatorId};
});
