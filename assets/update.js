// Tesla Charge Companion — Home Screen update checker + August release loader.
(function(){
  const CURRENT_BUILD='8001';
  const meta=document.querySelector('meta[name="tcc-build"]');
  if(meta)meta.content=CURRENT_BUILD;

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
    script.src=`assets/august-release.js?v=${CURRENT_BUILD}`;
    script.dataset.tccAugust='1';
    script.onload=()=>console.info('[TCC] August release layer loaded.');
    script.onerror=()=>console.error('[TCC] August release layer could not be loaded.');
    document.body.appendChild(script);
  }

  // Deferred scripts execute before DOMContentLoaded. Loading here guarantees
  // app.js and dedupe.js are already installed before the August overrides run.
  document.addEventListener('DOMContentLoaded',()=>setTimeout(loadAugustRelease,0),{once:true});

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
