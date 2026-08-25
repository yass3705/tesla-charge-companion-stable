// Tesla Charge Companion V8 RC4.8 — pont déterministe overlays tarifs -> cache de zone.
(function(){
  'use strict';
  const REVISION='rc48bn-metadata-stable';
  let applying=false,lastPrepared=null;

  // app.js normalise les configurations avant chaque simulation. Historiquement cette
  // normalisation ne gardait que id/label/kind/power/stalls/pricing et supprimait donc
  // offerProvider, subscriptionId et les marqueurs des overlays. Résultat : une offre
  // La Borne Bleue pouvait être recalculée avec le bon prix mais ré-étiquetée Electra,
  // tandis que la ligne directe calculable disparaissait. On conserve désormais les
  // métadonnées commerciales de la configuration brute tout en laissant app.js valider
  // les champs physiques et le pricing.
  function mergeRawMetadata(rawList,normalized){
    if(!Array.isArray(normalized))return normalized;
    const raw=Array.isArray(rawList)?rawList:[];
    const byId=new Map(raw.map((cfg,index)=>[String(cfg?.id||`#${index}`),cfg||{}]));
    return normalized.map((cfg,index)=>{
      const source=byId.get(String(cfg?.id||`#${index}`))||raw[index]||{};
      return {...source,...cfg};
    });
  }
  function installConfigurationMetadataGuard(){
    let ok=false;
    const currentNormalize=window.normalizeConfigurations;
    if(typeof currentNormalize==='function'){
      if(currentNormalize.__tccConfigurationMetadataV1)ok=true;
      else{
        const wrapped=function(configs,st){return mergeRawMetadata(configs,currentNormalize.call(this,configs,st));};
        wrapped.__tccConfigurationMetadataV1=true;wrapped.__tccOriginal=currentNormalize;
        window.normalizeConfigurations=wrapped;try{normalizeConfigurations=wrapped}catch(e){}
        ok=true;
      }
    }
    const currentStationConfigurations=window.stationConfigurations;
    if(typeof currentStationConfigurations==='function'){
      if(currentStationConfigurations.__tccConfigurationMetadataV1)ok=true;
      else{
        const wrapped=function(st){return mergeRawMetadata(st?.chargingConfigurations,currentStationConfigurations.call(this,st));};
        wrapped.__tccConfigurationMetadataV1=true;wrapped.__tccOriginal=currentStationConfigurations;
        window.stationConfigurations=wrapped;try{stationConfigurations=wrapped}catch(e){}
        ok=true;
      }
    }
    return ok;
  }

  function loadReferenceOffers(){
    if(!window.TCCV8ReferenceOffers&&!document.querySelector('script[data-tcc-reference-offers]')){const s=document.createElement('script');s.src='assets/v8-reference-offers.js?v=20260821q1';s.defer=true;s.dataset.tccReferenceOffers='1';document.head.appendChild(s)}
    if(!window.TCCV8IDFExtraReferenceOffers&&!document.querySelector('script[data-tcc-idf-extra-reference-offers]')){const x=document.createElement('script');x.src='assets/v8-idf-extra-reference-offers.js?v=20260821q1';x.defer=true;x.dataset.tccIdfExtraReferenceOffers='1';document.head.appendChild(x)}
  }
  function loadFastnedStationOverlay(){if(!window.TCCV8FastnedStationOverlay&&!document.querySelector('script[data-tcc-fastned-stations]')){const s=document.createElement('script');s.src='assets/v8-fastned-station-overlay.js?v=rc48-fastned-20260825';s.defer=true;s.dataset.tccFastnedStations='1';document.head.appendChild(s)}}
  function loadFreshmileDirect(){if(!window.TCCV8FreshmileDirect&&!document.querySelector('script[data-tcc-freshmile-direct]')){const s=document.createElement('script');s.src='assets/v8-freshmile-direct-overlay.js?v=rc48-freshmile-20260825c';s.defer=true;s.dataset.tccFreshmileDirect='1';document.head.appendChild(s)}}
  function loadLaBorneBleueDirect(){if(!window.TCCV8LaBorneBleueDirect&&!document.querySelector('script[data-tcc-labornebleue-direct]')){const s=document.createElement('script');s.src='assets/v8-labornebleue-direct-overlay.js?v=rc48-labornebleue-20260825d';s.defer=true;s.dataset.tccLabornebleueDirect='1';document.head.appendChild(s)}}
  function loadLaBorneBleueExplicitFallback(){if(!window.TCCV8LaBorneBleueExplicitFallback&&!document.querySelector('script[data-tcc-labornebleue-explicit-fallback]')){const s=document.createElement('script');s.src='assets/v8-labornebleue-operator-fallback.js?v=rc48bm-20260825';s.defer=true;s.dataset.tccLabornebleueExplicitFallback='1';document.head.appendChild(s)}}
  function loadCanonicalStationOverlay(){if(!window.TCCV8CanonicalStationOverlay&&!document.querySelector('script[data-tcc-canonical-stations]')){const s=document.createElement('script');s.src='assets/v8-canonical-station-overlay.js?v=rc48ar-20260822';s.defer=true;s.dataset.tccCanonicalStations='1';document.head.appendChild(s)}}
  function loadDirectResolverUi(){if(!window.TCCV8DirectResolver&&!document.querySelector('script[data-tcc-direct-resolver-ui]')){const s=document.createElement('script');s.src='assets/v8-direct-resolver-ui.js?v=rc48bd-20260823';s.defer=true;s.dataset.tccDirectResolverUi='1';document.head.appendChild(s)}}
  function loadDirectSmokeFix(){if(!window.TCCV8DirectSmokeFix&&!document.querySelector('script[data-tcc-direct-smoke-fix]')){const s=document.createElement('script');s.src='assets/v8-direct-resolver-followup.js?v=rc48av-20260822';s.defer=true;s.dataset.tccDirectSmokeFix='1';document.head.appendChild(s)}}
  function loadTariffDisplay(){if(!window.TCCV8TariffDisplay&&!document.querySelector('script[data-tcc-tariff-display]')){const s=document.createElement('script');s.src='assets/v8-tariff-display-fix.js?v=rc48bn-20260825';s.defer=true;s.dataset.tccTariffDisplay='1';document.head.appendChild(s)}}
  function loadSubscriptionStability(){if(!window.TCCV8SubscriptionStability&&!document.querySelector('script[data-tcc-subscription-stability]')){const s=document.createElement('script');s.src='assets/v8-subscription-stability-fix.js?v=rc48bn-20260825';s.defer=true;s.dataset.tccSubscriptionStability='1';document.head.appendChild(s)}}

  installConfigurationMetadataGuard();
  loadReferenceOffers();loadFastnedStationOverlay();loadFreshmileDirect();loadLaBorneBleueDirect();loadLaBorneBleueExplicitFallback();loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();loadSubscriptionStability();

  async function apply(force=false){
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    const fastnedApi=window.TCCV8FastnedStationOverlay,freshmileApi=window.TCCV8FreshmileDirect,labornebleueApi=window.TCCV8LaBorneBleueDirect,lbbFallbackApi=window.TCCV8LaBorneBleueExplicitFallback,operatorApi=window.TCCV8OperatorOverlay,canonicalApi=window.TCCV8CanonicalStationOverlay;
    if(!prepared||!operatorApi?.applyToPrepared||applying)return false;
    const fastnedReady=!!fastnedApi?.applyToPrepared,freshmileReady=!!freshmileApi?.applyToPrepared,labornebleueReady=!!labornebleueApi?.applyToPrepared,canonicalReady=!!canonicalApi?.applyToPrepared;
    if(!force&&prepared===lastPrepared&&prepared.tariffOverlayApplied&&(!fastnedReady||prepared.fastnedStationOverlayApplied)&&(!canonicalReady||prepared.canonicalStationOverlayApplied)&&(!freshmileReady||prepared.freshmileDirectOverlayApplied)&&(!labornebleueReady||prepared.labornebleueDirectOverlayApplied)&&(!lbbFallbackApi?.applyToPrepared||prepared.labornebleueExplicitFallbackApplied))return true;
    applying=true;
    try{
      installConfigurationMetadataGuard();
      if(fastnedReady)await fastnedApi.applyToPrepared(prepared);
      await operatorApi.applyToPrepared(prepared);
      if(canonicalReady)await canonicalApi.applyToPrepared(prepared);
      if(freshmileReady)await freshmileApi.applyToPrepared(prepared);
      if(labornebleueReady)await labornebleueApi.applyToPrepared(prepared);
      if(typeof lbbFallbackApi?.applyToPrepared==='function')lbbFallbackApi.applyToPrepared(prepared);
      lastPrepared=prepared;window.TCC_V8_AREA_CACHE.prepared=prepared;return true;
    }catch(err){console.warn('[TCC V8] Pont overlay/cache indisponible :',err?.message||err);return false}finally{applying=false}
  }

  function installExpansionGuard(){
    installConfigurationMetadataGuard();
    const current=window.expandConfigurations;if(typeof current!=='function'||current.__tccOverlayExpansionGuard)return false;
    const wrapped=function(baseStations){
      let source=baseStations;
      const operatorApi=window.TCCV8OperatorOverlay,overlay=window.TCC_TARIFF_OVERLAY_V1,canonicalApi=window.TCCV8CanonicalStationOverlay,canonicalData=window.TCC_V8_CANONICAL_STATION_OVERLAY,lbbFallbackApi=window.TCCV8LaBorneBleueExplicitFallback;
      if(Array.isArray(source)&&overlay&&typeof operatorApi?.addOperatorOffers==='function')source=source.map(st=>operatorApi.addOperatorOffers(st,overlay));
      if(Array.isArray(source)&&canonicalData&&typeof canonicalApi?.applyStation==='function')source=source.map(st=>canonicalApi.applyStation(st,canonicalData));
      if(Array.isArray(source)&&typeof lbbFallbackApi?.addDirect==='function')source=source.map(st=>lbbFallbackApi.addDirect(st));
      return current.call(this,source);
    };
    wrapped.__tccOverlayExpansionGuard=true;wrapped.__tccOriginal=current;window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}return true;
  }

  function markRevision(){const banner=document.getElementById('tccPreviewBanner');if(banner&&/RC4\.8/.test(String(banner.textContent||''))){const label=`V8 Preview · RC4.8 · rc48bn · métadonnées offres préservées · abonnements visibles · La Borne Bleue direct calculable · données canoniques France · auto-mise à jour désactivée`;banner.textContent=label;banner.dataset.stableLabel=label;banner.setAttribute('aria-label',label)}}

  const timer=setInterval(()=>{installConfigurationMetadataGuard();loadFastnedStationOverlay();loadFreshmileDirect();loadLaBorneBleueDirect();loadLaBorneBleueExplicitFallback();loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();loadSubscriptionStability();apply(false);installExpansionGuard();markRevision();loadReferenceOffers()},120);
  setTimeout(()=>clearInterval(timer),120000);

  document.addEventListener('click',async event=>{
    const button=event.target?.closest?.('.v8-simulate');if(!button||button.dataset.tccOverlayReplay==='1')return;
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;if(!prepared)return;
    event.preventDefault();event.stopImmediatePropagation();
    installConfigurationMetadataGuard();loadFastnedStationOverlay();loadFreshmileDirect();loadLaBorneBleueDirect();loadLaBorneBleueExplicitFallback();loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();loadSubscriptionStability();
    const ok=await apply(true);if(!ok)return;installExpansionGuard();loadReferenceOffers();button.dataset.tccOverlayReplay='1';
    try{if(typeof window.compare==='function')await window.compare();else if(typeof compare==='function')await compare()}finally{delete button.dataset.tccOverlayReplay}
  },true);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{installConfigurationMetadataGuard();markRevision();loadReferenceOffers();loadFastnedStationOverlay();loadFreshmileDirect();loadLaBorneBleueDirect();loadLaBorneBleueExplicitFallback();loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();loadSubscriptionStability()},0),{once:true});
  else setTimeout(()=>{installConfigurationMetadataGuard();markRevision();loadReferenceOffers();loadFastnedStationOverlay();loadFreshmileDirect();loadLaBorneBleueDirect();loadLaBorneBleueExplicitFallback();loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();loadSubscriptionStability()},0);

  window.TCCV8OverlayAreaBridge={apply,installExpansionGuard,installConfigurationMetadataGuard,loadReferenceOffers,loadFastnedStationOverlay,loadFreshmileDirect,loadLaBorneBleueDirect,loadLaBorneBleueExplicitFallback,loadCanonicalStationOverlay,loadDirectResolverUi,loadDirectSmokeFix,loadTariffDisplay,loadSubscriptionStability,revision:REVISION};
  console.info('[TCC V8] Pont overlay/cache rc48bn actif + métadonnées de configuration préservées avant simulation.');
})();