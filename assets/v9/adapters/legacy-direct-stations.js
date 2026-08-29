(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.legacyDirectStations=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const uniq=values=>[...new Set((values||[]).map(text).filter(Boolean))];
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};

  function ionityPricing(price){return{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(price),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0}]};}

  function ionityRules(payload,source={}){
    const locations=Array.isArray(payload?.locations)?payload.locations:[],rules=[];
    for(const location of locations){
      const uuid=text(location?.uuid),locationId=text(location?.locationId);
      if(!uuid)continue;
      const groups=new Map();
      for(const connector of location?.connectors||[]){
        const kind=text(connector?.kind).toUpperCase(),power=number(connector?.powerKw),price=number(connector?.pricePerKwhEur);
        if(!['AC','DC'].includes(kind)||!(power>0)||!(price>0))continue;
        const key=`${kind}|${power.toFixed(3)}|${price.toFixed(6)}`;
        if(!groups.has(key))groups.set(key,{kind,power,price,connectors:[]});
        groups.get(key).connectors.push(connector);
      }
      let index=0;
      for(const group of groups.values()){
        const refs=uniq(group.connectors.flatMap(c=>[c?.physicalReference,c?.number,c?.uuid]));
        rules.push({
          id:`ionity-direct:${uuid}:${index++}`,
          provider:'IONITY Direct',offerKind:'direct',subscriptionId:null,countries:['FR'],currency:'EUR',
          operatorIds:['ionity'],stationIds:uniq([`ionity:${uuid}`,locationId?`ionity-location:${locationId}`:'']),
          connectorKinds:[group.kind],minPowerKw:group.power,maxPowerKw:group.power,
          pricing:ionityPricing(group.price),priority:Number(source?.priority?.tariff||95),
          metadata:{legacyDataset:text(payload?.dataset),sourceLocationUuid:uuid,sourceLocationId:locationId,verified:true,identityMode:'explicit_provider_crosswalk',connectorRefs:refs}
        });
      }
    }
    return rules;
  }

  function normalizePayload(payload,source={}){
    const dataset=text(payload?.dataset).toLowerCase();
    if(dataset==='ionity-direct-operated-stations-france'||(Array.isArray(payload?.locations)&&payload?.scope?.requiredCpoIdentifier==='IONITY_CPO')){
      return{offerRules:ionityRules(payload,source),metadata:{dataset:payload?.dataset||'ionity',generatedAt:payload?.generatedAt||null,adapter:'legacy-direct-stations',mode:'provider-crosswalk-only'}};
    }
    return{offerRules:[],metadata:{dataset:payload?.dataset||'unknown',adapter:'legacy-direct-stations',unsupported:true}};
  }

  async function readJsonMaybeGzip(response){
    if(!response.ok)throw new Error(`legacy direct station source unavailable (${response.status})`);
    const bytes=new Uint8Array(await response.arrayBuffer());let raw;
    if(bytes[0]===0x1f&&bytes[1]===0x8b){
      if(typeof DecompressionStream!=='function')throw new Error('gzip decompression unavailable');
      raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }else raw=new TextDecoder().decode(bytes);
    return JSON.parse(raw);
  }

  function createLoader({url,fetchImpl,source}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for legacy direct stations');
    let cache=null;
    return async function(){
      if(!cache)cache=f(url,{cache:'no-cache'}).then(readJsonMaybeGzip).then(payload=>normalizePayload(payload,source||{})).catch(error=>{cache=null;throw error;});
      return cache;
    };
  }

  return{ionityPricing,ionityRules,normalizePayload,readJsonMaybeGzip,createLoader};
});