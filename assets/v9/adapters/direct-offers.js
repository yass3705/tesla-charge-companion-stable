(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.directOffers=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();

  function directRule(raw,country){
    return{
      id:text(raw.id),provider:text(raw.provider),offerKind:'direct',subscriptionId:null,
      operatorAliases:Array.isArray(raw.operatorAliases)?raw.operatorAliases:[],connectorKinds:raw.kind?[text(raw.kind).toUpperCase()]:[],countries:[country],currency:text(raw.currency||'EUR').toUpperCase(),
      pricing:{type:'kwh',pricePerKwh:Number(raw.pricePerKwh||0)},priority:95,
      metadata:{source:raw.source||null,note:raw.note||null,monthlyFeeEur:null}
    };
  }
  function subscriptionRule(raw,country){
    return{
      id:text(raw.selectionId||raw.id),provider:text(raw.provider),offerKind:'subscription',subscriptionId:text(raw.selectionId||raw.id),
      operatorAliases:Array.isArray(raw.operatorAliases)?raw.operatorAliases:[],connectorKinds:raw.kind?[text(raw.kind).toUpperCase()]:[],countries:[country],currency:text(raw.currency||'EUR').toUpperCase(),
      pricing:{type:'kwh',pricePerKwh:Number(raw.pricePerKwh||0)},priority:100,
      metadata:{source:raw.source||null,note:raw.note||null,monthlyFeeEur:raw.monthlyFeeEur??null,monthlyFeeLabel:raw.monthlyFeeLabel||null,promotionEnd:raw.monthlyFeePromotionEnd||null}
    };
  }
  function normalizePayload(payload){
    const country=text(payload?.country).toUpperCase();if(!country)throw new Error('direct offer payload country missing');
    return{offerRules:[...(payload?.directOffers||[]).map(x=>directRule(x,country)),...(payload?.subscriptionOffers||[]).map(x=>subscriptionRule(x,country))],metadata:{schemaVersion:payload?.schemaVersion||1,country,generatedAt:payload?.generatedAt||null,policy:payload?.policy||{}}};
  }
  function createLoader({url,fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for direct offer adapter');let promise=null;
    return async function(){if(!promise)promise=f(url,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`direct offers unavailable (${r.status})`);return r.json();}).then(normalizePayload).catch(e=>{promise=null;throw e;});return promise;};
  }
  return{directRule,subscriptionRule,normalizePayload,createLoader};
});
