(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.directOffers=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const normOperator=v=>text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const operatorIds=raw=>[...new Set((raw.operatorIds||raw.operatorAliases||[]).map(normOperator).filter(Boolean))];
  const networkIds=raw=>[...new Set((raw.networkIds||raw.networkAliases||[]).map(normOperator).filter(Boolean))];
  const countries=(raw,country)=>[...new Set([...(raw.countries||[]).map(c=>text(c).toUpperCase()),text(country).toUpperCase()].filter(Boolean))];
  const connectorKinds=raw=>[...new Set([...(raw.connectorKinds||[]),...(raw.kind?[raw.kind]:[])].map(v=>text(v).toUpperCase()).filter(Boolean))];
  const ids=(...values)=>[...new Set(values.flat().map(text).filter(Boolean))];

  function pricing(raw){
    if(raw.pricing&&typeof raw.pricing==='object')return clone(raw.pricing);
    if(raw.pricePerKwh!=null)return{type:'kwh',pricePerKwh:Number(raw.pricePerKwh||0)};
    return{type:'unknown'};
  }

  function common(raw,country){
    const physicalOnly=raw.directOperatorOnly===true;
    return{
      id:text(raw.selectionId||raw.id),provider:text(raw.provider),
      operatorIds:operatorIds(raw),operatorAliases:Array.isArray(raw.operatorAliases)?clone(raw.operatorAliases):[],
      networkIds:physicalOnly?[]:networkIds(raw),networkAliases:physicalOnly?[]:(Array.isArray(raw.networkAliases)?clone(raw.networkAliases):[]),
      stationIds:ids(raw.stationIds||[],raw.stationId,raw.sourceStationId),
      evseIds:ids(raw.evseIds||[],raw.evseId,raw.idPdcItinerance,raw.id_pdc_itinerance),
      connectorKinds:connectorKinds(raw),countries:countries(raw,country),
      currency:text(raw.currency||raw.pricing?.currency||'EUR').toUpperCase(),pricing:pricing(raw),
      minPowerKw:raw.minPowerKw==null?undefined:raw.minPowerKw,maxPowerKw:raw.maxPowerKw==null?undefined:raw.maxPowerKw,
      directOperatorOnly:physicalOnly,priority:Number(raw.priority??95),sourceId:text(raw.sourceId||raw.source)||'direct-offers',
      metadata:{source:raw.source||null,note:raw.note||null,monthlyFeeEur:raw.monthlyFeeEur??null,monthlyFeeLabel:raw.monthlyFeeLabel||null,promotionEnd:raw.monthlyFeePromotionEnd||null,defaultSelected:raw.defaultSelected===true,runtime:raw.runtime||null,customerProfile:raw.customerProfile||null,parkingPolicy:clone(raw.parkingPolicy)||null,verifiedScope:raw.verifiedScope||null}
    };
  }

  function directRule(raw,country){return{...common(raw,country),kind:'direct',offerKind:'direct',subscriptionId:null};}
  function subscriptionRule(raw,country){return{...common(raw,country),kind:'subscription',offerKind:'subscription',subscriptionId:text(raw.selectionId||raw.id),priority:Number(raw.priority??100)};}
  function normalizePayload(payload){
    const country=text(payload?.country).toUpperCase();if(!country)throw new Error('direct offer payload country missing');
    const direct=payload?.directOffers||payload?.operatorOffers||[],subscriptions=payload?.subscriptionOffers||payload?.subscriptions||[];
    return{offerRules:[...direct.map(x=>directRule(x,country)),...subscriptions.map(x=>subscriptionRule(x,country))],metadata:{schemaVersion:payload?.schemaVersion||1,country,generatedAt:payload?.generatedAt||null,policy:payload?.policy||{},mode:payload?.mode||null}};
  }
  function createLoader({url,fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for direct offer adapter');let promise=null;
    return async function(){if(!promise)promise=f(url,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`direct offers unavailable (${r.status})`);return r.json();}).then(normalizePayload).catch(e=>{promise=null;throw e;});return promise;};
  }
  return{directRule,subscriptionRule,normalizePayload,createLoader};
});