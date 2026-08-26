// Tesla Charge Companion V8 — registre tarifaire unifié (migration progressive).
// Cette couche centralise les métadonnées d'offres et d'abonnements sans remplacer
// brutalement les résolveurs existants. Les intégrations historiques peuvent migrer
// une par une vers registerAdapter()/registerOffer().
(function(){
  'use strict';

  const REVISION='v8-tariff-engine-1';
  const REGISTRY_URL='data/v8_tariff_sources.json';
  const BASE_OVERLAY_URL='data/tariff_overlay_v1.json';
  const TOTAL_OVERLAY_URL='data/totalenergies_tariff_overlay_v1.json';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  let registryPromise=null,cataloguePromise=null;
  const offers=new Map(),subscriptions=new Map(),adapters=new Map(),diagnostics=[];

  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function record(level,message,detail){
    const row={at:new Date().toISOString(),level,message,detail:detail||null};
    diagnostics.push(row);if(diagnostics.length>100)diagnostics.shift();
    if(level==='warn')console.warn('[TCC V8 tariff engine]',message,detail||'');
    if(level==='error')console.error('[TCC V8 tariff engine]',message,detail||'');
    return row;
  }
  function selectionId(offer){return text(offer?.selectionId||offer?.subscriptionId||offer?.id);}
  function canonicalOffer(raw={},origin='runtime'){
    const offer={...raw};
    offer.id=text(offer.id);
    offer.provider=text(offer.provider||offer.offerProvider);
    offer.offerType=text(offer.offerType||'operator_direct');
    offer.origin=text(offer.origin||origin);
    offer.operatorAliases=Array.isArray(offer.operatorAliases)?offer.operatorAliases.map(text).filter(Boolean):[];
    if(offer.kind)offer.kind=text(offer.kind).toUpperCase();
    if(offer.currency)offer.currency=text(offer.currency).toUpperCase();
    if(offer.selectionId)offer.selectionId=text(offer.selectionId);
    if(offer.subscriptionId)offer.subscriptionId=text(offer.subscriptionId);
    if(offer.defaultSelected==null&&offer.offerType.startsWith('subscription'))offer.defaultSelected=false;
    return offer;
  }
  function registerOffer(raw,origin='runtime'){
    const offer=canonicalOffer(raw,origin);if(!offer.id)throw new Error('Tariff offer id missing');
    offers.set(offer.id,offer);return clone(offer);
  }
  function registerSubscription(raw,origin='runtime'){
    const offer=canonicalOffer(raw,origin);if(!offer.id)throw new Error('Subscription id missing');
    if(!offer.offerType.startsWith('subscription'))offer.offerType='subscription';
    offer.defaultSelected=false;
    subscriptions.set(offer.id,offer);return clone(offer);
  }
  function registerAdapter(id,adapter){
    const key=text(id);if(!key)throw new Error('Adapter id missing');
    if(!adapter||typeof adapter.resolve!=='function')throw new Error(`Adapter ${key} must expose resolve(station, context)`);
    adapters.set(key,adapter);return true;
  }
  function selectedSubscriptions(){
    try{const state=JSON.parse(localStorage.getItem('tccSubscriptionsV1')||'{}');return new Set(Array.isArray(state?.selected)?state.selected:[])}catch(e){return new Set();}
  }
  function isOfferEligible(offer,selected=selectedSubscriptions()){
    if(!offer)return false;
    if(offer.rankable===false||offer.ambiguous===true)return false;
    if(!text(offer.offerType).startsWith('subscription'))return true;
    return selected.has(selectionId(offer));
  }
  function genericStationMatchAllowed(offer){
    if(text(offer?.runtime).startsWith('existing_'))return false;
    if(text(offer?.offerType).startsWith('subscription')&&!(offer?.operatorAliases||[]).length)return false;
    return true;
  }
  function operatorMatches(station,offer){
    if(!genericStationMatchAllowed(offer))return false;
    const aliases=(offer?.operatorAliases||[]).map(norm).filter(Boolean);if(!aliases.length)return true;
    const candidates=[station?.operator,station?._sourceOperator,station?.cpo,station?.network,station?.name].map(norm).filter(Boolean);
    return aliases.some(alias=>candidates.includes(alias));
  }
  function powerMatches(station,offer){
    const kind=text(station?.kind||station?.configurationKind).toUpperCase();
    const power=Number(station?.powerKw||station?.configurationPowerKw||0);
    if(offer?.kind&&kind!==text(offer.kind).toUpperCase())return false;
    const min=Number(offer?.minPowerKw),max=Number(offer?.maxPowerKw);
    if(Number.isFinite(min)&&power<min-1e-9)return false;
    if(Number.isFinite(max)&&power>max+1e-9)return false;
    return true;
  }
  function declaredOffersForStation(station,selected=selectedSubscriptions()){
    return [...offers.values(),...subscriptions.values()].filter(offer=>operatorMatches(station,offer)&&powerMatches(station,offer)).map(offer=>({...clone(offer),eligible:isOfferEligible(offer,selected)}));
  }
  async function resolve(station,context={}){
    const selected=context.selectedSubscriptions instanceof Set?context.selectedSubscriptions:selectedSubscriptions();
    const result=declaredOffersForStation(station,selected);
    for(const [id,adapter] of adapters){
      try{
        const rows=await adapter.resolve(station,{...context,selectedSubscriptions:selected});
        for(const row of Array.isArray(rows)?rows:(rows?[rows]:[]))result.push({...canonicalOffer(row,id),eligible:isOfferEligible(row,selected),adapterId:id});
      }catch(error){record('warn',`Adapter ${id} failed`,error?.message||String(error));}
    }
    const byId=new Map();for(const row of result){const key=text(row.id)||`${row.provider}|${row.kind||''}|${row.pricePerKwh??''}`;if(!byId.has(key))byId.set(key,row);}
    return [...byId.values()];
  }
  function mergeOverlay(base,extension){
    const merged={...(base||{})};
    const mergeRows=(a,b)=>{const map=new Map();for(const row of [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])]){if(row?.id)map.set(text(row.id),row);}return [...map.values()];};
    merged.operatorOffers=mergeRows(base?.operatorOffers,extension?.operatorOffers);
    merged.subscriptions=mergeRows(base?.subscriptions,extension?.subscriptions);
    return merged;
  }
  async function loadRegistry(force=false){
    if(registryPromise&&!force)return registryPromise;
    registryPromise=fetch(`${REGISTRY_URL}?v=${REVISION}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`registry unavailable (${r.status})`);return r.json();}).then(data=>{
      if(Number(data?.schemaVersion)!==1||!Array.isArray(data?.sources))throw new Error('invalid tariff source registry');
      return data;
    }).catch(error=>{record('error','Tariff source registry failed to load',error?.message||String(error));return {schemaVersion:1,sources:[],publish:{copyFromMain:[]},policy:{}};});
    return registryPromise;
  }
  async function loadCatalogue(force=false){
    if(cataloguePromise&&!force)return cataloguePromise;
    cataloguePromise=Promise.all([
      fetch(`${BASE_OVERLAY_URL}?v=${REVISION}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`${TOTAL_OVERLAY_URL}?v=${REVISION}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
    ]).then(([base,total])=>{
      const merged=mergeOverlay(base,total);
      offers.clear();subscriptions.clear();
      for(const offer of merged.operatorOffers||[])registerOffer(offer,'declarative-overlay');
      for(const plan of merged.subscriptions||[])registerSubscription(plan,'declarative-overlay');
      return merged;
    });
    return cataloguePromise;
  }
  function validateRegistry(registry){
    const errors=[],warnings=[],ids=new Set();
    for(const source of registry?.sources||[]){
      const id=text(source?.id);if(!id)errors.push('source without id');else if(ids.has(id))errors.push(`duplicate source id: ${id}`);else ids.add(id);
      if(source?.status==='active'&&!Array.isArray(source?.runtimeModules))errors.push(`active source without runtimeModules: ${id}`);
      if(source?.status==='active'&&!Array.isArray(source?.artifactPaths))errors.push(`active source without artifactPaths: ${id}`);
      if(source?.status==='staged')warnings.push(`staged source: ${id}`);
    }
    return {ok:errors.length===0,errors,warnings};
  }
  async function boot(){const registry=await loadRegistry();await loadCatalogue();const validation=validateRegistry(registry);if(!validation.ok)record('error','Tariff registry validation failed',validation.errors);return validation;}

  window.TCCV8TariffEngine={
    revision:REVISION,boot,loadRegistry,loadCatalogue,registerOffer,registerSubscription,registerAdapter,
    resolve,declaredOffersForStation,isOfferEligible,selectedSubscriptions,selectionId,validateRegistry,
    get offers(){return [...offers.values()].map(clone);},get subscriptions(){return [...subscriptions.values()].map(clone);},
    get adapters(){return [...adapters.keys()];},get diagnostics(){return diagnostics.map(clone);}
  };
  document.dispatchEvent(new CustomEvent('tcc:tariff-engine-ready'));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot(),{once:true});else boot();
  console.info('[TCC V8] Unified tariff engine registry ready:',REVISION);
})();
