// Tesla Charge Companion V8 — garde-fou de synchronisation des anciennes bornes FR.
(function(){
  'use strict';
  const LEGACY_IDS=new Set([
    'alize-galard',
    'station-1786227827538',
    'izivia-levant',
    'lidl-saint-cyr',
    'one-nation',
    'station-1784992892709'
  ]);
  const TOMBSTONE='2026-08-18T14:40:51.900152Z';
  const isLegacy=st=>LEGACY_IDS.has(String(st?.id||''));

  function sanitizeState(state){
    const cloud=typeof parseCustomCloudData==='function'?parseCustomCloudData(state):{
      schemaVersion:Number(state?.schemaVersion||2),updatedAt:state?.updatedAt||'',lastDevice:state?.lastDevice||'',stations:Array.isArray(state?.stations)?state.stations:[],deletedIds:state?.deletedIds||{}
    };
    const deleted={...(cloud.deletedIds||{})};
    for(const id of LEGACY_IDS){
      const current=Date.parse(deleted[id]||'');
      if(!Number.isFinite(current)||current<Date.parse(TOMBSTONE))deleted[id]=TOMBSTONE;
    }
    return {...cloud,stations:(cloud.stations||[]).filter(st=>!isLegacy(st)),deletedIds:deleted};
  }

  if(typeof customStationsForSync==='function'){
    const originalCustomStationsForSync=customStationsForSync;
    customStationsForSync=function(){return (originalCustomStationsForSync()||[]).filter(st=>!isLegacy(st));};
  }

  if(typeof mergeCustomCloudStates==='function'){
    const originalMergeCustomCloudStates=mergeCustomCloudStates;
    mergeCustomCloudStates=function(remote){
      const merged=originalMergeCustomCloudStates(sanitizeState(remote));
      const cleaned=sanitizeState(merged);
      cleaned.updatedAt=merged.updatedAt;
      cleaned.lastDevice=merged.lastDevice;
      return cleaned;
    };
  }

  if(typeof applyMergedCustomState==='function'){
    const originalApplyMergedCustomState=applyMergedCustomState;
    applyMergedCustomState=function(state){return originalApplyMergedCustomState(sanitizeState(state));};
  }

  window.TCCV8SyncGuard={legacyIds:[...LEGACY_IDS],sanitizeState};
  console.info('[TCC V8] Garde-fou synchro legacy France actif.');
})();
