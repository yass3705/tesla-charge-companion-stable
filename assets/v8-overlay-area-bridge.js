// Tesla Charge Companion V8 RC4.8 — pont déterministe overlay tarifs -> cache de zone.
(function(){
  'use strict';
  const REVISION='rc48x';
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

  // Dernier garde-fou juste avant la simulation : expandConfigurations est la
  // frontière exacte entre une station physique et ses variantes tarifaires.
  // On y réapplique donc l'overlay de façon synchrone, une station à la fois.
  // Cela couvre aussi les stations ajoutées/normalisées après la création du cache.
  function installExpansionGuard(){
    const current=window.expandConfigurations;
    if(typeof current!=='function'||current.__tccOverlayExpansionGuard)return false;
    const wrapped=function(baseStations){
      let source=baseStations;
      const api=window.TCCV8OperatorOverlay;
      const overlay=window.TCC_TARIFF_OVERLAY_V1;
      if(Array.isArray(baseStations)&&overlay&&typeof api?.addOperatorOffers==='function'){
        source=baseStations.map(st=>api.addOperatorOffers(st,overlay));
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
      banner.textContent=`V8 Preview · RC4.8 · ${REVISION} · multi-tarifs · auto-mise à jour désactivée`;
    }
  }

  // Première synchronisation dès que le cache de zone existe.
  const timer=setInterval(()=>{apply(false);installExpansionGuard();markRevision();},120);
  setTimeout(()=>clearInterval(timer),120000);

  // Avant chaque simulation, réappliquer une fois l'overlay. C'est volontairement
  // idempotent : cela permet de prendre en compte une normalisation tardive du nom
  // opérateur sans dupliquer les offres déjà présentes.
  document.addEventListener('click',async event=>{
    const button=event.target?.closest?.('.v8-simulate');
    if(!button||button.dataset.tccOverlayReplay==='1')return;
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    if(!prepared)return;
    event.preventDefault();event.stopImmediatePropagation();
    const ok=await apply(true);
    if(!ok)return;
    installExpansionGuard();
    button.dataset.tccOverlayReplay='1';
    try{
      if(typeof window.compare==='function')await window.compare();
      else if(typeof compare==='function')await compare();
    }finally{delete button.dataset.tccOverlayReplay;}
  },true);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(markRevision,0),{once:true});
  else setTimeout(markRevision,0);

  window.TCCV8OverlayAreaBridge={apply,installExpansionGuard,revision:REVISION};
  console.info('[TCC V8] Pont overlay/cache actif + garde-fou expandConfigurations rc48x.');
})();
