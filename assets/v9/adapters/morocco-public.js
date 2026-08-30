(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoPublic=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const slug=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const validMoroccoGps=(lat,lon)=>lat!=null&&lon!=null&&lat>=20&&lat<=37&&lon>=-18&&lon<=0;
  async function fetchJson(url,fetchImpl){const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable');const r=await f(url,{cache:'no-cache'});if(!r.ok)throw new Error(`resource unavailable (${r.status}): ${url}`);return r.json();}

  function evgoClassify(evse){
    if(evse?.isLongTermUnavailable===true||evse?.isTemporarilyUnavailable===true)return'out_of_service';
    const native=text(evse?.status);
    if(native==='charging'||native==='suspendedEV')return'occupied_or_active_session';
    if(native==='available'&&evse?.isAvailable===true)return'available';
    if(['unavailable','faulted','offline','unknown'].includes(native))return'out_of_service';
    return'unknown';
  }
  function evgoStationState(evses){const states=(evses||[]).map(evgoClassify);if(states.includes('available'))return'available';if(states.includes('occupied_or_active_session'))return'occupied';if(states.length&&states.every(s=>s==='out_of_service'))return'out_of_service';return'unknown';}
  function normalizeEvgoDataset(dataset,{sourceId='morocco-evgo-native'}={}){
    const stations=Array.isArray(dataset?.stations)?dataset.stations:[],errors=[];let evseCount=0;
    if(stations.length!==17)errors.push(`expected 17 EVGO stations, got ${stations.length}`);
    for(const st of stations){if(!validMoroccoGps(number(st.latitude),number(st.longitude)))errors.push(`invalid EVGO GPS ${st.locationId}`);for(const e of st.evses||[]){evseCount++;if(text(e.operational_class)!==evgoClassify(e))errors.push(`EVGO status mismatch ${st.locationId}/${e.id}`);}}
    if(evseCount!==43)errors.push(`expected 43 EVGO EVSE, got ${evseCount}`);if(errors.length)throw new Error(errors.join('; '));
    return stations.map(st=>{
      const evses=(st.evses||[]).map(e=>({id:`evgo:${text(e.id)}`,aliases:[`evgo-evse:${text(e.id)}`],label:text(e.identifier)||text(e.id),connectors:(e.connectors||[{id:e.id,name:text(e.currentType)}]).map((c,i)=>({id:`evgo:${text(e.id)}:connector:${text(c?.id)||i}`,kind:text(e.currentType).toUpperCase()==='DC'?'DC':'AC',powerKw:number(e.maxPower)??number(e.powerCandidateKW),powerSource:number(e.maxPower)!=null?'native':number(e.powerCandidateKW)!=null?text(e.powerCandidateSource)||'candidate':null,plugName:text(c?.name)||null})),status:{state:evgoClassify(e),nativeState:text(e.status),isAvailable:e.isAvailable===true,isLongTermUnavailable:e.isLongTermUnavailable===true,isTemporarilyUnavailable:e.isTemporarilyUnavailable===true},model:text(e.chargePointModel)||null}));
      const free=(st.evses||[]).length>0&&(st.evses||[]).every(e=>e?.isFree===true&&number(e?.priceMAD)===0);
      return{canonicalId:`MA:evgo:${st.locationId}`,aliases:[`evgo-location:${st.locationId}`],sourceStationId:text(st.locationId),countryCode:'MA',name:text(st.name),address:text(st.address),latitude:number(st.latitude),longitude:number(st.longitude),physicalOperator:{name:text(st.operator_cpo_candidate)||'Nareva Services / EVGO'},networkBrand:'EVGO',evses,access:{kind:'public',limited:false,siteBrand:st.site_brand==null?null:text(st.site_brand),appSource:text(st.app_source)||'EVGO',accessNetwork:'EVGO'},status:{state:evgoStationState(st.evses),sourceId,updatedAt:st.updatedAt||null,statusSource:text(st.status_source)||'EVGO native backend cp.evgo.ma'},offers:free?[{id:`evgo-free:${st.locationId}`,provider:'EVGO direct',kind:'direct',countries:['MA'],currency:'MAD',pricing:{type:'rules',rules:[{scope:'allDay',billing:'kwh',currency:'MAD',pricePerKwh:0}]},metadata:{tariffChannel:text(st.tariff_channel)||'EVGO native',interpretation:'EVGO-only explicit normalized free rule; never generalize to another operator.'}}]:[],updatedAt:st.updatedAt||null};
    });
  }

  const FASTVOLT_OVERRIDE={W00057:{siteBrand:'Afriquia',connectors:[...Array.from({length:4},(_,i)=>({id:`fastvolt:W00057:ccs:${i+1}`,kind:'DC',plugName:'CCS2',powerKw:360,powerSource:'native_app_verified'})),...Array.from({length:2},(_,i)=>({id:`fastvolt:W00057:type2:${i+1}`,kind:'AC',plugName:'Type 2',powerKw:22,powerSource:'native_app_verified'}))]}};
  function fastVoltPublicConnectors(row){const out=[],max=number(row?.max_output);const add=(count,kind,plug)=>{for(let i=0;i<Number(count||0);i++)out.push({id:`fastvolt:${text(row.charger_id)}:${slug(plug)}:${i+1}`,kind,plugName:plug,powerKw:max,powerSource:'public_map_station_max_output'});};add(row?.ccs_count,'DC','CCS');add(row?.chademo_count,'DC','CHAdeMO');add(row?.type2_count,'AC','Type 2');return out;}
  function fastVoltOffers(id){return[{id:`fastvolt-direct-dc:${id}`,provider:'FastVolt direct',kind:'direct',countries:['MA'],currency:'MAD',connectorKinds:['DC'],pricing:{type:'rules',rules:[{scope:'allDay',billing:'minute',currency:'MAD',pricePerMinute:2.5}]},metadata:{tariffChannel:'FastVolt direct',source:'official FastVolt HowIts/FAQ'}},{id:`fastvolt-direct-ac:${id}`,provider:'FastVolt direct',kind:'direct',countries:['MA'],currency:'MAD',connectorKinds:['AC'],pricing:{type:'rules',rules:[{scope:'allDay',billing:'minute',currency:'MAD',pricePerMinute:0.5}]},metadata:{tariffChannel:'FastVolt direct',source:'official FastVolt HowIts/FAQ'}}];}
  function normalizeFastVoltDataset(dataset,{sourceId='morocco-fastvolt-public'}={}){const rows=Array.isArray(dataset?.chargers)?dataset.chargers:[],production=rows.filter(r=>r?.production_candidate===true);if(rows.length!==100||production.length!==97)throw new Error(`FastVolt expected 100/97, got ${rows.length}/${production.length}`);return production.map(row=>{const id=text(row.charger_id),lat=number(row.latitude),lon=number(row.longitude);if(!id||!validMoroccoGps(lat,lon))throw new Error(`invalid FastVolt station ${id}`);const override=FASTVOLT_OVERRIDE[id];const connectors=override?.connectors||fastVoltPublicConnectors(row);return{canonicalId:`MA:fastvolt:${id}`,aliases:[`fastvolt-charger:${id}`],sourceStationId:id,countryCode:'MA',name:text(row.charger_name||row.label)||`FastVolt ${id}`,address:[text(row.address_line_1),text(row.address_line_2),text(row.city)].filter(Boolean).join(', '),latitude:lat,longitude:lon,physicalOperator:{name:'FastVolt / Afrimobility'},networkBrand:'FastVolt',access:{kind:'public',limited:false,siteBrand:override?.siteBrand??(row.site_brand==null?null:text(row.site_brand)),appSource:'FastVolt public web map',accessNetwork:'FastVolt'},status:{state:'unknown',sourceId,statusSource:null,updatedAt:null},evses:[{id:`fastvolt:${id}`,aliases:[`fastvolt-evse:${id}`],connectors}],offers:fastVoltOffers(id)};});}

  function kilowattState(v){const s=text(v).toLowerCase();return s==='available'?'available':s==='occupied'||s==='charging'?'occupied':['faulted','offline','unknown','unavailable'].includes(s)?'out_of_service':'unknown';}
  function normalizeKilowattDataset(dataset,{sourceId='morocco-kilowatt-public'}={}){const rows=Array.isArray(dataset?.stations)?dataset.stations:[],production=rows.filter(r=>r?.production_candidate===true);if(rows.length!==47||production.length!==43)throw new Error(`Kilowatt expected 47/43, got ${rows.length}/${production.length}`);return production.map(st=>{const lat=number(st.latitude),lon=number(st.longitude);if(!validMoroccoGps(lat,lon))throw new Error(`invalid Kilowatt GPS ${st.id}`);const connectors=(st.connectors||[]).map((c,i)=>({id:`kilowatt:${st.id}:connector:${i}`,kind:(text(c?.type).toUpperCase().includes('CCS')||text(c?.type).toUpperCase().includes('CHADEMO'))?'DC':'AC',powerKw:number(c?.power_kw),plugName:text(c?.type)||null}));return{canonicalId:`MA:kilowatt:${text(st.id)}`,aliases:[`kilowatt-station:${text(st.id)}`],sourceStationId:text(st.id),countryCode:'MA',name:text(st.name)||'Kilowatt',address:text(st.address),latitude:lat,longitude:lon,physicalOperator:{name:'Kilowatt'},networkBrand:'Kilowatt',access:{kind:'public',limited:false,siteBrand:st.site_brand==null?null:text(st.site_brand),appSource:'Kilowatt public web map',accessNetwork:'Kilowatt'},evses:[{id:`kilowatt:${text(st.id)}`,connectors}],status:{state:kilowattState(st.status),sourceId,statusSource:text(st.status_source)||'Kilowatt public web map',updatedAt:null},offers:[]};});}

  function normalizeTotalEnergies(official,alWaha,links,{sourceId='morocco-totalenergies-hosts'}={}){
    if(!Array.isArray(official?.rows))throw new Error('invalid TotalEnergies official inventory');
    const corrected=text(links?.reconciliation?.corrected_second_tamesna_label),coords=new Map((links?.official_link_coordinates||[]).map(x=>[text(x.site_name),{lat:number(x.latitude),lon:number(x.longitude)}]));
    const grouped=new Map();let tamesnaSeen=0;
    for(const row of official.rows){let name=text(row.site_name);if(!name)continue;if(name==='TAMESNA'){tamesnaSeen++;if(tamesnaSeen===2&&corrected)name=corrected;}if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(row);}
    if(grouped.size!==18)throw new Error(`TotalEnergies expected 18 reconciled hosts, got ${grouped.size}`);
    const exact=alWaha?.station||{},exactId=text(exact.kilowatt_station_id);
    const diagnostics=[];const stations=[];
    for(const [name,rows] of grouped){const geo=coords.get(name);if(!geo||!validMoroccoGps(geo.lat,geo.lon)){diagnostics.push({name,reason:'missing_official_link_coordinates'});continue;}const isAlWaha=name==='AL WAHA'&&exact.operator_cpo==='Kilowatt'&&exactId;const connectors=[];for(const row of rows){const count=Math.max(1,Number(row.charger_count||0));const kind=text(row.current_class).toUpperCase().includes('DC')?'DC':'AC';for(let i=0;i<count;i++)connectors.push({id:`totalenergies:${slug(name)}:${kind.toLowerCase()}:${i+1}`,kind,powerKw:number(row.power_kw),plugName:null,powerSource:'TotalEnergies official public table'});}stations.push({canonicalId:isAlWaha?`MA:kilowatt:${exactId}`:`MA:totalenergies-host:${slug(name)}`,aliases:[`totalenergies-host:${slug(name)}`,...(isAlWaha?[`kilowatt-station:${exactId}`]:[])],sourceStationId:`totalenergies:${slug(name)}`,countryCode:'MA',name:isAlWaha?(text(exact.canonical_name)||'TotalEnergies AL WAHA'):name,address:'',latitude:geo.lat,longitude:geo.lon,physicalOperator:isAlWaha?{name:'Kilowatt'}:null,networkBrand:isAlWaha?'Kilowatt':null,access:{kind:'public',limited:false,siteBrand:'TotalEnergies',appSource:isAlWaha?'Kilowatt public web map':'TotalEnergies official public website',accessNetwork:isAlWaha?'Kilowatt':null},evses:[{id:isAlWaha?`kilowatt:${exactId}`:`totalenergies:${slug(name)}`,connectors}],status:isAlWaha?{state:'available',sourceId,statusSource:'Kilowatt public web map',updatedAt:null}:{state:'unknown',sourceId,statusSource:null,updatedAt:null},offers:[]});}
    return{stations,diagnostics,summary:{officialRows:official.rows.length,reconciledHosts:grouped.size,geolocatedHosts:stations.length,excludedWithoutGeo:diagnostics.length,alWahaExactMerged:stations.some(s=>s.canonicalId===`MA:kilowatt:${exactId}`)}};
  }

  function createLoader({source,fetchImpl}={}){
    if(!source?.profile)throw new Error('Morocco source profile missing');
    return async function(){
      if(source.profile==='evgo')return normalizeEvgoDataset(await fetchJson(source.url,fetchImpl),{sourceId:source.id});
      if(source.profile==='fastvolt')return normalizeFastVoltDataset(await fetchJson(source.url,fetchImpl),{sourceId:source.id});
      if(source.profile==='kilowatt')return normalizeKilowattDataset(await fetchJson(source.url,fetchImpl),{sourceId:source.id});
      if(source.profile==='totalenergies'){const [official,alWaha,links]=await Promise.all([fetchJson(source.urls.official,fetchImpl),fetchJson(source.urls.alWaha,fetchImpl),fetchJson(source.urls.links,fetchImpl)]);return normalizeTotalEnergies(official,alWaha,links,{sourceId:source.id}).stations;}
      throw new Error(`unsupported Morocco profile ${source.profile}`);
    };
  }

  return{createLoader,normalizeEvgoDataset,normalizeFastVoltDataset,normalizeKilowattDataset,normalizeTotalEnergies,evgoClassify,kilowattState};
});
