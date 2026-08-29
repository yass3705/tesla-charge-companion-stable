(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoKilowatt=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};

  function stationState(value){const v=text(value).toLowerCase();return v==='available'?'available':v==='occupied'||v==='charging'?'occupied':v==='faulted'||v==='offline'||v==='unknown'||v==='unavailable'?'out_of_service':'unknown';}
  function connectorKind(type){const t=text(type).toUpperCase();return t.includes('CCS')||t.includes('CHADEMO')?'DC':'AC';}
  function validMoroccoGps(lat,lon){return lat!=null&&lon!=null&&lat>=20&&lat<=37&&lon>=-18&&lon<=0;}

  function normalizeStation(station,{sourceId='morocco-kilowatt-public'}={}){
    if(!station||station.production_candidate!==true)return null;
    const lat=number(station.latitude),lon=number(station.longitude);
    if(!validMoroccoGps(lat,lon))return null;
    const connectors=(station.connectors||[]).map((c,i)=>({id:`kilowatt:${station.id}:connector:${i}`,kind:connectorKind(c?.type),powerKw:number(c?.power_kw),plugName:text(c?.type)||null}));
    const dimensions={cpoOperator:'Kilowatt',siteBrand:station.site_brand==null?null:text(station.site_brand),appSource:'Kilowatt public web map',accessNetwork:'Kilowatt',tariffChannel:station.tariff_channel==null?null:text(station.tariff_channel),statusSource:text(station.status_source)||'Kilowatt public web map'};
    return{
      canonicalId:`MA:kilowatt:${text(station.id)}`,
      aliases:[`kilowatt-station:${text(station.id)}`],sourceStationId:text(station.id),countryCode:'MA',name:text(station.name)||'Kilowatt',address:text(station.address),latitude:lat,longitude:lon,
      physicalOperator:{name:dimensions.cpoOperator},networkBrand:'Kilowatt',
      access:{kind:'public',limited:false,siteBrand:dimensions.siteBrand,appSource:dimensions.appSource,accessNetwork:dimensions.accessNetwork},
      evses:[{id:`kilowatt:${text(station.id)}`,connectors}],
      status:{state:stationState(station.status),sourceId,statusSource:dimensions.statusSource,updatedAt:null},
      offers:[],
      legacy:{city:text(station.city)||null,tariffChannel:dimensions.tariffChannel}
    };
  }

  function validateDataset(dataset){
    const stations=Array.isArray(dataset?.stations)?dataset.stations:[],production=stations.filter(s=>s?.production_candidate===true),errors=[];
    if(stations.length!==47)errors.push(`expected 47 raw records, got ${stations.length}`);
    if(production.length!==43)errors.push(`expected 43 production records, got ${production.length}`);
    for(const st of production){const lat=number(st.latitude),lon=number(st.longitude);if(!validMoroccoGps(lat,lon))errors.push(`invalid Morocco GPS ${st.id}`);if(text(st.status).toLowerCase()!=='available')errors.push(`unexpected production status ${st.id}: ${st.status}`);const cs=st.connectors||[];if(cs.length!==1||text(cs[0]?.type)!=='Type 2'||number(cs[0]?.power_kw)!==22)errors.push(`unexpected connector profile ${st.id}`);if(st.tariff_channel!=null)errors.push(`unexpected native tariff channel ${st.id}`);}
    return{ok:errors.length===0,rawCount:stations.length,productionCount:production.length,errors};
  }
  function normalizeDataset(dataset,options={}){const v=validateDataset(dataset);if(!v.ok){const e=new Error(v.errors.join('; '));e.validation=v;throw e;}return(dataset.stations||[]).map(s=>normalizeStation(s,options)).filter(Boolean);}
  return{stationState,connectorKind,normalizeStation,normalizeDataset,validateDataset};
});
