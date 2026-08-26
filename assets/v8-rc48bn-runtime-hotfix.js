// Tesla Charge Companion V8 RC4.8 — compatibilité métadonnées/offres après consolidation UI.
// L'UI abonnements n'est plus gérée ici : elle est centralisée dans v8-compare-subscriptions.js.
(function(){
  'use strict';
  const REVISION='rc48ce-pre-expansion-direct';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  let resultsObserver=null;

  function loadDirectOfferPipeline(){
    if(window.TCCV8DirectPipeline||document.querySelector('script[data-tcc-direct-offer-pipeline]'))return true;
    const s=document.createElement('script');
    s.src='assets/v8-direct-offer-pipeline.js?v=v8-direct-offer-pipeline-4';s.defer=true;s.dataset.tccDirectOfferPipeline='1';document.head.appendChild(s);return true;
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

  window.TCCV8RC48BNHotfix={revision:REVISION,loadDirectOfferPipeline,loadFranceCpoGap,loadDrivecoDirect,loadAllegoDirect,loadReveoDirect,loadYawayConnectDirect,loadAldiDirect,installMetadataGuard,renderSubscriptions,cleanDirectFallbacks,prepareLbbSubscriptionRows,refreshResults};
  console.info('[TCC V8] rc48ce : pipeline direct pré-expansion et couche CPO France chargés.');
})();