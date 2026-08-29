// TCC — reload the latest same-origin DOT-NL snapshot already published by the data workflow.
(function(){
  'use strict';
  const BUTTON_ID='netherlandsRefreshButton';
  const STATUS_ID='netherlandsRefreshStatus';
  let tariffOverlayPromise=null;

  function ensureTariffOverlay(){
    if(window.TCCNetherlandsTariffs)return Promise.resolve(window.TCCNetherlandsTariffs);
    if(!tariffOverlayPromise)tariffOverlayPromise=new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-tcc-netherlands-tariffs]');
      if(existing){
        existing.addEventListener('load',()=>resolve(window.TCCNetherlandsTariffs),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Impossible de charger les tarifs Pays-Bas')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src='assets/v8-netherlands-tariffs.js?v=20260829a';
      script.defer=true;script.dataset.tccNetherlandsTariffs='1';
      script.onload=()=>window.TCCNetherlandsTariffs?resolve(window.TCCNetherlandsTariffs):reject(new Error('Extension tarifs Pays-Bas absente'));
      script.onerror=()=>reject(new Error('Impossible de charger les tarifs Pays-Bas'));
      document.head.appendChild(script);
    }).catch(err=>{tariffOverlayPromise=null;console.warn('[TCC] Extension tarifs Pays-Bas non chargée:',err?.message||err);return null;});
    return tariffOverlayPromise;
  }

  function setStatus(message,kind=''){
    const el=document.getElementById(STATUS_ID);if(!el)return;
    el.textContent=message;el.className=`small ${kind}`.trim();
  }
  function fmtGenerated(value){
    const d=new Date(value||'');return Number.isFinite(d.getTime())?d.toLocaleString('fr-FR'):(value||'date inconnue');
  }
  async function freshManifest(){
    const response=await fetch(`data/non_tesla_netherlands/manifest.json?_=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache, no-store, must-revalidate'}});
    if(!response.ok)throw new Error(`manifest Pays-Bas indisponible (${response.status})`);
    const m=await response.json();
    if(Number(m?.schemaVersion)!==3||m?.scope?.countryCode!=='NL'||m?.scope?.teslaExcluded!==true)throw new Error('manifest DOT-NL invalide');
    return m;
  }
  async function refreshNetherlandsNationalData(){
    const button=document.getElementById(BUTTON_ID);if(button)button.disabled=true;
    setStatus('Vérification du dernier snapshot DOT-NL publié…','warn');
    try{
      const api=window.TCCNetherlandsCatalog;
      const before=api?.loadManifest?await api.loadManifest().catch(()=>null):null;
      const latest=await freshManifest();
      api?.clearCache?.();
      const after=api?.loadManifest?await api.loadManifest():latest;
      await ensureTariffOverlay();
      window.TCCNetherlandsTariffs?.loadData?.().catch?.(()=>{});
      window.TCCNetherlandsTariffs?.applyAll?.().catch?.(()=>{});
      const changed=String(before?.generatedAt||'')!==String(after?.generatedAt||'');
      const coverage=after?.accessCoverage||{};
      setStatus(`${changed?'Snapshot Pays-Bas rechargé':'Snapshot Pays-Bas déjà à jour'} · ${Number(after?.stationCount||0).toLocaleString('fr-FR')} stations · génération ${fmtGenerated(after?.generatedAt)}${coverage.twentyFourSevenStations!=null?` · ${Number(coverage.twentyFourSevenStations).toLocaleString('fr-FR')} en 24/7`:''}`,'good');
      return {before,after,changed};
    }catch(err){
      setStatus(`Échec du rechargement Pays-Bas : ${err?.message||err}`,'bad');
      throw err;
    }finally{if(button)button.disabled=false;}
  }
  function installControl(){
    if(document.getElementById(BUTTON_ID))return;
    const route=document.getElementById('routeButton');if(!route)return;
    const button=document.createElement('button');button.id=BUTTON_ID;button.className='secondary';button.style.cssText='width:100%;margin-top:8px';button.textContent='Recharger les données Pays-Bas';button.onclick=()=>refreshNetherlandsNationalData().catch(()=>{});
    const status=document.createElement('div');status.id=STATUS_ID;status.className='small';status.style.marginTop='5px';status.textContent='Recharge le dernier snapshot DOT-NL publié (tarifs, statuts et horaires).';
    route.insertAdjacentElement('afterend',button);button.insertAdjacentElement('afterend',status);
  }
  function boot(){ensureTariffOverlay();installControl();}
  window.refreshNetherlandsNationalData=refreshNetherlandsNationalData;
  window.TCCNetherlandsRefresh={refreshNetherlandsNationalData,ensureTariffOverlay};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
