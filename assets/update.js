// Tesla Charge Companion — robust Home Screen / PWA update checker.
// Build 7306 fixes stale iOS Home Screen installations without requiring the icon to be deleted.
(function(){
  'use strict';

  const CURRENT_BUILD='7306';
  const CURRENT_CACHE=`tcc-v${CURRENT_BUILD}-stable`;
  const meta=document.querySelector('meta[name="tcc-build"]');
  if(meta)meta.content=CURRENT_BUILD;

  let checking=false;
  let registrationPromise=null;

  async function registerWorker(){
    if(!('serviceWorker' in navigator))return null;
    if(registrationPromise)return registrationPromise;
    registrationPromise=(async()=>{
      try{
        const reg=await navigator.serviceWorker.register(`./service-worker.js?v=${CURRENT_BUILD}`,{updateViaCache:'none'});
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
    if(!('caches' in window))return;
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
    if(checking||!navigator.onLine)return false;
    checking=true;
    try{
      const response=await fetch(`app-version.json?_=${Date.now()}`,{
        cache:'no-store',
        headers:{'Cache-Control':'no-cache, no-store, must-revalidate'}
      });
      if(!response.ok)return false;
      const payload=await response.json();
      const remote=String(payload?.build||'').trim();
      if(!remote)return false;

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

  // Register as early as possible so the next navigation is controlled by the worker.
  registerWorker();

  // Test-branch bootstrap for the DOT-NL national catalogue. It runs only after
  // the regular deferred scripts (app + France catalogue) have initialized, so
  // the Netherlands loader can safely chain candidateStations without changing
  // the production main branch boot order.
  window.addEventListener('DOMContentLoaded',()=>{
    if(document.querySelector('script[data-tcc-netherlands-catalog]'))return;
    const script=document.createElement('script');
    script.src='assets/netherlands-catalog.js?v=1';
    script.dataset.tccNetherlandsCatalog='1';
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
    await registerWorker();
    await clearOldAppCaches();
    location.replace(versionedUrl(CURRENT_BUILD));
  };
})();
