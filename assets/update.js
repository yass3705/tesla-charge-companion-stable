// Tesla Charge Companion — Home Screen web app update checker.
// Keeps an already-installed iOS Home Screen web app current without deleting
// and re-adding its icon. A tiny version file is fetched without cache; when a
// newer build is published, navigation switches to a versioned URL so WebKit
// cannot reuse the stale main document.
(function(){
  const meta=document.querySelector('meta[name="tcc-build"]');
  const current=String(meta?.content||'').trim();
  if(!current)return;

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
      if(!remote||remote===current)return false;

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

  // Opening/resuming the Home Screen app is the important path on iOS.
  window.addEventListener('pageshow',()=>setTimeout(checkForUpdate,250));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')setTimeout(checkForUpdate,250);
  });
  window.addEventListener('online',checkForUpdate);

  // Long-running sessions also get updated without requiring a restart.
  setInterval(checkForUpdate,5*60*1000);

  window.tccCheckForAppUpdate=checkForUpdate;
})();
