(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.legacyDirectTariffs=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const uniq=values=>[...new Set((values||[]).map(text).filter(Boolean))];
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};

  function e55cRules(payload,source={}){
    const profiles=payload?.profiles||{},stations=Array.isArray(payload?.stations)?payload.stations:[],rules=[];
    for(const station of stations){
      const stationId=text(station?.stationId),localStationId=text(station?.localStationId);
      for(const [index,config] of (station?.configurations||[]).entries()){
        const profileId=text(config?.pricingProfileId),profile=profiles?.[profileId];
        if(config?.priceStatus!=='resolved_e55c_scan_pay'||!profile||!Array.isArray(profile.rules)||!profile.rules.length)continue;
        const evseIds=uniq([...(config?.evseIds||[]),...(config?.localEvseIds||[])]);
        const kind=text(config?.kind).toUpperCase(),power=number(config?.powerKw);
        rules.push({
          id:`e55c-direct:${stationId||localStationId||'station'}:${index}`,
          provider:'E55C direct',offerKind:'direct',subscriptionId:null,countries:['FR'],currency:'EUR',
          operatorIds:['e55c'],stationIds:uniq([stationId,localStationId]),evseIds,
          connectorKinds:kind?[kind]:[],minPowerKw:power,maxPowerKw:power,
          pricing:{type:'rules',rules:clone(profile.rules)},priority:Number(source?.priority?.tariff||95),
          metadata:{legacyDataset:text(payload?.dataset),pricingProfileId:profileId,priceStatus:text(config?.priceStatus),verified:true,paymentUrls:uniq(config?.paymentUrls||[])}
        });
      }
    }
    return rules;
  }

  function normalizePayload(payload,source={}){
    const dataset=text(payload?.dataset).toLowerCase();
    if(dataset==='e55c-operated-france-tcc-v8'||(Array.isArray(payload?.stations)&&payload?.profiles&&payload?.scope?.strictOperatorValue==='ELECTRIC 55 CHARGING')){
      return{offerRules:e55cRules(payload,source),metadata:{dataset:payload?.dataset||'e55c',generatedAt:payload?.generatedAt||null,adapter:'legacy-direct-tariffs',mode:'e55c-exact-evse'}};
    }
    return{offerRules:[],metadata:{dataset:payload?.dataset||'unknown',adapter:'legacy-direct-tariffs',unsupported:true}};
  }

  async function readJsonMaybeGzip(response){
    if(!response.ok)throw new Error(`legacy tariff source unavailable (${response.status})`);
    const bytes=new Uint8Array(await response.arrayBuffer());let raw;
    if(bytes[0]===0x1f&&bytes[1]===0x8b){
      if(typeof DecompressionStream!=='function')throw new Error('gzip decompression unavailable');
      raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }else raw=new TextDecoder().decode(bytes);
    return JSON.parse(raw);
  }

  function createLoader({url,fetchImpl,source}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for legacy direct tariffs');
    let cache=null;
    return async function(){
      if(!cache)cache=f(url,{cache:'no-cache'}).then(readJsonMaybeGzip).then(payload=>normalizePayload(payload,source||{})).catch(error=>{cache=null;throw error;});
      return cache;
    };
  }

  return{e55cRules,normalizePayload,readJsonMaybeGzip,createLoader};
});