(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoEvgo=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));

  function classifyEvse(evse){
    if(evse?.isLongTermUnavailable===true||evse?.isTemporarilyUnavailable===true)return'out_of_service';
    const native=text(evse?.status);
    if(native==='charging'||native==='suspendedEV')return'occupied_or_active_session';
    if(native==='available'&&evse?.isAvailable===true)return'available';
    if(['unavailable','faulted','offline','unknown'].includes(native))return'out_of_service';
    return'unknown';
  }

  function stationState(evses){
    const states=(evses||[]).map(classifyEvse);
    if(states.includes('available'))return'available';
    if(states.includes('occupied_or_active_session'))return'occupied';
    if(states.length&&states.every(s=>s==='out_of_service'))return'out_of_service';
    return'unknown';
  }

  function connectorKind(evse){return text(evse?.currentType).toUpperCase()==='DC'?'DC':'AC';}
  function connectorPower(evse){return number(evse?.maxPower)??number(evse?.powerCandidateKW);}

  function normalizeStation(station,{sourceId='morocco-evgo-native'}={}){
    if(!station||station.locationId==null)return null;
    const lat=number(station.latitude),lon=number(station.longitude);
    const evses=(station.evses||[]).map(evse=>({
      id:`evgo:${text(evse.id)}`,
      aliases:[`evgo-evse:${text(evse.id)}`],
      label:text(evse.identifier)||text(evse.id),
      connectors:(evse.connectors||[{id:evse.id,name:connectorKind(evse)}]).map((c,i)=>({
        id:`evgo:${text(evse.id)}:connector:${text(c?.id)||i}`,
        kind:connectorKind(evse),
        powerKw:connectorPower(evse),
        powerSource:number(evse?.maxPower)!=null?'native':number(evse?.powerCandidateKW)!=null?text(evse?.powerCandidateSource)||'candidate':null,
        plugName:text(c?.name)||null
      })),
      status:{state:classifyEvse(evse),nativeState:text(evse.status),isAvailable:evse.isAvailable===true,isLongTermUnavailable:evse.isLongTermUnavailable===true,isTemporarilyUnavailable:evse.isTemporarilyUnavailable===true},
      model:text(evse.chargePointModel)||null
    }));
    const free=(station.evses||[]).length>0&&(station.evses||[]).every(e=>e?.isFree===true&&number(e?.priceMAD)===0);
    const dimensions={
      cpoOperator:text(station.operator_cpo_candidate)||'Nareva Services / EVGO',
      siteBrand:station.site_brand==null?null:text(station.site_brand),
      appSource:text(station.app_source)||'EVGO',
      accessNetwork:'EVGO',
      tariffChannel:text(station.tariff_channel)||'EVGO native',
      statusSource:text(station.status_source)||'EVGO native backend cp.evgo.ma'
    };
    return{
      canonicalId:`MA:evgo:${station.locationId}`,
      aliases:[`evgo-location:${station.locationId}`],
      sourceStationId:text(station.locationId),countryCode:'MA',name:text(station.name),address:text(station.address),
      latitude:lat,longitude:lon,physicalOperator:{name:dimensions.cpoOperator},networkBrand:'EVGO',
      siteBrand:dimensions.siteBrand,appSource:dimensions.appSource,accessNetwork:dimensions.accessNetwork,tariffChannel:dimensions.tariffChannel,statusSource:dimensions.statusSource,
      sourceDimensions:dimensions,
      evses,status:{state:stationState(station.evses),sourceId,updatedAt:station.updatedAt||null},
      offers:free?[{id:`evgo-free:${station.locationId}`,provider:'EVGO direct',kind:'direct',countries:['MA'],currency:'MAD',pricing:{type:'rules',rules:[{scope:'allDay',billing:'kwh',currency:'MAD',pricePerKwh:0}]},metadata:{tariffChannel:dimensions.tariffChannel,interpretation:'EVGO-specific missing native tariff => free; never generalize to another operator.'}}]:[],
      updatedAt:station.updatedAt||null,
      legacy:{platformProvider:station.platform_provider||null,geoSource:station.geo_source||null}
    };
  }

  function validateDataset(dataset){
    const stations=Array.isArray(dataset?.stations)?dataset.stations:[];
    const errors=[];let evseCount=0;
    if(stations.length!==17)errors.push(`expected 17 EVGO stations, got ${stations.length}`);
    for(const st of stations){
      const lat=number(st.latitude),lon=number(st.longitude);
      if(lat==null||lon==null||lat<20||lat>37||lon<-18||lon>0)errors.push(`invalid Morocco GPS for location ${st.locationId}`);
      for(const evse of st.evses||[]){evseCount++;const expected=classifyEvse(evse);if(text(evse.operational_class)!==expected)errors.push(`status rule mismatch location ${st.locationId} EVSE ${evse.id}: ${evse.operational_class} != ${expected}`);}
    }
    if(evseCount!==43)errors.push(`expected 43 EVSE, got ${evseCount}`);
    return{ok:errors.length===0,stationCount:stations.length,evseCount,errors};
  }

  function normalizeDataset(dataset,options={}){const validation=validateDataset(dataset);if(!validation.ok){const e=new Error(`EVGO dataset validation failed: ${validation.errors.join('; ')}`);e.validation=validation;throw e;}return(dataset.stations||[]).map(s=>normalizeStation(s,options)).filter(Boolean);}

  return{classifyEvse,stationState,normalizeStation,normalizeDataset,validateDataset};
});
