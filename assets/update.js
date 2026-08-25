// Tesla Charge Companion — Home Screen update checker + August release loader.
(function(){
  const CURRENT_BUILD='8004';
  const meta=document.querySelector('meta[name="tcc-build"]');
  if(meta)meta.content=CURRENT_BUILD;

  if(window.TCC_PREVIEW){
    const proto=Storage.prototype;
    const previousSetItem=proto.setItem;
    const previousRemoveItem=proto.removeItem;
    try{previousRemoveItem.call(window.localStorage,'tccStationsV701');}catch(e){}
    proto.setItem=function(key,value){
      if(this===window.localStorage&&String(key)==='tccStationsV701'){
        try{
          const parsed=JSON.parse(String(value||'[]'));
          const compact=Array.isArray(parsed)?parsed.filter(st=>st&&(st.source==='custom'||st._syncUpdatedAt||st.syncUpdatedAt||st.temporarilyUnavailable===true)):[];
          return previousSetItem.call(this,key,JSON.stringify(compact));
        }catch(err){
          if(err?.name==='QuotaExceededError'||/quota/i.test(String(err?.message||err))){
            try{previousRemoveItem.call(this,key);}catch(e){}
            console.info('[TCC V8] Catalogue complet non mis en cache : quota localStorage atteint.');
            return;
          }
          throw err;
        }
      }
      return previousSetItem.call(this,key,value);
    };
  }

  function loadAugustRc2Fixes(){
    if(document.querySelector('script[data-tcc-august-rc2]'))return;
    const fixes=document.createElement('script');fixes.src=`assets/august-rc2-fixes.js?v=${CURRENT_BUILD}`;fixes.dataset.tccAugustRc2='1';fixes.onerror=()=>console.error('[TCC] August RC2 fixes could not be loaded.');document.body.appendChild(fixes);
  }
  function loadAugustUiFixes(){
    if(document.querySelector('script[data-tcc-august-fixes]'))return;
    const fixes=document.createElement('script');fixes.src=`assets/august-ui-fixes.js?v=${CURRENT_BUILD}`;fixes.dataset.tccAugustFixes='1';fixes.onload=loadAugustRc2Fixes;fixes.onerror=()=>{console.error('[TCC] August UI fixes could not be loaded.');loadAugustRc2Fixes();};document.body.appendChild(fixes);
  }
  function loadValidatedRegionalPatches(){
    if(document.querySelector('script[data-tcc-ecocharge77]'))return;
    const script=document.createElement('script');script.src='assets/v8-ecocharge77-overlay.js?v=20260821a';script.dataset.tccEcocharge77='1';script.onload=()=>console.info('[TCC] Ecocharge77 validated tariff overlay loaded.');script.onerror=()=>console.error('[TCC] Ecocharge77 validated tariff overlay could not be loaded.');document.body.appendChild(script);
  }
  function loadSubscriptionStability(){
    if(window.TCCV8SubscriptionStability||document.querySelector('script[data-tcc-subscription-stability]'))return;
    const script=document.createElement('script');script.src='assets/v8-subscription-stability-fix.js?v=rc48bm-20260825';script.dataset.tccSubscriptionStability='1';script.onload=()=>console.info('[TCC] Subscription selector runtime loaded.');script.onerror=()=>console.error('[TCC] Subscription selector runtime could not be loaded.');document.body.appendChild(script);
  }
  function loadLaBorneBleueResultGuard(){
    if(window.TCCV8LaBorneBleueResultGuard||document.querySelector('script[data-tcc-labornebleue-result-guard]'))return;
    const script=document.createElement('script');
    script.src='assets/v8-labornebleue-result-guard.js?v=rc48bq-20260825';
    script.dataset.tccLabornebleueResultGuard='1';
    script.onload=()=>console.info('[TCC] La Borne Bleue rendered-card guard loaded.');
    script.onerror=()=>console.error('[TCC] La Borne Bleue rendered-card guard could not be loaded.');
    document.body.appendChild(script);
  }
  function loadLaBorneBleueExplicitFallback(){
    if(window.TCCV8LaBorneBleueExplicitFallback||document.querySelector('script[data-tcc-labornebleue-explicit-fallback]'))return;
    const script=document.createElement('script');
    script.src='assets/v8-labornebleue-operator-fallback.js?v=rc48bm-20260825';
    script.dataset.tccLabornebleueExplicitFallback='1';
    script.onload=()=>console.info('[TCC] La Borne Bleue runtime guard loaded.');
    script.onerror=()=>console.error('[TCC] La Borne Bleue runtime guard could not be loaded.');
    document.body.appendChild(script);
  }
  function loadLaBorneBleueDirect(){
    loadLaBorneBleueExplicitFallback();loadLaBorneBleueResultGuard();
    if(window.TCCV8LaBorneBleueDirect||document.querySelector('script[data-tcc-labornebleue-direct]'))return;
    const script=document.createElement('script');
    script.src='assets/v8-labornebleue-direct-overlay.js?v=rc48-labornebleue-20260825d';
    script.dataset.tccLabornebleueDirect='1';
    script.onload=()=>{console.info('[TCC] La Borne Bleue direct strict loaded.');loadLaBorneBleueExplicitFallback();loadLaBorneBleueResultGuard();};
    script.onerror=()=>{console.error('[TCC] La Borne Bleue direct strict could not be loaded.');loadLaBorneBleueExplicitFallback();loadLaBorneBleueResultGuard();};
    document.body.appendChild(script);
  }
  function loadAugustRelease(){
    loadLaBorneBleueExplicitFallback();loadLaBorneBleueResultGuard();loadSubscriptionStability();
    if(document.querySelector('script[data-tcc-august]')){loadLaBorneBleueDirect();return;}
    if(!document.querySelector('link[data-tcc-august]')){const css=document.createElement('link');css.rel='stylesheet';css.href=`assets/august-release.css?v=${CURRENT_BUILD}`;css.dataset.tccAugust='1';document.head.appendChild(css);}
    const script=document.createElement('script');script.src='assets/august-release.js?v=rc48bl-20260824';script.dataset.tccAugust='1';
    script.onload=()=>{console.info('[TCC] August release layer loaded.');loadValidatedRegionalPatches();loadAugustUiFixes();loadLaBorneBleueDirect();loadSubscriptionStability();loadLaBorneBleueResultGuard();};
    script.onerror=()=>{console.error('[TCC] August release layer could not be loaded.');loadValidatedRegionalPatches();loadLaBorneBleueDirect();loadSubscriptionStability();loadLaBorneBleueResultGuard();};
    document.body.appendChild(script);
  }

  document.addEventListener('DOMContentLoaded',()=>{loadLaBorneBleueResultGuard();setTimeout(loadAugustRelease,0);},{once:true});

  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{navigator.serviceWorker.register('./service-worker.js').then(reg=>reg.update().catch(()=>{})).catch(err=>console.info('[TCC] Service worker unavailable:',err?.message||err));},{once:true});
  }

  let checking=false;
  async function checkForUpdate(){
    if(checking||!navigator.onLine)return false;checking=true;
    try{const response=await fetch(`app-version.json?_=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});if(!response.ok)return false;const payload=await response.json();const remote=String(payload?.build||'').trim();if(!remote||remote===CURRENT_BUILD)return false;const url=new URL(location.href);url.searchParams.set('app',remote);url.searchParams.set('_refresh',String(Date.now()));location.replace(url.href);return true;}catch(err){console.info('[TCC] Update check unavailable:',err?.message||err);return false;}finally{checking=false}
  }
  window.addEventListener('pageshow',()=>setTimeout(checkForUpdate,250));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(checkForUpdate,250)});
  window.addEventListener('online',checkForUpdate);setInterval(checkForUpdate,5*60*1000);window.tccCheckForAppUpdate=checkForUpdate;
})();