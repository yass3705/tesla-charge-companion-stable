// Tesla Charge Companion V8 RC4.8 — compatibilité abonnements après consolidation UI.
// L'UI est désormais gérée uniquement par v8-compare-subscriptions.js.
(function(){
  'use strict';
  const REVISION='rc48bs-subscription-compat';
  const KEY='tccSubscriptionsV1';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  function selectedSet(){
    try{const state=JSON.parse(localStorage.getItem(KEY)||'{}');return new Set(Array.isArray(state?.selected)?state.selected:[])}catch(e){return new Set()}
  }
  function inferSubscriptionId(st){
    const api=window.TCCV8Subscriptions;
    if(typeof api?.subscriptionIdForStation==='function'){
      try{const id=api.subscriptionIdForStation(st);if(id)return id}catch(e){}
    }
    const explicit=text(st?.subscriptionId||st?.subscriptionSelectionId);if(explicit)return explicit;
    const provider=norm(st?.configurationLabel||st?.label||st?.offerProvider||'');
    if(provider.includes('belib direct abonne non resident'))return'belib-nonresident';
    if(provider.includes('belib direct abonne resident'))return'belib-resident';
    if(provider.includes('la borne bleue direct abonne')||provider.includes('la borne bleue abonne'))return'labornebleue-annual';
    return'';
  }
  function eligible(st){
    const api=window.TCCV8Subscriptions;
    if(typeof api?.isStationEligible==='function'){
      try{return api.isStationEligible(st,selectedSet())}catch(e){}
    }
    const id=inferSubscriptionId(st);return !id||selectedSet().has(id);
  }
  function render(force=false){return window.TCCV8CompareSubscriptions?.render?.(force)??false}
  function stabilizeLegacyApis(){
    const resolver=window.TCCV8DirectResolver;
    if(resolver&&!resolver.__tccCompactSubscriptionBridge){
      resolver.renderSubscriptionDropdown=function(force=false){render(force);return true};
      resolver.__tccCompactSubscriptionBridge=true;
    }
    return true;
  }
  function installExpansionGuard(){return true}
  function boot(){stabilizeLegacyApis();render(false)}

  document.addEventListener('tcc:compare-subscriptions-ready',boot);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else queueMicrotask(boot);

  window.TCCV8SubscriptionStability={revision:REVISION,render,eligible,inferSubscriptionId,selectedSet,installExpansionGuard,stabilizeLegacyApis,subscriptionHost:()=>window.TCCV8CompareSubscriptions?.host?.()||null,placeBox:()=>true};
  console.info('[TCC V8] rc48bs : ancien stabilisateur abonnements réduit à un pont de compatibilité.');
})();
