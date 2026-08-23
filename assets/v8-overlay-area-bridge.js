// Tesla Charge Companion V8 RC4.8 — pont déterministe overlays tarifs -> cache de zone.
(function(){
  'use strict';
  const REVISION='rc48ba-ui-stable';
  let applying=false;
  let lastPrepared=null;

  function loadReferenceOffers(){
    if(!window.TCCV8ReferenceOffers&&!document.querySelector('script[data-tcc-reference-offers]')){
      const s=document.createElement('script');
      s.src='assets/v8-reference-offers.js?v=20260821q1';
      s.defer=true;s.dataset.tccReferenceOffers='1';
      document.head.appendChild(s);
    }
    if(!window.TCCV8IDFExtraReferenceOffers&&!document.querySelector('script[data-tcc-idf-extra-reference-offers]')){
      const x=document.createElement('script');
      x.src='assets/v8-idf-extra-reference-offers.js?v=20260821q1';
      x.defer=true;x.dataset.tccIdfExtraReferenceOffers='1';
      document.head.appendChild(x);
    }
  }

  function loadCanonicalStationOverlay(){
    if(!window.TCCV8CanonicalStationOverlay&&!document.querySelector('script[data-tcc-canonical-stations]')){
      const s=document.createElement('script');
      s.src='assets/v8-canonical-station-overlay.js?v=rc48ar-20260822';
      s.defer=true;s.dataset.tccCanonicalStations='1';
      document.head.appendChild(s);
    }
  }

  function loadDirectResolverUi(){
    if(!window.TCCV8DirectResolver&&!document.querySelector('script[data-tcc-direct-resolver-ui]')){
      const s=document.createElement('script');
      s.src='assets/v8-direct-resolver-ui.js?v=rc48bc-20260823';
      s.defer=true;s.dataset.tccDirectResolverUi='1';
      document.head.appendChild(s);
    }
  }

  function loadDirectSmokeFix(){
    if(!window.TCCV8DirectSmokeFix&&!document.querySelector('script[data-tcc-direct-smoke-fix]')){
      const s=document.createElement('script');
      s.src='assets/v8-direct-resolver-followup.js?v=rc48av-20260822';
      s.defer=true;s.dataset.tccDirectSmokeFix='1';
      document.head.appendChild(s);
    }
  }

  function loadTariffDisplay(){
    if(!window.TCCV8TariffDisplay&&!document.querySelector('script[data-tcc-tariff-display]')){
      const s=document.createElement('script');
      s.src='assets/v8-tariff-display-fix.js?v=rc48au-20260822';
      s.defer=true;s.dataset.tccTariffDisplay='1';
      document.head.appendChild(s);
    }
  }

  loadReferenceOffers();
  loadCanonicalStationOverlay();
  loadDirectResolverUi();
  loadDirectSmokeFix();
  loadTariffDisplay();

  async function apply(force=false){
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    const operatorApi=window.TCCV8OperatorOverlay;
    const canonicalApi=window.TCCV8CanonicalStationOverlay;
    if(!prepared||!operatorApi?.applyToPrepared||applying)return false;
    const canonicalReady=!!canonicalApi?.applyToPrepared;
    if(!force&&prepared===lastPrepared&&prepared.tariffOverlayApplied&&(!canonicalReady||prepared.canonicalStationOverlayApplied))return true;
    applying=true;
    try{
      await operatorApi.applyToPrepared(prepared);
      if(canonicalReady)await canonicalApi.applyToPrepared(prepared);
      lastPrepared=prepared;
      window.TCC_V8_AREA_CACHE.prepared=prepared;
      return true;
    }catch(err){
      console.warn('[TCC V8] Pont overlay/cache indisponible :',err?.message||err);
      return false;
    }finally{applying=false;}
  }

  // Dernier garde-fou juste avant la simulation : expandConfigurations est la
  // frontière exacte entre une station physique et ses variantes tarifaires.
  // On y réapplique les overlays de façon synchrone, une station à la fois.
  function installExpansionGuard(){
    const current=window.expandConfigurations;
    if(typeof current!=='function'||current.__tccOverlayExpansionGuard)return false;
    const wrapped=function(baseStations){
      let source=baseStations;
      const operatorApi=window.TCCV8OperatorOverlay;
      const overlay=window.TCC_TARIFF_OVERLAY_V1;
      const canonicalApi=window.TCCV8CanonicalStationOverlay;
      const canonicalData=window.TCC_V8_CANONICAL_STATION_OVERLAY;
      if(Array.isArray(source)&&overlay&&typeof operatorApi?.addOperatorOffers==='function'){
        source=source.map(st=>operatorApi.addOperatorOffers(st,overlay));
      }
      if(Array.isArray(source)&&canonicalData&&typeof canonicalApi?.applyStation==='function'){
        source=source.map(st=>canonicalApi.applyStation(st,canonicalData));
      }
      return current.call(this,source);
    };
    wrapped.__tccOverlayExpansionGuard=true;
    wrapped.__tccOriginal=current;
    window.expandConfigurations=wrapped;
    try{expandConfigurations=wrapped}catch(e){}
    return true;
  }

  function markRevision(){
    const banner=document.getElementById('tccPreviewBanner');
    if(banner&&/RC4\.8/.test(String(banner.textContent||''))){
      banner.textContent=`V8 Preview · RC4.8 · ${REVISION} · tarif direct prioritaire · détail frais stabilisé · données canoniques France · auto-mise à jour désactivée`;
    }
  }

  const timer=setInterval(()=>{
    loadCanonicalStationOverlay();
    loadDirectResolverUi();
    loadDirectSmokeFix();
    loadTariffDisplay();
    apply(false);
    installExpansionGuard();
    markRevision();
    loadReferenceOffers();
  },120);
  setTimeout(()=>clearInterval(timer),120000);

  document.addEventListener('click',async event=>{
    const button=event.target?.closest?.('.v8-simulate');
    if(!button||button.dataset.tccOverlayReplay==='1')return;
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    if(!prepared)return;
    event.preventDefault();event.stopImmediatePropagation();
    loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();
    const ok=await apply(true);
    if(!ok)return;
    installExpansionGuard();loadReferenceOffers();
    button.dataset.tccOverlayReplay='1';
    try{
      if(typeof window.compare==='function')await window.compare();
      else if(typeof compare==='function')await compare();
    }finally{delete button.dataset.tccOverlayReplay;}
  },true);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{markRevision();loadReferenceOffers();loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();},0),{once:true});
  else setTimeout(()=>{markRevision();loadReferenceOffers();loadCanonicalStationOverlay();loadDirectResolverUi();loadDirectSmokeFix();loadTariffDisplay();},0);

  window.TCCV8OverlayAreaBridge={apply,installExpansionGuard,loadReferenceOffers,loadCanonicalStationOverlay,loadDirectResolverUi,loadDirectSmokeFix,loadTariffDisplay,revision:REVISION};
  console.info('[TCC V8] Pont overlay/cache actif + direct resolver rc48av.');
})();