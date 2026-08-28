// TCC — reload the latest same-origin DOT-NL snapshot already published by the data workflow.
(function(){
  'use strict';
  const BUTTON_ID='netherlandsRefreshButton';
  const STATUS_ID='netherlandsRefreshStatus';

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
  window.refreshNetherlandsNationalData=refreshNetherlandsNationalData;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installControl,{once:true});else installControl();
})();
