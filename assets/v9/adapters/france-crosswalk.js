(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.franceCrosswalk=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const uniq=xs=>[...new Set((xs||[]).map(text).filter(Boolean))];

  function normalizeEntry(raw){
    const canonicalId=text(raw?.canonicalId||raw?.irveCanonicalId||raw?.stationCanonicalId);
    if(!canonicalId)return null;
    const aliases=uniq([
      ...(raw?.aliases||[]),
      raw?.idStationItinerance&&`irve-station:${raw.idStationItinerance}`,
      ...(raw?.idPdcItinerance||raw?.pdcIds||[]).map?.(x=>`irve-pdc:${x}`)||[],
      ...(raw?.sourceIds||[]).map(x=>`${text(x.source)}:${text(x.id)}`)
    ]);
    return{canonicalId,aliases,sourceStationId:text(raw?.idStationItinerance||raw?.stationId||canonicalId),updatedAt:raw?.updatedAt||null};
  }

  function normalizePayload(payload){
    const rows=Array.isArray(payload)?payload:(payload?.entries||payload?.crosswalk||[]);
    return{stationFragments:rows.map(normalizeEntry).filter(Boolean),metadata:{generatedAt:payload?.generatedAt||null,schemaVersion:payload?.schemaVersion||1}};
  }

  function createLoader({url,fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for France crosswalk adapter');
    return async function(){
      const r=await f(url,{cache:'no-cache'});if(!r.ok)throw new Error(`France crosswalk unavailable (${r.status})`);
      return normalizePayload(await r.json());
    };
  }
  return{normalizeEntry,normalizePayload,createLoader};
});