(function(){
  'use strict';
  const STORAGE_KEY='tccSubscriptionsV1';
  let selected=new Set();
  let recomputeHook=null;

  function readSelected(){
    try{return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'));}
    catch(_){return new Set();}
  }

  function setSelected(ids,{emit=true}={}){
    selected=new Set((ids||[]).filter(Boolean));
    if(emit)window.dispatchEvent(new CustomEvent('tcc:v9-offers-invalidated',{detail:{reason:'subscriptions',subscriptionIds:[...selected]}}));
    if(typeof recomputeHook==='function'){
      try{recomputeHook({subscriptionIds:[...selected],reason:'subscriptions'});}catch(err){console.warn('[TCC V9 subscription bridge] recompute failed',err);}
    }
    return selected;
  }

  function getSelected(){return new Set(selected);}
  function isSelected(id){return !id||selected.has(id);}

  function offerIsEligible(offer){
    if(!offer||typeof offer!=='object')return false;
    const id=offer.subscriptionId||offer.selectionId;
    if(!id)return true;
    return selected.has(id);
  }

  function filterOffers(offers){return (Array.isArray(offers)?offers:[]).filter(offerIsEligible);}

  function splitOffers(payload){
    const direct=Array.isArray(payload?.directOffers)?payload.directOffers:[];
    const subs=Array.isArray(payload?.subscriptionOffers)?payload.subscriptionOffers:[];
    return {directOffers:direct,subscriptionOffers:subs.filter(offerIsEligible)};
  }

  function registerRecompute(fn){recomputeHook=typeof fn==='function'?fn:null;return api;}

  function applyToEngine(engine){
    if(!engine||typeof engine!=='object')return false;
    if(typeof engine.setSelectedSubscriptions==='function')engine.setSelectedSubscriptions([...selected]);
    if(typeof engine.invalidateOffers==='function')engine.invalidateOffers({reason:'subscriptions'});
    if(typeof engine.recompute==='function')engine.recompute();
    return true;
  }

  function onChanged(ev){
    const ids=Array.isArray(ev?.detail?.subscriptionIds)?ev.detail.subscriptionIds:[...readSelected()];
    setSelected(ids);
    applyToEngine(window.TCCV9OfferEngine);
  }

  const api={readSelected,setSelected,getSelected,isSelected,offerIsEligible,filterOffers,splitOffers,registerRecompute,applyToEngine};
  window.TCCV9SubscriptionBridge=api;
  selected=readSelected();
  window.addEventListener('tcc:subscriptions-changed',onChanged);
  window.addEventListener('tcc:v9-engine-ready',()=>applyToEngine(window.TCCV9OfferEngine));
  window.dispatchEvent(new CustomEvent('tcc:v9-subscriptions-ready',{detail:{subscriptionIds:[...selected]}}));
})();
