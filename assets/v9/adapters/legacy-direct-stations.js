(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.legacyDirectStations=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const uniq=values=>[...new Set((values||[]).map(text).filter(Boolean))];
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  function evseIdentityVariants(values){
    const out=[];
    for(const raw of uniq(values||[])){
      out.push(raw);
      const compact=raw.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(compact&&compact!==raw)out.push(compact);
    }
    return uniq(out);
  }

  function kwhPricing(price){return{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(price),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0}]};}

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
        rules.push({id:`ionity-direct:${uuid}:${index++}`,provider:'IONITY Direct',offerKind:'direct',subscriptionId:null,countries:['FR'],currency:'EUR',operatorIds:['ionity'],stationIds:uniq([`ionity:${uuid}`,locationId?`ionity-location:${locationId}`:'']),connectorKinds:[group.kind],minPowerKw:group.power,maxPowerKw:group.power,pricing:kwhPricing(group.price),priority:Number(source?.priority?.tariff||95),metadata:{legacyDataset:text(payload?.dataset),sourceLocationUuid:uuid,sourceLocationId:locationId,verified:true,identityMode:'explicit_provider_crosswalk',connectorRefs:refs}});
      }
    }
    return rules;
  }

  function atlanteRules(payload,source={}){
    const locations=Array.isArray(payload?.locations)?payload.locations:[],rules=[];
    for(const location of locations){
      const locationId=text(location?.id||location?.uuid||location?.locationId);let index=0;
      for(const connector of location?.connectors||[]){
        const evseId=text(connector?.evseId),kind=text(connector?.kind).toUpperCase(),price=number(connector?.pricePerKwhEur);
        if(!evseId||!['AC','DC'].includes(kind)||!(price>0))continue;
        rules.push({id:`atlante-direct:${locationId||'location'}:${index++}`,provider:'Atlante direct',offerKind:'direct',subscriptionId:null,countries:['FR'],currency:'EUR',operatorIds:['atlante','atlante-france'],evseIds:evseIdentityVariants([evseId]),connectorKinds:[kind],pricing:kwhPricing(price),priority:Number(source?.priority?.tariff||95),metadata:{legacyDataset:text(payload?.dataset),sourceLocationId:locationId,sourceConnectorId:text(connector?.connectorId||connector?.externalConnectorId),sourceEvseId:evseId,verified:true,identityMode:'exact_evse_with_compact_ocpi_alias'}});
      }
    }
    return rules;
  }

  function powerdotConnectorKind(connector){const type=Number(connector?.type||0);if(type===1)return'AC';if(type===2)return'DC';return Number(connector?.maxPowerKw||0)<=22.5?'AC':'DC';}
  function powerdotPricing(tariff){
    const rule={scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:(text(tariff?.currencyCode)||'EUR').toUpperCase(),pricePerKwh:0,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0};let hasPrice=false;
    for(const element of tariff?.elements||[]){const restrictions=element?.restrictions||{};for(const component of element?.priceComponents||[]){const type=text(component?.type).toUpperCase(),price=number(component?.pricePerUnit);if(price==null||price<0)continue;if(type==='ENERGY'&&price>0){rule.pricePerKwh=price;hasPrice=true;}else if(type==='FLAT'&&price>0){rule.connectionFee=price;hasPrice=true;}else if(type==='PARKING_TIME'&&price>0){rule.idlePerMinute=price;hasPrice=true;}else if(type==='TIME'&&price>0){const thresholdSec=Number(restrictions?.minDurationSec||0);if(thresholdSec>0){rule.afterMinutesRate=price;rule.afterMinutesThreshold=thresholdSec/60;}else rule.chargePerMinute=price;hasPrice=true;}}}
    return hasPrice?{type:'rules',rules:[rule]}:{type:'rules',rules:[]};
  }
  function powerdotRules(payload,source={}){
    const rules=[];let index=0;
    for(const entry of Array.isArray(payload?.chargers)?payload.chargers:[]){
      const location=entry?.location||{};if(text(location?.countryCode).toUpperCase()!=='FR')continue;
      const pdcIds=evseIdentityVariants(entry?.irvePdcIds||[]);if(!pdcIds.length)continue;
      const chargerName=text(entry?.chargerName||entry?.charger?.chargerName);
      for(const connector of entry?.charger?.connectors||[]){
        const pricing=powerdotPricing(connector?.tariff);if(!pricing.rules.length)continue;
        if(connector?.tariff?.subscriptionActive===true)continue;
        const kind=powerdotConnectorKind(connector),power=number(connector?.maxPowerKw);
        rules.push({id:`powerdot-direct:${text(location?.id||location?.uid)||'location'}:${index++}`,provider:'Powerdot direct',offerKind:'direct',subscriptionId:null,countries:['FR'],currency:pricing.rules[0]?.currency||'EUR',operatorIds:['powerdot','power-dot','power-dot-france'],evseIds:pdcIds,connectorKinds:[kind],minPowerKw:power,maxPowerKw:power,pricing,priority:Number(source?.priority?.tariff||95),metadata:{legacyDataset:text(payload?.dataset),sourceType:text(payload?.sourceType||payload?.source?.sourceType),sourceLocationId:text(location?.id),sourceLocationUid:text(location?.uid),chargerName,tariffId:text(connector?.tariff?.id),physicalReference:text(connector?.physicalReference),verified:true,identityMode:'exact_irve_pdc_with_compact_ocpi_alias',roaming:false}});
      }
    }
    return rules;
  }

  function normalizePayload(payload,source={}){
    const dataset=text(payload?.dataset).toLowerCase();
    if(dataset==='ionity-direct-operated-stations-france'||(Array.isArray(payload?.locations)&&payload?.scope?.requiredCpoIdentifier==='IONITY_CPO'))return{offerRules:ionityRules(payload,source),metadata:{dataset:payload?.dataset||'ionity',generatedAt:payload?.generatedAt||null,adapter:'legacy-direct-stations',mode:'provider-crosswalk-only'}};
    if(dataset==='atlante-direct-operated-stations-france'||(Array.isArray(payload?.locations)&&payload?.scope?.requiredCpo==='FRATL'&&payload?.scope?.requiredPartyId==='ATL'))return{offerRules:atlanteRules(payload,source),metadata:{dataset:payload?.dataset||'atlante',generatedAt:payload?.generatedAt||null,adapter:'legacy-direct-stations',mode:'exact-evse'}};
    const powerdotSourceType=text(payload?.sourceType||payload?.source?.sourceType).toLowerCase(),powerdotOperator=text(payload?.operator||payload?.source?.operator).toLowerCase();
    if(Array.isArray(payload?.chargers)&&(powerdotSourceType==='direct_cpo_public_adhoc_api'||powerdotOperator.includes('power dot')))return{offerRules:powerdotRules(payload,source),metadata:{dataset:payload?.dataset||'powerdot',generatedAt:payload?.generatedAt||null,adapter:'legacy-direct-stations',mode:'exact-irve-pdc',sourceType:powerdotSourceType,operator:powerdotOperator}};
    return{offerRules:[],metadata:{dataset:payload?.dataset||'unknown',adapter:'legacy-direct-stations',unsupported:true}};
  }

  async function readJsonMaybeGzip(response){if(!response.ok)throw new Error(`legacy direct station source unavailable (${response.status})`);const bytes=new Uint8Array(await response.arrayBuffer());let raw;if(bytes[0]===0x1f&&bytes[1]===0x8b){if(typeof DecompressionStream!=='function')throw new Error('gzip decompression unavailable');raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}else raw=new TextDecoder().decode(bytes);return JSON.parse(raw);}
  function createLoader({url,fetchImpl,source}={}){const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for legacy direct stations');let cache=null;return async function(){if(!cache)cache=f(url,{cache:'no-cache'}).then(readJsonMaybeGzip).then(payload=>normalizePayload(payload,source||{})).catch(error=>{cache=null;throw error;});return cache;};}

  return{kwhPricing,ionityPricing:kwhPricing,ionityRules,atlanteRules,powerdotConnectorKind,powerdotPricing,powerdotRules,evseIdentityVariants,normalizePayload,readJsonMaybeGzip,createLoader};
});