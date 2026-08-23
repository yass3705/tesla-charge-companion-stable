// Tesla Charge Companion — Home Screen update checker + August release loader.
(function(){
  const CURRENT_BUILD='8004';
  const meta=document.querySelector('meta[name="tcc-build"]');
  if(meta)meta.content=CURRENT_BUILD;

  function loadAugustRc2Fixes(){
    if(document.querySelector('script[data-tcc-august-rc2]'))return;
    const fixes=document.createElement('script');
    fixes.src=`assets/august-rc2-fixes.js?v=${CURRENT_BUILD}`;
    fixes.dataset.tccAugustRc2='1';
    fixes.onerror=()=>console.error('[TCC] August RC2 fixes could not be loaded.');
    document.body.appendChild(fixes);
  }

  function loadAugustUiFixes(){
    if(document.querySelector('script[data-tcc-august-fixes]'))return;
    const fixes=document.createElement('script');
    fixes.src=`assets/august-ui-fixes.js?v=${CURRENT_BUILD}`;
    fixes.dataset.tccAugustFixes='1';
    fixes.onload=loadAugustRc2Fixes;
    fixes.onerror=()=>{
      console.error('[TCC] August UI fixes could not be loaded.');
      loadAugustRc2Fixes();
    };
    document.body.appendChild(fixes);
  }

  function loadValidatedRegionalPatches(){
    if(document.querySelector('script[data-tcc-ecocharge77]'))return;
    const script=document.createElement('script');
    script.src='assets/v8-ecocharge77-overlay.js?v=20260821a';
    script.dataset.tccEcocharge77='1';
    script.onload=()=>console.info('[TCC] Ecocharge77 validated tariff overlay loaded.');
    script.onerror=()=>console.error('[TCC] Ecocharge77 validated tariff overlay could not be loaded.');
    document.body.appendChild(script);
  }

  function loadAugustRelease(){
    if(document.querySelector('script[data-tcc-august]'))return;
    if(!document.querySelector('link[data-tcc-august]')){
      const css=document.createElement('link');
      css.rel='stylesheet';
      css.href=`assets/august-release.css?v=${CURRENT_BUILD}`;
      css.dataset.tccAugust='1';
      document.head.appendChild(css);
    }
    const script=document.createElement('script');
    script.src='assets/august-release.js?v=rc48bg-20260823';
    script.dataset.tccAugust='1';
    script.onload=()=>{
      console.info('[TCC] August release layer loaded.');
      loadValidatedRegionalPatches();
      loadAugustUiFixes();
    };
    script.onerror=()=>{
      console.error('[TCC] August release layer could not be loaded.');
      loadValidatedRegionalPatches();
    };
    document.body.appendChild(script);
  }

  // Deferred scripts execute before DOMContentLoaded. Loading here guarantees
  // app.js and dedupe.js are already installed before the August overrides run.
  document.addEventListener('DOMContentLoaded',()=>setTimeout(loadAugustRelease,0),{once:true});

  // Register the PWA worker explicitly. The manifest alone does not install it.
  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('./service-worker.js')
        .then(reg=>reg.update().catch(()=>{}))
        .catch(err=>console.info('[TCC] Service worker unavailable:',err?.message||err));
    },{once:true});
  }

  let checking=false;
  async function checkForUpdate(){
    if(checking||!navigator.onLine)return false;
    checking=true;
    try{
      const response=await fetch(`app-version.json?_=${Date.now()}`,{
        cache:'no-store',
        headers:{'Cache-Control':'no-cache'}
      });
      if(!response.ok)return false;
      const payload=await response.json();
      const remote=String(payload?.build||'').trim();
      if(!remote||remote===CURRENT_BUILD)return false;

      const url=new URL(location.href);
      url.searchParams.set('app',remote);
      url.searchParams.set('_refresh',String(Date.now()));
      location.replace(url.href);
      return true;
    }catch(err){
      console.info('[TCC] Update check unavailable:',err?.message||err);
      return false;
    }finally{
      checking=false;
    }
  }

  window.addEventListener('pageshow',()=>setTimeout(checkForUpdate,250));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')setTimeout(checkForUpdate,250);
  });
  window.addEventListener('online',checkForUpdate);
  setInterval(checkForUpdate,5*60*1000);

  window.tccCheckForAppUpdate=checkForUpdate;
})();
