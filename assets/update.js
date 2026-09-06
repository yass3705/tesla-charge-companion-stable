// Tesla Charge Companion — robust Home Screen / PWA update checker.
// The active build is derived from the served page so future releases cannot
// drift from app-version.json or the service-worker cache namespace.
(function(){
  'use strict';

  const meta=document.querySelector('meta[name="tcc-build"]');
  const CURRENT_BUILD=String(meta?.content||'').trim();
  const CURRENT_CACHE=CURRENT_BUILD?`tcc-v${CURRENT_BUILD}-stable`:'';

  let checking=false;
  let registrationPromise=null;

  function validBuild(value){return /^\d+$/.test(String(value||''));}

  function loadProductionCanaryBootstrap(){
    if(document.querySelector('script[data-tcc-v9-production-bootstrap]'))return;
    const script=document.createElement('script');
    script.src='assets/v9-production-bootstrap.js?v=1';
    script.dataset.tccV9ProductionBootstrap='1';
    script.onerror=()=>console.info('[TCC] V9 production bootstrap unavailable; staying on stable control.');
    document.head.appendChild(script);
  }

  async function registerWorker(){
    if(!validBuild(CURRENT_BUILD)||!('serviceWorker' in navigator))return null;
    if(registrationPromise)return registrationPromise;
    registrationPromise=(async()=>{
      try{
        const reg=await navigator.serviceWorker.register(`./service-worker.js?v=${encodeURIComponent(CURRENT_BUILD)}`,{updateViaCache:'none'});
        await reg.update().catch(()=>{});
        await navigator.serviceWorker.ready.catch(()=>reg);
        return reg;
      }catch(err){
        console.info('[TCC] Service worker unavailable:',err?.message||err);
        return null;
      }
    })();
    return registrationPromise;
  }

  async function clearOldAppCaches(){
    if(!CURRENT_CACHE||!('caches' in window))return;
    try{
      const keys=await caches.keys();
      await Promise.all(keys
        .filter(key=>key.startsWith('tcc-')&&key!==CURRENT_CACHE)
        .map(key=>caches.delete(key)));
    }catch(err){
      console.info('[TCC] Cache cleanup unavailable:',err?.message||err);
    }
  }

  function versionedUrl(build){
    const url=new URL(location.href);
    url.searchParams.set('app',String(build));
    url.searchParams.set('_refresh',String(Date.now()));
    return url.href;
  }

  async function activateBuild(build){
    await registerWorker();
    await clearOldAppCaches();
    const currentUrlBuild=new URL(location.href).searchParams.get('app');
    if(currentUrlBuild!==String(build)){
      location.replace(versionedUrl(build));
      return true;
    }
    return false;
  }

  async function checkForUpdate(){
    if(checking||!navigator.onLine||!validBuild(CURRENT_BUILD))return false;
    checking=true;
    try{
      const response=await fetch(`app-version.json?_=${Date.now()}`,{
        cache:'no-store',
        headers:{'Cache-Control':'no-cache, no-store, must-revalidate'}
      });
      if(!response.ok)return false;
      const payload=await response.json();
      const remote=String(payload?.build||'').trim();
      if(!validBuild(remote))return false;

      const urlBuild=new URL(location.href).searchParams.get('app');
      if(remote!==CURRENT_BUILD||urlBuild!==remote){
        return activateBuild(remote);
      }

      await registerWorker();
      return false;
    }catch(err){
      console.info('[TCC] Update check unavailable:',err?.message||err);
      return false;
    }finally{
      checking=false;
    }
  }

  // Canary selection is external to the stable application. Loading failure is
  // intentionally harmless: the stable V7.3 control continues normally.
  loadProductionCanaryBootstrap();

  // Production bootstrap for the DOT-NL national catalogue. It runs only after
  // the regular deferred scripts (app + France catalogue) have initialized, so
  // the Netherlands loader can safely chain candidateStations without changing
  // the established stable-root boot order.
  window.addEventListener('DOMContentLoaded',()=>{
    if(document.querySelector('script[data-tcc-netherlands-catalog]'))return;
    const script=document.createElement('script');
    script.src='assets/netherlands-catalog.js?v=2';
    script.dataset.tccNetherlandsCatalog='1';
    script.onload=()=>{
      if(document.querySelector('script[data-tcc-netherlands-refresh]'))return;
      const refresh=document.createElement('script');
      refresh.src='assets/netherlands-refresh.js?v=1';
      refresh.dataset.tccNetherlandsRefresh='1';
      refresh.onerror=()=>console.warn('[TCC] Contrôle de rechargement Pays-Bas non chargé.');
      document.head.appendChild(refresh);
    };
    script.onerror=()=>console.warn('[TCC] Catalogue Pays-Bas non chargé.');
    document.head.appendChild(script);
  },{once:true});

  // Opening/resuming the Home Screen app is the key iOS path.
  window.addEventListener('pageshow',()=>setTimeout(checkForUpdate,150));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')setTimeout(checkForUpdate,150);
  });
  window.addEventListener('online',checkForUpdate);

  // Long-running sessions also receive updates.
  setInterval(checkForUpdate,5*60*1000);

  window.tccCheckForAppUpdate=checkForUpdate;
  window.tccForceAppUpdate=async function(){
    if(!validBuild(CURRENT_BUILD))return false;
    await registerWorker();
    await clearOldAppCaches();
    location.replace(versionedUrl(CURRENT_BUILD));
    return true;
  };
})();