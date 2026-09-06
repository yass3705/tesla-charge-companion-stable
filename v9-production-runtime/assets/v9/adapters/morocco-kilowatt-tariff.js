(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoKilowattTariff=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const uniq=values=>[...new Set((values||[]).map(text).filter(Boolean))];

  async function fetchJson(url,fetchImpl){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);
    if(!f)throw new Error('fetch unavailable');
    const response=await f(url,{cache:'no-cache'});
    if(!response.ok)throw new Error(`resource unavailable (${response.status}): ${url}`);
    return response.json();
  }

  function validateManifest(manifest){
    if(Number(manifest?.schemaVersion)!==1)throw new Error('Kilowatt tariff manifest schemaVersion must be 1');
    if(text(manifest?.countryCode)!=='MA')throw new Error('Kilowatt tariff manifest country must be MA');
    if(text(manifest?.network)!=='Kilowatt')throw new Error('Kilowatt tariff manifest network mismatch');

    const policy=manifest?.policy||{},summary=manifest?.summary||{};
    if(policy.stationSpecificFreeOnly!==true)throw new Error('Kilowatt free tariff must be station-specific');
    if(policy.missingTariffDoesNotMeanFree!==true)throw new Error('Kilowatt missing tariff must fail closed');
    if(policy.cityOnlyPaidRuleRejected!==true)throw new Error('Kilowatt city-only paid rule must remain rejected');
    if(text(policy.cpoOperator)!=='Kilowatt')throw new Error('Kilowatt tariff manifest CPO mismatch');
    if(text(policy.tariffChannel)!=='Kilowatt direct/public access')throw new Error('Kilowatt tariff channel mismatch');
    if(text(policy.currency)!=='MAD')throw new Error('Kilowatt tariff manifest currency mismatch');

    const free=uniq(manifest?.freeStationIds),unresolved=uniq(manifest?.unresolvedStationIds);
    if(free.length!==26||unresolved.length!==17)throw new Error(`Kilowatt tariff manifest expected 26/17, got ${free.length}/${unresolved.length}`);
    const overlap=free.filter(id=>unresolved.includes(id));
    if(overlap.length)throw new Error(`Kilowatt tariff manifest overlap: ${overlap.join(',')}`);
    if(new Set([...free,...unresolved]).size!==43)throw new Error('Kilowatt tariff manifest must cover exactly 43 production stations');
    if(Number(summary.productionStations)!==43||Number(summary.free)!==26||Number(summary.unresolved)!==17)throw new Error('Kilowatt tariff manifest summary mismatch');

    return{freeStationIds:free,unresolvedStationIds:unresolved,policy,summary,validatedArtifact:manifest?.validatedArtifact||null};
  }

  function offerRulesFromManifest(manifest){
    const checked=validateManifest(manifest),digest=text(checked.validatedArtifact?.digest)||null;
    return checked.freeStationIds.map(stationId=>({
      id:`kilowatt-free:${stationId}`,
      provider:'Kilowatt direct',
      offerKind:'direct',
      countries:['MA'],
      operatorIds:['kilowatt'],
      stationIds:[stationId,`kilowatt-station:${stationId}`,`MA:kilowatt:${stationId}`],
      currency:'MAD',
      pricing:{type:'rules',rules:[{scope:'allDay',billing:'kwh',currency:'MAD',pricePerKwh:0}]},
      metadata:{
        tariffChannel:'Kilowatt direct/public access',
        evidencePolicy:'station_specific_public_free_evidence',
        stationSpecificEvidence:true,
        missingTariffDoesNotMeanFree:true,
        validatedArtifactDigest:digest
      }
    }));
  }

  function createLoader({url,fetchImpl}={}){
    if(!text(url))throw new Error('Kilowatt tariff manifest URL missing');
    return async function(){
      const manifest=await fetchJson(url,fetchImpl);
      return{offerRules:offerRulesFromManifest(manifest)};
    };
  }

  return{validateManifest,offerRulesFromManifest,createLoader};
});
