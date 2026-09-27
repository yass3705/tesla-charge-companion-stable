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
    const rawPaid=manifest?.stationTariffs&&typeof manifest.stationTariffs==='object'?manifest.stationTariffs:{};
    const paid=Object.entries(rawPaid).map(([stationId,tariff])=>({stationId:text(stationId),...(tariff||{})})).filter(x=>x.stationId);
    const paidIds=paid.map(x=>x.stationId),all=[...free,...paidIds,...unresolved];

    if(!free.length)throw new Error('Kilowatt tariff manifest must contain at least one station-specific free tariff');
    if(all.length!==43)throw new Error(`Kilowatt tariff manifest expected 43 covered stations, got ${all.length}`);
    if(new Set(all).size!==43)throw new Error('Kilowatt tariff manifest overlap between free/paid/unresolved stations');

    for(const t of paid){
      if(text(t.currency)!=='MAD')throw new Error(`Kilowatt paid tariff currency mismatch: ${t.stationId}`);
      if(t.kind==='session'){
        if(!Number.isFinite(Number(t.sessionFee))||Number(t.sessionFee)<0)throw new Error(`Kilowatt invalid session fee: ${t.stationId}`);
      }else if(t.kind==='kwh'){
        if(!Number.isFinite(Number(t.pricePerKwh))||Number(t.pricePerKwh)<0)throw new Error(`Kilowatt invalid kWh price: ${t.stationId}`);
      }else throw new Error(`Kilowatt unsupported tariff kind: ${t.stationId}`);
      if(t.postChargePerMinute!=null&&(!Number.isFinite(Number(t.postChargePerMinute))||Number(t.postChargePerMinute)<0))throw new Error(`Kilowatt invalid post-charge fee: ${t.stationId}`);
    }

    if(Number(summary.productionStations)!==43||Number(summary.free)!==free.length||Number(summary.paid||0)!==paid.length||Number(summary.unresolved)!==unresolved.length)throw new Error('Kilowatt tariff manifest summary mismatch');

    return{freeStationIds:free,paidStationTariffs:paid,unresolvedStationIds:unresolved,policy,summary,validatedArtifact:manifest?.validatedArtifact||null};
  }

  function offerRulesFromManifest(manifest){
    const checked=validateManifest(manifest),digest=text(checked.validatedArtifact?.digest)||null;
    const aliases=id=>[id,`kilowatt-station:${id}`,`MA:kilowatt:${id}`];
    const commonMetadata={
      tariffChannel:'Kilowatt direct/public access',
      stationSpecificEvidence:true,
      missingTariffDoesNotMeanFree:true,
      validatedArtifactDigest:digest
    };

    const freeRules=checked.freeStationIds.map(stationId=>({
      id:`kilowatt-free:${stationId}`,
      provider:'Kilowatt direct',
      offerKind:'direct',
      countries:['MA'],
      operatorIds:['kilowatt'],
      stationIds:aliases(stationId),
      currency:'MAD',
      pricingModelId:'kilowatt-free',
      pricing:{type:'rules',rules:[{scope:'allDay',billing:'kwh',currency:'MAD',pricePerKwh:0}]},
      metadata:{...commonMetadata,evidencePolicy:'station_specific_public_free_evidence'}
    }));

    const paidRules=checked.paidStationTariffs.map(t=>{
      const rule={scope:'allDay',currency:'MAD'};
      if(t.kind==='session'){rule.billing='session';rule.sessionFeeEur=Number(t.sessionFee);}
      else{rule.billing='kwh';rule.pricePerKwh=Number(t.pricePerKwh);}
      const pricing={type:'rules',rules:[rule]};
      if(t.postChargePerMinute!=null)pricing.postChargeFee={graceMinutes:0,eurPerMinute:Number(t.postChargePerMinute)};
      return{
        id:`kilowatt-paid:${t.stationId}`,
        provider:'Kilowatt direct',
        offerKind:'direct',
        countries:['MA'],
        operatorIds:['kilowatt'],
        stationIds:aliases(t.stationId),
        currency:'MAD',
        pricingModelId:`kilowatt-${t.kind}-${t.stationId}`,
        pricing,
        metadata:{
          ...commonMetadata,
          evidencePolicy:'station_specific_app_backend_rate_description',
          rateDescription:text(t.rateDescription)||null,
          stationName:text(t.stationName)||null
        }
      };
    });

    return[...freeRules,...paidRules];
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
