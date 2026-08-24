// Tesla Charge Companion V8 — catalogue national France hors Tesla enrichi E55C.
// Le socle Electroverse/Electra reste l'autorité des statuts. L'inventaire E55C
// strict ajoute les stations manquantes et les tarifs directs Scan & Pay.
(function(){
  'use strict';
  const BASE='data/non_tesla_france/';
  const E55C_URL='data/e55c_station_tariffs_v1.json.gz';
  const rawCache=new Map();
  let manifestPromise=null,statusPromise=null,e55cPromise=null;
  const STATUS_MAX_AGE_MS=48*60*60*1000;
  const text=value=>String(value==null?'':value).trim();
  const norm=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const deepClone=value=>JSON.parse(JSON.stringify(value));

  async function loadStatusSnapshot(){
    if(!statusPromise)statusPromise=fetch(BASE+'status_snapshot.json',{cache:'no-cache'}).then(async response=>{
      if(response.status===404)return {stations:{}};
      if(!response.ok)throw new Error(`Statuts France indisponibles (${response.status})`);
      return response.json();
    }).catch(error=>{
      console.warn('[TCC] Snapshot de statut ignoré :',error?.message||error);
      return {stations:{}};
    });
    return statusPromise;
  }

  function applyOperationalStatus(station,statuses){
    const entry=statuses?.stations?.[station.catalogStationId];
    if(!entry)return station;
    const checkedAt=entry.checkedAt||statuses.generatedAt||'';
    const checkedMs=Date.parse(checkedAt);
    const stale=!Number.isFinite(checkedMs)||(Date.now()-checkedMs)>STATUS_MAX_AGE_MS;
    const value=stale?'unknown':(entry.status==='out_of_service'?'out_of_service':entry.status==='available'?'available':'unknown');
    station.operationalStatus=value;
    station.operationalStatusRaw=entry.rawStatuses||[];
    station.operationalStatusCheckedAt=checkedAt;
    station.operationalStatusSource=entry.source||'';
    station.operationalStatusStale=stale;
    station.scheduledClosureOverride=!!entry.scheduledClosureOverride;
    return station;
  }

  async function loadManifest(){
    if(!manifestPromise)manifestPromise=fetch(BASE+'manifest.json',{cache:'no-cache'}).then(response=>{
      if(!response.ok)throw new Error(`Catalogue France indisponible (${response.status})`);
      return response.json();
    }).then(manifest=>{
      if(Number(manifest?.stationCount)<40000)throw new Error(`Catalogue France incomplet (${manifest?.stationCount||0} stations)`);
      return manifest;
    });
    return manifestPromise;
  }

  async function loadE55cCatalog(){
    if(!e55cPromise)e55cPromise=fetch(`${E55C_URL}?v=${Date.now()}`,{cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error(`Base E55C indisponible (${response.status})`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('Compression E55C invalide');
      if(typeof DecompressionStream!=='function')throw new Error('Décompression E55C indisponible dans ce navigateur');
      return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    }).then(data=>{
      if(data?.dataset!=='e55c-operated-france-tcc-v8')throw new Error('Dataset E55C inattendu');
      if(data?.scope?.activeInV73!==false||data?.scope?.dynamicStatusIncluded!==false)throw new Error('Garde-fou E55C V8 invalide');
      if(data?.scope?.strictOperatorField!=='nom_operateur'||data?.scope?.strictOperatorValue!=='ELECTRIC 55 CHARGING')throw new Error('Filtre CPO E55C invalide');
      if(!Array.isArray(data?.stations)||Number(data?.stats?.stationCount)!==data.stations.length||data.stations.length<500)throw new Error('Inventaire E55C incomplet');
      window.TCC_E55C_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base E55C ignorée :',error?.message||error);
      return {profiles:{},stations:[],stats:{}};
    });
    return e55cPromise;
  }

  async function readGzipJson(file,version=''){
    const cacheKey=`${file}|${version}`;
    if(rawCache.has(cacheKey))return rawCache.get(cacheKey);
    const promise=(async()=>{
      const url=BASE+file+(version?`?v=${encodeURIComponent(version)}`:'');
      const response=await fetch(url,{cache:'force-cache'});
      if(!response.ok)throw new Error(`Fragment France indisponible (${response.status})`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      let body;
      if(bytes[0]===0x1f&&bytes[1]===0x8b){
        if(typeof DecompressionStream!=='function')throw new Error('Ce navigateur ne prend pas en charge la décompression du catalogue France.');
        body=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      }else body=new TextDecoder().decode(bytes);
      return JSON.parse(body);
    })();
    rawCache.set(cacheKey,promise);
    try{return await promise}catch(error){rawCache.delete(cacheKey);throw error}
  }

  function intersects(tile,lat,lon,radiusKm){
    if(!(radiusKm>0))return true;
    const latDelta=radiusKm/110.574;
    const cos=Math.max(.15,Math.cos(lat*Math.PI/180));
    const lonDelta=radiusKm/(111.320*cos);
    return tile.maxLat>=lat-latDelta&&tile.minLat<=lat+latDelta&&tile.maxLon>=lon-lonDelta&&tile.minLon<=lon+lonDelta;
  }

  function dayIndexFromSimulation(){
    const value=document.getElementById('simDate')?.value;
    const date=value?new Date(`${value}T12:00:00`):new Date();
    return Number.isFinite(date.getTime())?date.getDay():new Date().getDay();
  }

  function pricingFromRows(rows,dayIndex){
    const rules=(rows||[]).filter(row=>!Array.isArray(row?.[11])||row[11].includes(dayIndex)).map(row=>({
      scope:row[0]||'allDay',start:row[1]||'00:00',end:row[2]||'24:00',billing:row[3]||'kwh',currency:(row[4]||'EUR').toUpperCase(),
      pricePerKwh:Number(row[5]||0),chargePerMinute:Number(row[6]||0),connectionFee:Number(row[7]||0),idlePerMinute:Number(row[8]||0),
      afterMinutesRate:Number(row[9]||0),afterMinutesThreshold:Number(row[10]||0),afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'
    }));
    return {type:'rules',rules};
  }

  function providerFromConfigLabel(label){
    const value=text(label),separator=value.indexOf('·');
    return (separator>=0?value.slice(0,separator):value).trim();
  }
  function pricingSignature(pricing){
    return JSON.stringify((pricing?.rules||[]).map(rule=>({
      scope:rule.scope||'',start:rule.start||'',end:rule.end||'',billing:rule.billing||'',currency:(rule.currency||'EUR').toUpperCase(),
      k:Number(rule.pricePerKwh||0),m:Number(rule.chargePerMinute||0),p:Number(rule.parkingPerMinute||0),f:Number(rule.connectionFee||0),i:Number(rule.idlePerMinute||0),
      ar:Number(rule.afterMinutesRate||0),at:Number(rule.afterMinutesThreshold||0)
    })));
  }

  function separateAmbiguousElectra(configs){
    const groups=new Map();
    (configs||[]).forEach((config,index)=>{
      if(providerFromConfigLabel(config.label).toLowerCase()!=='electra')return;
      const key=`${text(config.kind).toUpperCase()}|${Number(config.powerKw||0).toFixed(2)}`;
      let group=groups.get(key);if(!group){group={indices:[],signatures:new Set()};groups.set(key,group);}
      group.indices.push(index);group.signatures.add(pricingSignature(config.pricing));
    });
    const drop=new Set(),ambiguous=[];
    for(const [key,group] of groups.entries()){
      if(!(group.indices.length>1&&group.signatures.size>1))continue;
      const unique=new Map();
      for(const index of group.indices){
        drop.add(index);const config=configs[index],signature=pricingSignature(config.pricing);
        if(signature&&!unique.has(signature))unique.set(signature,config.pricing);
      }
      const [kind,power]=key.split('|');
      ambiguous.push({provider:'Electra',kind,powerKw:Number(power),pricings:[...unique.values()]});
    }
    return {configs:(configs||[]).filter((_,index)=>!drop.has(index)),ambiguous,suppressed:drop.size};
  }

  function accessFromRows(rows){
    if(!Array.isArray(rows)||!rows.length)return {limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la source — accès à vérifier.'};
    const days={};for(let i=0;i<7;i++)days[String(i)]={open:false,start:'00:00',end:'00:00'};
    for(const row of rows){
      const day=Number(row?.[0]);if(!Number.isInteger(day)||day<0||day>6)continue;
      const start=row[1]||'00:00',end=row[2]||'24:00',current=days[String(day)];
      if(!current.open){days[String(day)]={open:true,start,end};continue;}
      if(start<current.start)current.start=start;if(end>current.end)current.end=end;
    }
    return {limited:true,unknown:false,days,afterCloseMode:'must_stop',afterCloseNote:'Horaires publiés par la source de données.'};
  }

  function stationFromRow(row,dayIndex){
    const rawConfigs=(row[8]||[]).map(config=>({id:config[0],label:config[1],kind:config[2]||'AC',powerKw:Number(config[3]||11),stalls:Number(config[4]||0),pricing:pricingFromRows(config[5],dayIndex)}));
    const separated=separateAmbiguousElectra(rawConfigs),configs=separated.configs;
    const first=configs[0]||rawConfigs.find(config=>providerFromConfigLabel(config.label).toLowerCase()!=='electra')||{kind:'AC',powerKw:11,stalls:0,pricing:{type:'rules',rules:[]}};
    return {
      id:`france-catalog:${row[0]}`,catalogStationId:row[0],name:row[1]||row[2]||'Borne France',address:row[2]||'',latitude:Number(row[3]),longitude:Number(row[4]),
      operator:row[5]||'Autre',stalls:Number(row[6]||0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configs,
      access:accessFromRows(row[7]),lastUpdated:row[9]||'',source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,
      ambiguousElectraConfigurationsSuppressed:separated.suppressed,ambiguousSourceOffers:separated.ambiguous
    };
  }

  function geoDistanceKm(aLat,aLon,bLat,bLon){
    const radius=6371,toRad=value=>Number(value)*Math.PI/180;
    const p1=toRad(aLat),p2=toRad(bLat),dp=toRad(Number(bLat)-Number(aLat)),dl=toRad(Number(bLon)-Number(aLon));
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*radius*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function isE55cOperator(station){
    const value=norm(station?.operator);
    return value==='electric 55'||value==='electric 55 charging'||value==='electric 55 charging e55c'||value==='e55c';
  }
  function stationInArea(record,origin,radiusKm){
    if(!(radiusKm>0))return true;
    return geoDistanceKm(origin.lat,origin.lon,record.coordinates?.[0],record.coordinates?.[1])<=radiusKm+1e-6;
  }
  function evseSuffixes(config){
    const source=config.localEvseIds?.length?config.localEvseIds:config.evseIds||[];
    return [...new Set(source.map(id=>text(id).split('*').at(-1)||text(id).slice(-4)).filter(Boolean))];
  }
  function directConfigurations(record,data){
    const counts=new Map();
    for(const config of record.configurations||[]){
      const key=`${text(config.kind).toUpperCase()}|${Number(config.powerKw).toFixed(3)}`;
      counts.set(key,(counts.get(key)||0)+1);
    }
    return (record.configurations||[]).map((config,index)=>{
      const key=`${text(config.kind).toUpperCase()}|${Number(config.powerKw).toFixed(3)}`;
      const resolved=config.priceStatus==='resolved_e55c_scan_pay'&&data?.profiles?.[config.pricingProfileId];
      const suffixes=evseSuffixes(config);
      const provider=resolved
        ?(counts.get(key)>1?`E55C direct (PDC ${suffixes.join(', ')})`:'E55C direct')
        :'E55C direct (tarif indisponible)';
      const pricing=resolved?{type:'rules',rules:deepClone(data.profiles[config.pricingProfileId].rules)}:{type:'rules',rules:[]};
      return {
        id:`e55c-direct-${record.stationId}-${index}`,
        label:`${provider} · ${config.kind} ${Number(config.powerKw)} kW`,
        kind:text(config.kind).toUpperCase(),powerKw:Number(config.powerKw),stalls:Number(config.stalls||0),pricing,
        offerProvider:provider,offerType:'operator_direct',e55cDirect:true,e55cVerified:!!resolved,
        e55cPricingProfileId:config.pricingProfileId||null,e55cPriceStatus:config.priceStatus,
        e55cEvseIds:[...(config.evseIds||[])],e55cLocalEvseIds:[...(config.localEvseIds||[])],e55cPaymentUrls:[...(config.paymentUrls||[])]
      };
    });
  }
  function strictPowerGroups(record){
    const seen=new Set(),groups=[];
    for(const config of record.configurations||[]){
      const kind=text(config.kind).toUpperCase(),power=Number(config.powerKw);
      const key=`${kind}|${power.toFixed(3)}`;if(seen.has(key))continue;seen.add(key);groups.push({kind,power});
    }
    return groups;
  }
  function remapConfigPower(config,record){
    const copy={...config,pricing:config.pricing};
    const kind=text(copy.kind).toUpperCase(),power=Number(copy.powerKw||0);
    const nearest=strictPowerGroups(record).filter(group=>group.kind===kind).map(group=>({...group,distance:Math.abs(group.power-power)})).sort((a,b)=>a.distance-b.distance)[0];
    if(nearest&&nearest.distance<=Math.max(.75,nearest.power*.05)){
      copy.powerKw=nearest.power;
      const provider=providerFromConfigLabel(copy.label);
      if(provider)copy.label=`${provider} · ${kind} ${nearest.power} kW`;
    }
    return copy;
  }
  function mergeConfigurations(configs){
    const map=new Map();
    for(const config of configs){
      const provider=providerFromConfigLabel(config.label||config.configurationLabel)||text(config.offerProvider);
      const key=[norm(provider),text(config.kind).toUpperCase(),Number(config.powerKw||0).toFixed(3),pricingSignature(config.pricing),text(config.e55cPricingProfileId)].join('|');
      const existing=map.get(key);
      if(!existing){map.set(key,config);continue;}
      existing.stalls=Math.max(Number(existing.stalls||0),Number(config.stalls||0));
      if(config.e55cEvseIds)existing.e55cEvseIds=[...new Set([...(existing.e55cEvseIds||[]),...config.e55cEvseIds])];
      if(config.e55cPaymentUrls)existing.e55cPaymentUrls=[...new Set([...(existing.e55cPaymentUrls||[]),...config.e55cPaymentUrls])];
    }
    return [...map.values()];
  }
  function primaryStation(matches){
    return matches.slice().sort((a,b)=>{
      const score=station=>(station.operationalStatus==='available'?4:station.operationalStatus==='out_of_service'?3:0)+(String(station.catalogStationId).startsWith('electroverse:')?2:0);
      return score(b)-score(a)||String(a.catalogStationId).localeCompare(String(b.catalogStationId));
    })[0];
  }
  function mergeStatus(target,matches){
    const source=matches.find(station=>station.operationalStatus==='available')||matches.find(station=>station.operationalStatus==='out_of_service')||matches.find(station=>station.operationalStatus);
    if(!source)return target;
    for(const key of ['operationalStatus','operationalStatusRaw','operationalStatusCheckedAt','operationalStatusSource','operationalStatusStale','scheduledClosureOverride'])if(source[key]!==undefined)target[key]=source[key];
    return target;
  }
  function mergedE55cStation(record,data,matches=[]){
    const direct=directConfigurations(record,data);
    const existing=matches.flatMap(station=>(station.chargingConfigurations||[]).map(config=>remapConfigPower(config,record)));
    const configurations=mergeConfigurations([...existing,...direct]);
    const first=configurations[0]||{kind:'AC',powerKw:Number(record.maxPowerKw||11),pricing:{type:'rules',rules:[]}};
    const base=matches.length?{...primaryStation(matches)}:{
      id:`france-catalog:e55c:${record.stationId}`,catalogStationId:`e55c:${record.stationId}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true
    };
    const merged={
      ...base,
      name:record.name||base.name,address:record.address||base.address,latitude:Number(record.coordinates[0]),longitude:Number(record.coordinates[1]),
      operator:'Electric 55 Charging (E55C)',stalls:Number(record.chargePointCount||0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,
      chargingConfigurations:configurations,access:{limited:false,unknown:false,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Accès E55C '+(record.access?.hours||'24/7'),condition:record.access?.condition||''},
      lastUpdated:String(data.generatedAt||'').slice(0,10),e55cStrictOperator:true,e55cStationId:record.stationId,e55cLocalStationId:record.localStationId,
      e55cSourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),e55cStatusJoinedExternally:matches.length>0,
      e55cDirectResolvedPoints:(record.configurations||[]).filter(config=>config.priceStatus==='resolved_e55c_scan_pay').reduce((sum,config)=>sum+Number(config.stalls||0),0),
      e55cUnresolvedPoints:(record.configurations||[]).filter(config=>config.priceStatus!=='resolved_e55c_scan_pay').reduce((sum,config)=>sum+Number(config.stalls||0),0)
    };
    return mergeStatus(merged,matches);
  }
  function mergeE55cCatalog(catalog,data,origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.stations)||!data.stations.length)return catalog;
    const consumed=new Set(),merged=[];
    const scale=10000,buckets=new Map();
    for(let index=0;index<catalog.length;index++){
      const station=catalog[index];
      if(!isE55cOperator(station)||!Number.isFinite(Number(station.latitude))||!Number.isFinite(Number(station.longitude)))continue;
      const key=`${Math.floor(Number(station.latitude)*scale)}|${Math.floor(Number(station.longitude)*scale)}`;
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key).push(index);
    }
    let matched=0,added=0,collapsed=0;
    for(const record of data.stations){
      const matches=[];
      const latCell=Math.floor(Number(record.coordinates[0])*scale),lonCell=Math.floor(Number(record.coordinates[1])*scale);
      const nearby=[];
      for(let latOffset=-3;latOffset<=3;latOffset++)for(let lonOffset=-3;lonOffset<=3;lonOffset++){
        nearby.push(...(buckets.get(`${latCell+latOffset}|${lonCell+lonOffset}`)||[]));
      }
      for(const index of nearby){
        if(consumed.has(index))continue;
        const distance=geoDistanceKm(record.coordinates[0],record.coordinates[1],catalog[index].latitude,catalog[index].longitude);
        if(distance<=.01+1e-9)matches.push({index,station:catalog[index]});
      }
      if(matches.length){
        matches.forEach(match=>consumed.add(match.index));
        merged.push(mergedE55cStation(record,data,matches.map(match=>match.station)));
        matched++;collapsed+=Math.max(0,matches.length-1);
      }else if(stationInArea(record,origin,radiusKm)){
        merged.push(mergedE55cStation(record,data,[]));added++;
      }
    }
    const output=[...catalog.filter((_,index)=>!consumed.has(index)),...merged];
    window.TCC_E55C_MERGE_STATS={strictStations:data.stations.length,matched,added,collapsedSourceDuplicates:collapsed,outputStations:output.length};
    return output;
  }

  async function rowsNear(lat,lon,radiusKm){
    const manifest=await loadManifest();
    const version=manifest.runtimePatchedAt||manifest.allSha256||manifest.generatedAt||'';
    if(!(radiusKm>0))return readGzipJson(manifest.allFile,version);
    const tiles=(manifest.tiles||[]).filter(tile=>intersects(tile,lat,lon,radiusKm));
    const chunks=await Promise.all(tiles.map(tile=>readGzipJson(tile.file,version)));
    return chunks.flat();
  }

  if(typeof candidateStations!=='function'){
    console.warn('[TCC V8] Catalogue France non chargé : candidateStations indisponible.');return;
  }
  const originalCandidateStations=candidateStations;
  candidateStations=async function(filterMode='tesla',maxDistanceKm=0){
    if(filterMode!=='all')return originalCandidateStations(filterMode,maxDistanceKm);
    const originText=document.getElementById('simOrigin')?.value?.trim()||localStorage.getItem('tccDefaultOrigin')||'Ma position';
    const origin=await resolveOrigin(originText);
    const [rows,statuses,e55c]=await Promise.all([rowsNear(origin.lat,origin.lon,Number(maxDistanceKm)||0),loadStatusSnapshot(),loadE55cCatalog()]);
    const dayIndex=dayIndexFromSimulation();
    const baseCatalog=rows.map(row=>applyOperationalStatus(stationFromRow(row,dayIndex),statuses));
    const catalog=mergeE55cCatalog(baseCatalog,e55c,origin,Number(maxDistanceKm)||0);
    const originalStations=stations;
    const ids=new Set(originalStations.map(station=>station.id));
    const extra=catalog.filter(station=>!ids.has(station.id));
    try{
      stations=[...originalStations,...extra];
      const result=await originalCandidateStations(filterMode,maxDistanceKm);
      if(result){
        result.franceCatalogLoaded=extra.length;
        result.e55cCatalogLoaded=true;
        result.e55cMergeStats={...(window.TCC_E55C_MERGE_STATS||{})};
      }
      return result;
    }finally{stations=originalStations;}
  };

  window.TCCFranceCatalog={loadManifest,loadStatusSnapshot,loadE55cCatalog,clearCache(){rawCache.clear();manifestPromise=null;statusPromise=null;e55cPromise=null;},get cachedFragments(){return rawCache.size;}};
  window.TCCFranceCatalogV8={stationFromRow,mergeE55cCatalog,mergedE55cStation,directConfigurations,isE55cOperator,geoDistanceKm};
  console.info('[TCC V8] Catalogue national France enrichi des stations et tarifs directs E55C.');
})();
