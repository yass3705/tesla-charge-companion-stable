// Tesla Charge Companion V8 RC4.8 — pont déterministe overlay tarifs -> cache de zone.
(function(){
  'use strict';
  let applying=false;
  let lastPrepared=null;

  async function apply(){
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    const api=window.TCCV8OperatorOverlay;
    if(!prepared||!api?.applyToPrepared||applying)return false;
    if(prepared===lastPrepared&&prepared.tariffOverlayApplied)return true;
    applying=true;
    try{
      await api.applyToPrepared(prepared);
      lastPrepared=prepared;
      window.TCC_V8_AREA_CACHE.prepared=prepared;
      return true;
    }catch(err){
      console.warn('[TCC V8] Pont overlay/cache indisponible :',err?.message||err);
      return false;
    }finally{applying=false;}
  }

  // Le workflow de zone et l'overlay s'installent tous les deux tardivement.
  // On synchronise donc explicitement le cache dès qu'il apparaît, indépendamment
  // de l'ordre dans lequel les wrappers candidateStations ont été installés.
  const timer=setInterval(()=>{apply();},120);
  setTimeout(()=>clearInterval(timer),120000);

  // Sécurité supplémentaire : juste avant une simulation, s'assurer que le cache
  // contient déjà les offres directes opérateur. Si ce n'est pas encore le cas,
  // on intercepte ce seul clic puis on lance la comparaison après application.
  document.addEventListener('click',async event=>{
    const button=event.target?.closest?.('.v8-simulate');
    if(!button||button.dataset.tccOverlayReplay==='1')return;
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    if(!prepared||prepared.tariffOverlayApplied)return;
    event.preventDefault();event.stopImmediatePropagation();
    const ok=await apply();
    if(!ok)return;
    button.dataset.tccOverlayReplay='1';
    try{
      if(typeof window.compare==='function')await window.compare();
      else if(typeof compare==='function')await compare();
    }finally{delete button.dataset.tccOverlayReplay;}
  },true);

  window.TCCV8OverlayAreaBridge={apply};
  console.info('[TCC V8] Pont overlay/cache de zone actif.');
})();
