// Tesla Charge Companion V8 — pipeline unifié des offres directes.
// Les sources actives enrichissent candidateStations() avant expandConfigurations().
// Le pipeline ne modifie jamais compare() : le regroupement station + puissance reste
// la responsabilité du comparateur V8 existant.
(function(){
  'use strict';

  const REVISION='v8-direct-offer-pipeline-3';
  const REGISTRY_URL='data/v8_tariff_sources.json';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const enrichers=new Map();
  const loadedScripts=new Map();
  const diagnostics=[];
  const preparationPromises=new WeakMap();
  let registryPromise=null;
  let subscriptionPlansReady=false;
  let renderObserver=null;
  let renderTimer=null;

  function record(level,message,detail){
    const row={at:new Date().toISOString(),level,message,detail:detail||null};
    diagnostics.push(row);if(diagnostics.length>120)diagnostics.shift();
    if(level==='warn')console.warn('[TCC V8 direct pipeline]',message,detail||'');
    if(level==='error')console.error('[TCC V8 direct pipeline]',message,detail||'');
    return row;
  }

  function currentPrepared(){return window.TCC_V8_AREA_CACHE?.prepared||null;}
  function selectionId(plan){return text(plan?.selectionId||plan?.subscriptionId||plan?.id);}
  function runtimeTag(path){return path.split('/').pop()||path;}
  function providerVariants(value){
    const valueNorm=norm(value);if(!valueNorm)return new Set();
    const stripped=valueNorm.replace(/^(?:belib|la borne bleue|electra|atlante|fastned|totalenergies)\s+(?:direct\s+)?/,'').trim();
    return new Set([valueNorm,stripped].filter(Boolean));
  }

  async function loadRegistry(force=false){
    if(registryPromise&&!force)return registryPromise;
    registryPromise=fetch(`${REGISTRY_URL}?v=${REVISION}`,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`registre indisponible (${r.status})`);return r.json();
    }).then(data=>{
      if(!Array.isArray(data?.sources))throw new Error('registre tarifaire invalide');return data;
    }).catch(err=>{record('error','Registre des sources directes non chargé',err?.message||String(err));return{sources:[]};});
    return registryPromise;
  }

  function scriptAlreadyPresent(path){
    const name=runtimeTag(path);
    return [...document.scripts].some(s=>String(s.src||'').includes('/'+name)||String(s.getAttribute('src')||'').endsWith(name));
  }
  async function ensureScript(path){
    if(!path||!path.startsWith('assets/'))return false;
    if(scriptAlreadyPresent(path))return true;
    if(loadedScripts.has(path))return loadedScripts.get(path);
    const promise=new Promise(resolve=>{
      const s=document.createElement('script');s.src=`${path}?v=${REVISION}`;s.defer=true;s.dataset.tccDirectPipelineModule=path;
      s.onload=()=>resolve(true);s.onerror=()=>{record('warn',`Module direct non chargé: ${path}`);resolve(false);};document.head.appendChild(s);
    });
    loadedScripts.set(path,promise);return promise;
  }
  async function ensureActiveRuntimeModules(){
    const registry=await loadRegistry();
    const modules=[];
    for(const source of registry.sources||[]){
      if(source?.status!=='active')continue;
      for(const path of source.runtimeModules||[])if(path?.startsWith('assets/'))modules.push(path);
    }
    for(const path of [...new Set(modules)])await ensureScript(path);
    await ensureScript('assets/v8-reference-offers.js');
    return true;
  }

  async function waitFor(fn,timeout=5000,step=40){
    const start=Date.now();
    while(Date.now()-start<timeout){const value=fn();if(value)return value;await sleep(step);}return fn()||null;
  }

  function registerPreparedEnricher(id,fn,priority=100){
    const key=text(id);if(!key||typeof fn!=='function')return false;
    enrichers.set(key,{id:key,fn,priority:Number(priority)||100});return true;
  }

  async function enrichPowerdot(prepared){
    const catalog=await waitFor(()=>window.TCCFranceCatalog,5000),api=await waitFor(()=>window.TCCFranceCatalogV8,5000);
    if(!catalog?.loadPowerdotCatalog||!api?.powerdotLocations||!api?.mergedPowerdotStation||!api?.geoDistanceKm||!api?.isPowerdotOperator)return prepared;
    const data=await catalog.loadPowerdotCatalog();
    if(!Array.isArray(data?.chargers)||!data.chargers.length)return prepared;
    const locations=api.powerdotLocations(data).filter(location=>api.powerdotDirectConfigurations?.(location)?.length>0);
    let matched=0;
    prepared.stations=(prepared.stations||[]).map(st=>{
      if(!api.isPowerdotOperator(st)||!Number.isFinite(Number(st?.latitude))||!Number.isFinite(Number(st?.longitude)))return st;
      let best=null;
      for(const location of locations){
        const distance=api.geoDistanceKm(st.latitude,st.longitude,location.latitude,location.longitude);
        if(distance<=.08+1e-9&&(!best||distance<best.distance))best={location,distance};
      }
      if(!best)return st;
      matched++;
      return api.mergedPowerdotStation(best.location,data,[st]);
    });
    prepared.powerdotDirectPipelineApplied=true;
    prepared.powerdotDirectPipelineMatched=matched;
    return prepared;
  }
  async function enrichFreshmile(prepared){
    const api=await waitFor(()=>window.TCCV8FreshmileDirect,7000);
    if(!api?.applyToPrepared)return prepared;
    await api.applyToPrepared(prepared);prepared.freshmileDirectPipelineApplied=true;return prepared;
  }
  async function enrichBump(prepared){
    const api=await waitFor(()=>window.TCCBumpDirectV8,7000);
    if(!api?.loadCatalog||!api?.addOffers)return prepared;
    const data=await api.loadCatalog();if(!data?.stations)return prepared;
    prepared.stations=(prepared.stations||[]).map(st=>api.addOffers(st,data));prepared.bumpDirectPipelineApplied=true;return prepared;
  }
  async function enrichDriveco(prepared){
    const api=await waitFor(()=>window.TCCV8DrivecoDirect,7000);
    if(!api?.loadMap||!api?.addOffers)return prepared;
    const map=await api.loadMap();if(!map?.evses)return prepared;
    prepared.stations=(prepared.stations||[]).map(st=>api.addOffers(st,map));prepared.drivecoDirectPipelineApplied=true;return prepared;
  }

  registerPreparedEnricher('powerdot-direct',enrichPowerdot,20);
  registerPreparedEnricher('freshmile-direct',enrichFreshmile,30);
  registerPreparedEnricher('bump-direct',enrichBump,40);
  registerPreparedEnricher('driveco-direct',enrichDriveco,50);

  function availablePlans(){
    const fromSubs=window.TCCV8Subscriptions?.plans;
    if(Array.isArray(fromSubs)&&fromSubs.length)return fromSubs;
    const fromEngine=window.TCCV8TariffEngine?.subscriptions;
    return Array.isArray(fromEngine)?fromEngine:[];
  }
  async function ensureSubscriptionPlans(){
    const api=window.TCCV8Subscriptions;
    if(api&&!subscriptionPlansReady&&typeof api.loadPlans==='function'){
      try{await api.loadPlans();subscriptionPlansReady=true}catch(err){record('warn','Catalogue abonnements non rechargé',err?.message||String(err));}
    }
    return availablePlans();
  }
  function declaredSubscriptionIdForProvider(value){
    const wanted=providerVariants(value);if(!wanted.size)return'';
    const matches=new Set();
    for(const plan of availablePlans()){
      const id=selectionId(plan);if(!id)continue;
      const variants=providerVariants(plan?.provider);
      if([...wanted].some(v=>variants.has(v)))matches.add(id);
    }
    return matches.size===1?[...matches][0]:'';
  }
  function installSubscriptionEligibilityBridge(){
    const api=window.TCCV8Subscriptions;
    if(!api)return false;
    if(api.__tccDeclaredEligibilityBridge)return true;
    const originalProvider=typeof api.subscriptionIdForProvider==='function'?api.subscriptionIdForProvider.bind(api):null;
    const originalStation=typeof api.subscriptionIdForStation==='function'?api.subscriptionIdForStation.bind(api):null;
    api.subscriptionIdForProvider=function(value){return declaredSubscriptionIdForProvider(value)||(originalProvider?originalProvider(value):'');};
    api.subscriptionIdForStation=function(st){
      const explicit=text(st?.subscriptionId||st?.subscriptionSelectionId);if(explicit)return explicit;
      const provider=text(st?.configurationLabel||st?.label||st?.offerProvider);
      return api.subscriptionIdForProvider(provider)||(originalStation?originalStation(st):'');
    };
    api.isStationEligible=function(st,selected=api.selectedSet?.()||new Set()){
      const id=api.subscriptionIdForStation(st);return !id||selected.has(id);
    };
    api.__tccDeclaredEligibilityBridge=true;
    return true;
  }
  function configProvider(target){
    const raw=text(target?.offerProvider||target?.configurationLabel||target?.label);if(!raw)return'';
    const dot=raw.indexOf('·');return dot>=0?raw.slice(0,dot).trim():raw;
  }
  function repairPreparedSubscriptionMetadata(prepared){
    const api=window.TCCV8Subscriptions;if(!api?.subscriptionIdForProvider||!prepared?.stations)return 0;
    let changed=0;
    const stamp=target=>{
      if(!target||text(target.subscriptionId||target.subscriptionSelectionId))return;
      const id=api.subscriptionIdForProvider(configProvider(target));if(!id)return;
      target.subscriptionId=id;target.subscriptionSelectionId=id;changed++;
    };
    for(const station of prepared.stations||[]){
      stamp(station);
      if(Array.isArray(station?.chargingConfigurations))for(const cfg of station.chargingConfigurations)stamp(cfg);
    }
    prepared.subscriptionMetadataRepaired=changed;
    return changed;
  }

  async function preparePrepared(prepared=currentPrepared(),context={}){
    if(!prepared||!Array.isArray(prepared.stations))return prepared;
    if(prepared.directOfferPipelineRevision===REVISION)return prepared;
    if(preparationPromises.has(prepared))return preparationPromises.get(prepared);
    const promise=(async()=>{
      await ensureActiveRuntimeModules();
      await ensureSubscriptionPlans();installSubscriptionEligibilityBridge();
      const ordered=[...enrichers.values()].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
      for(const enricher of ordered){
        try{await enricher.fn(prepared,context);}catch(err){record('warn',`Enrichisseur ${enricher.id} ignoré`,err?.message||String(err));}
      }
      repairPreparedSubscriptionMetadata(prepared);
      if(window.TCC_V8_AREA_CACHE)window.TCC_V8_AREA_CACHE.prepared=prepared;
      prepared.directOfferPipelineRevision=REVISION;
      return prepared;
    })();
    preparationPromises.set(prepared,promise);
    try{return await promise}finally{preparationPromises.delete(prepared)}
  }

  function physicalOperator(card){return text(card?.querySelector('.operator-badge')?.textContent);}
  function rowProvider(row){
    if(row?.dataset?.tccProvider)return text(row.dataset.tccProvider);
    const el=row?.querySelector?.('.v8-offer-provider');if(!el)return'';
    const clone=el.cloneNode(true);clone.querySelectorAll('.v8-offer-best,.v8-sub-status,.v8-electra-tag,.v8-electra-saving,.v8-electra-planfee,.v8-ref-tag').forEach(x=>x.remove());
    return text(clone.textContent).replace(/\s+abonnement$/i,'').trim();
  }
  function repairSubscriptionMetadata(){
    let changed=0;const api=window.TCCV8Subscriptions;if(!api?.subscriptionIdForProvider)return changed;
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      card.querySelectorAll('.v8-offer-row').forEach(row=>{
        if(text(row.dataset.subscriptionId))return;
        const id=api.subscriptionIdForProvider(rowProvider(row));if(id){row.dataset.subscriptionId=id;changed++;}
      });
    });
    return changed;
  }

  function directProviderPresent(card,operator){
    const wanted=norm(operator);
    return [...card.querySelectorAll('.v8-offer-row:not(.v8-reference-row)')].some(row=>{
      const p=norm(rowProvider(row));return p.includes(wanted)&&p.includes('direct');
    });
  }
  function collectRenderedDiagnostics(){
    for(const card of document.querySelectorAll('#results .result-card[data-result-id]')){
      const op=norm(physicalOperator(card));
      for(const key of ['bump','freshmile','driveco','powerdot']){
        if(!(op===key||op.includes(key)))continue;
        if(!directProviderPresent(card,key))record('warn',`Tarif direct non rendu pour ${key}`,text(card.querySelector('h3')?.textContent));
      }
    }
  }
  function finalizeRendered(){
    installSubscriptionEligibilityBridge();
    const changed=repairSubscriptionMetadata();
    if(changed)try{window.TCCV8Subscriptions?.applyAll?.(true)}catch(e){}
    try{window.TCCV8ReferenceOffers?.apply?.()}catch(e){}
    collectRenderedDiagnostics();
  }

  function scheduleFinalize(){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{try{finalizeRendered()}catch(err){record('warn','Finalisation offres rendues impossible',err?.message||String(err));}},80)}
  function installRenderObserver(){
    const root=document.getElementById('results');if(!root||renderObserver)return false;
    renderObserver=new MutationObserver(scheduleFinalize);renderObserver.observe(root,{childList:true,subtree:true});return true;
  }

  function chainContainsCandidatePipeline(fn){
    let cur=fn;
    for(let i=0;i<16&&typeof cur==='function';i++){
      if(cur.__tccDirectOfferCandidatePipeline)return true;
      cur=cur.__tccV8Original||cur.__tccOriginal||cur.__tccAreaOriginal||cur.__tccCandidateOriginal||null;
    }
    return false;
  }
  function installCandidateGuard(){
    const current=window.candidateStations||(typeof candidateStations==='function'?candidateStations:null);
    if(typeof current!=='function'||chainContainsCandidatePipeline(current))return typeof current==='function';
    const wrapped=async function directOfferCandidatePipeline(...args){
      const prepared=await current.apply(this,args);
      if(prepared?.stations)await preparePrepared(prepared,{reason:'candidateStations'});
      return prepared;
    };
    wrapped.__tccDirectOfferCandidatePipeline=true;wrapped.__tccV8Original=current;
    window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}
    return true;
  }

  async function boot(){
    await ensureActiveRuntimeModules();await ensureSubscriptionPlans();installSubscriptionEligibilityBridge();
    installRenderObserver();installCandidateGuard();
    const prepared=currentPrepared();if(prepared)await preparePrepared(prepared,{reason:'boot-cache'});
    scheduleFinalize();
    let tries=0;const timer=setInterval(()=>{
      tries++;installRenderObserver();installCandidateGuard();installSubscriptionEligibilityBridge();
      if(tries>1200)clearInterval(timer);
    },100);
  }

  window.TCCV8DirectPipeline={revision:REVISION,loadRegistry,ensureActiveRuntimeModules,registerPreparedEnricher,preparePrepared,repairPreparedSubscriptionMetadata,declaredSubscriptionIdForProvider,installSubscriptionEligibilityBridge,repairSubscriptionMetadata,finalizeRendered,installCandidateGuard,get enrichers(){return[...enrichers.keys()]},get diagnostics(){return diagnostics.slice()}};
  document.dispatchEvent(new CustomEvent('tcc:direct-offer-pipeline-ready'));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot(),{once:true});else boot();
  console.info('[TCC V8] Pipeline unifié offres directes actif avant expansion:',REVISION);
})();