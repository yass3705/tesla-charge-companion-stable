// Tesla Charge Companion V8 RC4.8 — compatibilité métadonnées/offres après consolidation UI.
// L'UI abonnements n'est plus gérée ici : elle est centralisée dans v8-compare-subscriptions.js.
(function(){
  'use strict';
  const REVISION='rc48cg-nl-final-operator-sync';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  let resultsObserver=null;
  let protectedAreaCacheValue=window.TCC_V8_AREA_CACHE||null;
  let protectedAreaCacheInstalled=false;
  const protectedPreparedState=new WeakMap();

  function isTeslaStation(st){return st?.source==='teslaSupercharger'||norm(st?.operator)==='tesla';}
  function stationKey(st){return text(st?.id)||text(st?.catalogStationId)||`${Number(st?.latitude)}|${Number(st?.longitude)}|${norm(st?.operator)}`;}
  function mergeProtectedStations(current,protectedStations){
    const out=[],seen=new Set();
    for(const st of [...(Array.isArray(current)?current:[]),...(Array.isArray(protectedStations)?protectedStations:[])]){
      if(!st)continue;const key=stationKey(st);if(!key||seen.has(key))continue;seen.add(key);out.push(st);
    }
    return out;
  }
  function physicalCount(list){
    const seen=new Set();
    for(const st of list||[]){const key=text(st?.catalogStationId)||text(st?.baseStationId)||text(st?.id).split('::')[0];if(key)seen.add(key);}
    return seen.size;
  }
  function ensureTeslaOperatorChoice(prepared){
    const teslaCount=(prepared?.stations||[]).filter(isTeslaStation).length;
    if(!teslaCount)return false;
    const host=document.getElementById('augOperatorChoices');if(!host)return false;
    let inputs=[...host.querySelectorAll('input[type=checkbox]')];
    if(inputs.some(input=>norm(input.value)==='tesla'))return true;
    const checkedByDefault=inputs.length>0&&inputs.every(input=>input.checked);
    const label=document.createElement('label');label.className='operator-choice';
    const input=document.createElement('input');input.type='checkbox';input.value='Tesla';input.checked=checkedByDefault;
    label.appendChild(input);label.appendChild(document.createTextNode(' Tesla'));host.appendChild(label);
    inputs=[...host.querySelectorAll('input[type=checkbox]')];
    const hint=document.getElementById('tccDynamicOperatorHint');
    if(hint)hint.textContent=`${inputs.length} opérateur(s) disponibles dans la zone chargée.`;
    host.dataset.tccDynamic='1';
    return true;
  }
  function refreshProtectedAreaUi(prepared){
    const apply=()=>{
      try{window.TCCV8DynamicOperators?.refresh?.(prepared?.stations||[]);}catch(e){}
      try{ensureTeslaOperatorChoice(prepared);}catch(e){}
    };
    [0,80,180,400,800,1200,2000,3200].forEach(delay=>delay?setTimeout(apply,delay):apply());
    requestAnimationFrame?.(apply);
    const status=document.getElementById('routeStatus');
    if(status&&/borne\(s\) mise\(s\) à jour/.test(text(status.textContent))){
      const count=physicalCount(prepared?.stations||[]);
      status.textContent=text(status.textContent).replace(/^✓\s*\d+\s+borne\(s\)/,`✓ ${count} borne(s)`);
    }
  }
  function protectPreparedAssignments(prepared,protectedStations){
    if(!prepared||!Array.isArray(prepared.stations)||!protectedStations?.length)return;
    const existing=protectedPreparedState.get(prepared);
    if(existing){existing.protectedStations=mergeProtectedStations(existing.protectedStations,protectedStations);existing.value=mergeProtectedStations(existing.value,existing.protectedStations);return;}
    const state={value:mergeProtectedStations(prepared.stations,protectedStations),protectedStations:protectedStations.slice()};
    protectedPreparedState.set(prepared,state);
    try{
      Object.defineProperty(prepared,'stations',{
        configurable:true,enumerable:true,
        get(){return state.value;},
        set(next){state.value=mergeProtectedStations(next,state.protectedStations);queueMicrotask(()=>refreshProtectedAreaUi(prepared));}
      });
    }catch(e){prepared.stations=state.value;}
  }
  async function ensureNetherlandsTesla(cache){
    const prepared=cache?.prepared;
    if(!prepared||!Array.isArray(prepared.stations)||!Number(prepared.netherlandsCatalogLoaded||0))return false;
    const present=prepared.stations.filter(isTeslaStation);
    if(present.length){prepared.protectedTeslaCandidateCount=present.length;protectPreparedAssignments(prepared,present);refreshProtectedAreaUi(prepared);return true;}
    const radius=Math.max(0,Number(prepared.maxDistanceKm||document.getElementById('simMaxDistance')?.value||0));
    const current=window.candidateStations;
    if(typeof current!=='function')return false;
    let routesBefore={};try{routesBefore={...(routeResults||{})};}catch(e){}
    try{
      const tesla=await current.call(window,'tesla',radius);
      const protectedStations=(tesla?.stations||[]).filter(isTeslaStation);
      if(!protectedStations.length)return false;
      let teslaRoutes={};try{teslaRoutes={...(routeResults||{})};}catch(e){}
      prepared.stations=mergeProtectedStations(prepared.stations,protectedStations);
      protectPreparedAssignments(prepared,protectedStations);
      prepared.protectedTeslaCandidateCount=protectedStations.length;
      try{routeResults={...routesBefore,...teslaRoutes};}catch(e){}
      refreshProtectedAreaUi(prepared);
      console.info(`[TCC V8] ${protectedStations.length} candidat(s) Tesla restauré(s) après les overlays Pays-Bas.`);
      return true;
    }catch(err){
      try{routeResults=routesBefore;}catch(e){}
      console.warn('[TCC V8] Protection Tesla Pays-Bas indisponible :',err?.message||err);return false;
    }
  }
  function installProtectedAreaCache(){
    if(protectedAreaCacheInstalled)return true;
    try{
      Object.defineProperty(window,'TCC_V8_AREA_CACHE',{
        configurable:true,enumerable:true,
        get(){return protectedAreaCacheValue;},
        set(value){protectedAreaCacheValue=value;queueMicrotask(()=>ensureNetherlandsTesla(value));}
      });
      protectedAreaCacheInstalled=true;
      if(protectedAreaCacheValue)queueMicrotask(()=>ensureNetherlandsTesla(protectedAreaCacheValue));
      return true;
    }catch(err){console.warn('[TCC V8] Garde cache de zone indisponible :',err?.message||err);return false;}
  }

  installProtectedAreaCache();

  function loadDirectOfferPipeline(){
    if(window.TCCV8DirectPipeline||document.querySelector('script[data-tcc-direct-offer-pipeline]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-direct-offer-pipeline.js?v=v8-direct-offer-pipeline-5';s.defer=true;s.dataset.tccDirectOfferPipeline='1';document.head.appendChild(s);return true;
  }
  function loadFranceCpoGap(){
    if(window.TCCV8FranceCpoConsolidated||window.TCCV8FranceCpoGap||document.querySelector('script[data-tcc-france-cpo-gap]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-france-cpo-gap-overlay.js?v=rc48bv-20260826';s.defer=true;s.dataset.tccFranceCpoGap='1';document.head.appendChild(s);return true;
  }
  function loadDrivecoDirect(){
    if(window.TCCV8DrivecoDirect||document.querySelector('script[data-tcc-driveco-direct]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-driveco-direct-overlay.js?v=rc48-driveco-20260826a';s.defer=true;s.dataset.tccDrivecoDirect='1';document.head.appendChild(s);return true;
  }
  function loadAllegoDirect(){
    if(window.TCCAllegoDirectV8||document.querySelector('script[data-tcc-allego-direct]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-allego-direct.js?v=allego-direct-v2-20260826';s.defer=true;s.dataset.tccAllegoDirect='1';document.head.appendChild(s);return true;
  }
  function loadReveoDirect(){
    if(window.TCCReveoDirectV8||document.querySelector('script[data-tcc-reveo-direct]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-reveo-direct.js?v=reveo-direct-v1-20260826';s.defer=true;s.dataset.tccReveoDirect='1';document.head.appendChild(s);return true;
  }
  function loadYawayConnectDirect(){
    if(window.TCCYawayConnectDirectV8||document.querySelector('script[data-tcc-yaway-connect-direct]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-yaway-connect-direct.js?v=yaway-connect-direct-v1-20260826';s.defer=true;s.dataset.tccYawayConnectDirect='1';document.head.appendChild(s);return true;
  }
  function loadAldiDirect(){
    if(window.TCCAldiDirectV8||document.querySelector('script[data-tcc-aldi-direct]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-aldi-direct.js?v=aldi-direct-v1b-20260826';s.defer=true;s.dataset.tccAldiDirect='1';document.head.appendChild(s);return true;
  }

  function mergeRawMetadata(rawList,normalized){
    if(!Array.isArray(normalized))return normalized;
    const raw=Array.isArray(rawList)?rawList:[];
    const byId=new Map(raw.map((cfg,index)=>[String(cfg?.id||`#${index}`),cfg||{}]));
    return normalized.map((cfg,index)=>({...((byId.get(String(cfg?.id||`#${index}`))||raw[index]||{})),...cfg}));
  }
  function installMetadataGuard(){
    let installed=false;
    const n=window.normalizeConfigurations;
    if(typeof n==='function'&&!n.__tccMetadataCompat){
      const wrapped=function(configs,st){return mergeRawMetadata(configs,n.call(this,configs,st));};
      wrapped.__tccMetadataCompat=true;wrapped.__tccOriginal=n;
      window.normalizeConfigurations=wrapped;try{normalizeConfigurations=wrapped}catch(e){}
      installed=true;
    }else if(typeof n==='function')installed=true;
    const sc=window.stationConfigurations;
    if(typeof sc==='function'&&!sc.__tccMetadataCompat){
      const wrapped=function(st){return mergeRawMetadata(st?.chargingConfigurations,sc.call(this,st));};
      wrapped.__tccMetadataCompat=true;wrapped.__tccOriginal=sc;
      window.stationConfigurations=wrapped;try{stationConfigurations=wrapped}catch(e){}
      installed=true;
    }else if(typeof sc==='function')installed=true;
    return installed;
  }

  function isLbbCard(card){
    const head=[card?.querySelector('h3')?.textContent,card?.querySelector('.operator-badge')?.textContent,card?.querySelector('.station-head')?.textContent].map(norm).join(' ');
    return head.includes('la borne bleue');
  }
  function prepareLbbSubscriptionRows(){
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      if(!isLbbCard(card))return;
      card.querySelectorAll('.v8-offer-row').forEach(row=>{
        const provider=norm(row.querySelector('.v8-offer-provider')?.textContent);
        if(provider==='abonne'||provider.startsWith('abonne ')||provider.includes('la borne bleue direct abonne')||provider.includes('la borne bleue abonne'))row.dataset.subscriptionId='labornebleue-annual';
      });
    });
  }
  function cleanDirectFallbacks(){
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      const rows=[...card.querySelectorAll('.v8-offer-row')];
      const calculable=rows.some(row=>{
        if(row.classList.contains('v8-direct-fallback-row')||row.classList.contains('v8-reference-row'))return false;
        const provider=text(row.querySelector('.v8-offer-provider')?.textContent).toLowerCase();
        const total=text(row.querySelector('.v8-offer-total')?.textContent);
        return provider.startsWith('la borne bleue direct')&&/\d/.test(total)&&/€|eur/i.test(total);
      });
      if(calculable)card.querySelectorAll('.v8-direct-fallback-row').forEach(row=>{const p=norm(row.querySelector('.v8-offer-provider')?.textContent);if(p.startsWith('la borne bleue direct'))row.remove()});
    });
  }
  function refreshResults(){
    prepareLbbSubscriptionRows();cleanDirectFallbacks();
    try{window.TCCV8DirectPipeline?.repairSubscriptionMetadata?.()}catch(e){}
    try{window.TCCV8Subscriptions?.applyAll?.(true)}catch(e){}
    try{window.TCCV8ReferenceOffers?.apply?.()}catch(e){}
  }
  function installResultsObserver(){
    if(resultsObserver)return true;
    const root=document.getElementById('results');if(!root)return false;
    let timer=null;
    resultsObserver=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(refreshResults,180)});
    resultsObserver.observe(root,{childList:true,subtree:true});
    return true;
  }
  function renderSubscriptions(force=false){return window.TCCV8CompareSubscriptions?.render?.(force)??false}
  function boot(){loadDirectOfferPipeline();loadFranceCpoGap();loadDrivecoDirect();loadAllegoDirect();loadReveoDirect();loadYawayConnectDirect();loadAldiDirect();installMetadataGuard();installResultsObserver();refreshResults();renderSubscriptions(false)}

  document.addEventListener('tcc:compare-subscriptions-ready',()=>renderSubscriptions(false));
  document.addEventListener('tcc:direct-offer-pipeline-ready',()=>refreshResults());
  document.addEventListener('click',event=>{if(event.target?.closest?.('.v8-simulate,#routeButton')){loadDirectOfferPipeline();loadFranceCpoGap();loadDrivecoDirect();loadAllegoDirect();loadReveoDirect();loadYawayConnectDirect();loadAldiDirect();installMetadataGuard()}},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else queueMicrotask(boot);

  window.TCCV8RC48BNHotfix={revision:REVISION,loadDirectOfferPipeline,loadFranceCpoGap,loadDrivecoDirect,loadAllegoDirect,loadReveoDirect,loadYawayConnectDirect,loadAldiDirect,installMetadataGuard,installProtectedAreaCache,ensureNetherlandsTesla,ensureTeslaOperatorChoice,renderSubscriptions,cleanDirectFallbacks,prepareLbbSubscriptionRows,refreshResults};
  console.info('[TCC V8] rc48cg : cache Pays-Bas + filtre opérateurs synchronisés avec Tesla.');
})();