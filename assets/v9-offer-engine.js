(function(global){
  'use strict';

  const state={selectedSubscriptions:new Set(),offerPayloads:[],lastResult:null};
  const norm=v=>String(v==null?'':v).trim().toLowerCase();
  const arr=v=>Array.isArray(v)?v:[];

  function aliases(offer){return [...arr(offer.operatorAliases),...arr(offer.networkAliases)].map(norm).filter(Boolean);}
  function stationAliases(station){return [station?.operator,station?.network,station?.operatorName,station?.networkName,...arr(station?.operatorAliases),...arr(station?.networkAliases)].map(norm).filter(Boolean);}
  function countryMatches(offer,station){const cs=arr(offer.countries).map(x=>String(x).toUpperCase());return !cs.length||cs.includes('*')||cs.includes(String(station?.country||'').toUpperCase());}
  function networkMatches(offer,station){const oa=aliases(offer);if(!oa.length)return true;const sa=stationAliases(station);return oa.some(a=>sa.some(s=>s===a||s.includes(a)||a.includes(s)));}
  function connectorMatches(offer,station){const kinds=arr(offer.connectorKinds).map(x=>String(x).toUpperCase()).filter(Boolean);if(!kinds.length)return true;const sk=String(station?.kind||station?.connectorKind||'').toUpperCase();return !sk||kinds.includes(sk);}
  function powerMatches(offer,station){const p=Number(station?.powerKw);if(!Number.isFinite(p))return true;if(offer.minPowerKw!=null&&p<Number(offer.minPowerKw))return false;if(offer.maxPowerKw!=null&&p>Number(offer.maxPowerKw))return false;return true;}
  function subscriptionMatches(offer){const id=offer?.subscriptionId||offer?.selectionId;if(!id)return true;return state.selectedSubscriptions.has(id);}

  function offerApplies(offer,station){return !!offer&&countryMatches(offer,station)&&networkMatches(offer,station)&&connectorMatches(offer,station)&&powerMatches(offer,station)&&subscriptionMatches(offer);}

  function materializedPrice(offer){
    if(Number.isFinite(Number(offer?.pricePerKwh)))return {pricePerKwh:Number(offer.pricePerKwh),currency:offer.currency||'EUR'};
    const rules=arr(offer?.pricing?.rules);
    const rule=rules.find(r=>String(r?.billing||'').toLowerCase()==='kwh'&&Number.isFinite(Number(r?.pricePerKwh)));
    return rule?{pricePerKwh:Number(rule.pricePerKwh),currency:rule.currency||offer.currency||'EUR',rule}:null;
  }

  function flatten(payloads=state.offerPayloads){
    const all=[];
    arr(payloads).forEach(payload=>{
      arr(payload?.directOffers).forEach(o=>all.push({...o,_offerType:'direct'}));
      arr(payload?.subscriptionOffers).forEach(o=>all.push({...o,_offerType:'subscription'}));
    });
    return all;
  }

  function candidatesForStation(station,payloads=state.offerPayloads){
    return flatten(payloads).filter(o=>offerApplies(o,station)).map(o=>({offer:o,price:materializedPrice(o)})).filter(x=>x.price);
  }

  function chooseBestOffer(station,payloads=state.offerPayloads){
    const candidates=candidatesForStation(station,payloads);
    candidates.sort((a,b)=>a.price.pricePerKwh-b.price.pricePerKwh||(Number(b.offer.priority)||0)-(Number(a.offer.priority)||0)||String(a.offer.id||'').localeCompare(String(b.offer.id||'')));
    const best=candidates[0]||null;
    const result={station,bestOffer:best?.offer||null,price:best?.price||null,candidates:candidates.map(x=>({id:x.offer.id,subscriptionId:x.offer.subscriptionId||null,selectionId:x.offer.selectionId||null,offerType:x.offer._offerType,pricePerKwh:x.price.pricePerKwh,currency:x.price.currency,priority:x.offer.priority||0}))};
    state.lastResult=result;return result;
  }

  function setSelectedSubscriptions(ids){state.selectedSubscriptions=new Set(arr(ids).filter(Boolean));return api;}
  function setOfferPayloads(payloads){state.offerPayloads=arr(payloads);return api;}
  function invalidateOffers(){state.lastResult=null;return api;}
  function recompute(station,payloads){if(station)return chooseBestOffer(station,payloads);return state.lastResult;}
  function getState(){return {selectedSubscriptions:[...state.selectedSubscriptions],payloadCount:state.offerPayloads.length,lastResult:state.lastResult};}

  const api={setSelectedSubscriptions,setOfferPayloads,invalidateOffers,recompute,getState,offerApplies,candidatesForStation,chooseBestOffer,materializedPrice};
  global.TCCV9OfferEngine=api;
  if(global.TCCV9SubscriptionBridge?.applyToEngine)global.TCCV9SubscriptionBridge.applyToEngine(api);
  if(typeof global.dispatchEvent==='function'&&typeof global.CustomEvent==='function')global.dispatchEvent(new global.CustomEvent('tcc:v9-engine-ready'));
})(typeof window!=='undefined'?window:globalThis);
