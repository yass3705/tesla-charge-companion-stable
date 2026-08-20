// Tesla Charge Companion V8 RC4.8 — pont déterministe overlay tarifs -> cache de zone.
(function(){
  'use strict';
  let applying=false;
  let lastPrepared=null;

  async function apply(force=false){
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    const api=window.TCCV8OperatorOverlay;
    if(!prepared||!api?.applyToPrepared||applying)return false;
    if(!force&&prepared===lastPrepared&&prepared.tariffOverlayApplied)return true;
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

  // Première synchronisation dès que le cache de zone existe.
  const timer=setInterval(()=>{apply(false);},120);
  setTimeout(()=>clearInterval(timer),120000);

  // Avant chaque simulation, réappliquer une fois l'overlay. C'est volontairement
  // idempotent : cela permet de prendre en compte une normalisation tardive du nom
  // opérateur (ex. SIGEIF) sans dupliquer les offres déjà présentes.
  document.addEventListener('click',async event=>{
    const button=event.target?.closest?.('.v8-simulate');
    if(!button||button.dataset.tccOverlayReplay==='1')return;
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    if(!prepared)return;
    event.preventDefault();event.stopImmediatePropagation();
    const ok=await apply(true);
    if(!ok)return;
    button.dataset.tccOverlayReplay='1';
    try{
      if(typeof window.compare==='function')await window.compare();
      else if(typeof compare==='function')await compare();
    }finally{delete button.dataset.tccOverlayReplay;}
  },true);

  window.TCCV8OverlayAreaBridge={apply};
  console.info('[TCC V8] Pont overlay/cache de zone actif, rafraîchissement forcé avant simulation.');
})();
