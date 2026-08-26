// Tesla Charge Companion V8 — catalogue national France enrichi E55C + Belib' + IONITY + Atlante + Powerdot + e-Totem.
// Le socle Electroverse/Electra reste l'autorité des statuts. Les inventaires CPO
// stricts ajoutent les stations manquantes et leurs tarifs directs vérifiés.
(function(){
  'use strict';
  const BASE='data/non_tesla_france/';
  const E55C_URL='data/e55c_station_tariffs_v1.json.gz';
  const BELIB_URL='data/belib_station_tariffs_v1.json.gz';
  const BELIB_LIVE_URL='https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/belib-points-de-recharge-pour-vehicules-electriques-disponibilite-temps-reel/exports/json';
  const BELIB_LIVE_TTL_MS=5*60*1000;
  const IONITY_URL='data/ionity_direct_stations_france.json.gz';
  const ATLANTE_URL='data/atlante_direct_stations_france.json.gz';
  const POWERDOT_URL='../data/powerdot_direct_france.json.gz';
  const ETOTEM_URL='../data/etotem_direct_tariffs_france.json.gz';
  const rawCache=new Map();
  let manifestPromise=null,statusPromise=null,e55cPromise=null,belibPromise=null,belibLivePromise=null,belibLiveLoadedAt=0,ionityPromise=null,atlantePromise=null,powerdotPromise=null,etotemPromise=null;
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

  async function loadBelibCatalog(){
    if(!belibPromise)belibPromise=fetch(`${BELIB_URL}?v=${Date.now()}`,{cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error(`Base Belib indisponible (${response.status})`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('Compression Belib invalide');
      if(typeof DecompressionStream!=='function')throw new Error('Décompression Belib indisponible dans ce navigateur');
      return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    }).then(data=>{
      if(data?.dataset!=='belib-operated-paris-tcc-v8')throw new Error('Dataset Belib inattendu');
      if(data?.scope?.activeInV73!==false||data?.scope?.dynamicStatusIncluded!==false)throw new Error('Garde-fou Belib V8 invalide');
      if(data?.scope?.strictOperatorField!=='nom_operateur'||data?.scope?.strictOperatorValue!=='TOTALENERGIES')throw new Error('Filtre opérateur Belib invalide');
      if(data?.scope?.strictBrandField!=='nom_enseigne'||data?.scope?.strictBrandValue!=="Belib'")throw new Error('Filtre enseigne Belib invalide');
      if(data?.scope?.parkingFeesIncluded!==false)throw new Error('Le parking Belib ne doit pas être intégré');
      if(!Array.isArray(data?.stations)||Number(data?.stats?.stationCount)!==data.stations.length||data.stations.length<350)throw new Error('Inventaire Belib incomplet');
      window.TCC_BELIB_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base Belib ignorée :',error?.message||error);
      return {profiles:{},stations:[],stats:{}};
    });
    return belibPromise;
  }

  async function loadBelibLive(force=false){
    if(force||!belibLivePromise||Date.now()-belibLiveLoadedAt>BELIB_LIVE_TTL_MS){
      belibLiveLoadedAt=Date.now();
      belibLivePromise=fetch(`${BELIB_LIVE_URL}?v=${belibLiveLoadedAt}`,{cache:'no-store'}).then(async response=>{
        if(!response.ok)throw new Error(`Statuts Belib indisponibles (${response.status})`);
        const rows=await response.json();
        if(!Array.isArray(rows)||rows.length<1000)throw new Error(`Flux Belib incomplet (${rows?.length||0} EVSE)`);
        const evses={};
        for(const row of rows){
          const id=text(row?.id_pdc);if(!id)continue;
          const previous=evses[id],currentTime=Date.parse(row?.last_updated||'')||0,previousTime=Date.parse(previous?.last_updated||'')||0;
          if(!previous||currentTime>=previousTime)evses[id]={status:text(row?.statut_pdc),last_updated:text(row?.last_updated)};
        }
        const result={fetchedAt:new Date().toISOString(),source:BELIB_LIVE_URL,evses};
        window.TCC_BELIB_LIVE_V1=result;
        return result;
      }).catch(error=>{
        console.warn('[TCC V8] Statuts directs Belib ignorés :',error?.message||error);
        return {fetchedAt:'',source:BELIB_LIVE_URL,evses:{},error:text(error?.message||error)};
      });
    }
    return belibLivePromise;
  }

  async function readStandaloneGzip(url,label){
    const response=await fetch(`${url}?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`${label} indisponible (${response.status})`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error(`Compression ${label} invalide`);
    if(typeof DecompressionStream!=='function')throw new Error(`Décompression ${label} indisponible dans ce navigateur`);
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }

  async function loadIonityCatalog(){
    if(!ionityPromise)ionityPromise=readStandaloneGzip(IONITY_URL,'IONITY').then(data=>{
      if(data?.dataset!=='ionity-direct-operated-stations-france')throw new Error('Dataset IONITY inattendu');
      if(data?.scope?.requiredCpoIdentifier!=='IONITY_CPO'||data?.scope?.onlyOperatedLocations!==true)throw new Error('Filtre CPO IONITY invalide');
      if(data?.scope?.tariffFamily!=='IONITY DIRECT'||data?.scope?.subscriberTariffsIncluded!==false||data?.scope?.roamingTariffsIncluded!==false)throw new Error('Périmètre tarifaire IONITY invalide');
      if(!Array.isArray(data?.locations)||Number(data?.counts?.franceLocationCount)!==data.locations.length||data.locations.length<100)throw new Error('Inventaire IONITY France incomplet');
      if(data.locations.some(location=>location?.country!=='FR'||location?.cpoIdentifier!=='IONITY_CPO'))throw new Error('Station hors périmètre IONITY_CPO');
      window.TCC_IONITY_DIRECT_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base IONITY Direct ignorée :',error?.message||error);
      return {locations:[],counts:{}};
    });
    return ionityPromise;
  }

  async function loadAtlanteCatalog(){
    if(!atlantePromise)atlantePromise=readStandaloneGzip(ATLANTE_URL,'Atlante').then(data=>{
      if(data?.dataset!=='atlante-direct-operated-stations-france')throw new Error('Dataset Atlante inattendu');
      if(data?.scope?.requiredCpo!=='FRATL'||data?.scope?.requiredCountryCode!=='FR'||data?.scope?.requiredPartyId!=='ATL'||data?.scope?.onlyOperatedLocations!==true)throw new Error('Filtre CPO Atlante invalide');
      if(data?.scope?.partnerLocationsIncluded!==false||data?.scope?.atlanteGoIncluded!==false||data?.scope?.roamingTariffsIncluded!==false)throw new Error('Périmètre tarifaire Atlante invalide');
      if(data?.scope?.priceGranularity!=='connector'||data?.scope?.onlyUnconditionalEnergyPrices!==true)throw new Error('Granularité tarifaire Atlante invalide');
      if(!Array.isArray(data?.locations)||Number(data?.counts?.franceLocationCount)!==data.locations.length||data.locations.length<100)throw new Error('Inventaire Atlante France incomplet');
      if(data.locations.some(location=>location?.countryCode!=='FR'||location?.partyId!=='ATL'||location?.operatorName!=='Atlante'))throw new Error('Station partenaire présente dans la base Atlante directe');
      window.TCC_ATLANTE_DIRECT_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base Atlante directe ignorée :',error?.message||error);
      return {locations:[],counts:{}};
    });
    return atlantePromise;
  }

  async function loadPowerdotCatalog(){
    if(!powerdotPromise)powerdotPromise=readStandaloneGzip(POWERDOT_URL,'Powerdot').then(data=>{
      if(data?.source?.sourceType!=='direct_cpo_public_adhoc_api'||data?.source?.roaming!==false||text(data?.source?.emspCode)!==''||text(data?.source?.operator)!=='Power Dot France')throw new Error('Contexte tarifaire Powerdot invalide');
      if(!Array.isArray(data?.chargers)||Number(data?.counts?.apiSuccessChargers)!==data.chargers.length||data.chargers.length<2200)throw new Error('Inventaire Powerdot incomplet');
      if(Number(data?.counts?.pricedConnectors)<7000||Number(data?.counts?.coveredIrveStations)<1000)throw new Error('Couverture Powerdot insuffisante');
      if(data.chargers.some(entry=>entry?.location?.countryCode!=='FR'))throw new Error('Station Powerdot hors France');
      if(data.chargers.some(entry=>(entry?.charger?.connectors||[]).some(connector=>connector?.tariff?.subscriptionActive===true)))throw new Error('Tarif abonné présent dans la base Powerdot directe');
      window.TCC_POWERDOT_DIRECT_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base Powerdot directe ignorée :',error?.message||error);
      return {chargers:[],counts:{}};
    });
    return powerdotPromise;
  }


  async function loadEtotemCatalog(){
    if(!etotemPromise)etotemPromise=readStandaloneGzip(ETOTEM_URL,'e-Totem').then(data=>{
      if(data?.scope?.physicalCpoDirectOnly!==true||data?.scope?.roamingIncluded!==false||data?.scope?.noGuessedFallback!==true)throw new Error('Périmètre e-Totem direct invalide');
      if(!Array.isArray(data?.stations)||Number(data?.counts?.inventoryStations)!==data.stations.length||data.stations.length<600)throw new Error('Inventaire e-Totem incomplet');
      if(Number(data?.counts?.resolvedStations)<500||Number(data?.counts?.resolvedWithTariffText)<450)throw new Error('Couverture tarifaire e-Totem insuffisante');
      if(data.stations.some(record=>record?.resolved&&(String(record?.api?.bOcpi??0)!=='0'||String(record?.api?.bGireve??0)!=='0'||String(record?.api?.bItinerance??0)!=='0')))throw new Error('Station e-Totem itinérante présente dans la base directe');
      window.TCC_ETOTEM_DIRECT_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base e-Totem directe ignorée :',error?.message||error);
      return {stations:[],counts:{},coverageByFamily:{}};
    });
    return etotemPromise;
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
      k:Number(rule.pricePerKwh||0),m:Number(rule.chargePerMinute||0),p:Number(rule.parkingPerMinute||0),f:Number(rule.connectionFee||0),i:Number(rule.idlePerMinute||0),ig:Number(rule.idleGraceMinutes||0),ic:Number(rule.idleCap||0),ics:rule.idleCapStart||'',ice:rule.idleCapEnd||'',
      ar:Number(rule.afterMinutesRate||0),at:Number(rule.afterMinutesThreshold||0),bc:Number(rule.belibConnectedTimePerMinute||0)
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
  function isIonityOperator(station){
    return norm(station?.operator)==='ionity';
  }
  function isAtlanteOperator(station){
    const value=norm(station?.operator);
    return value==='atlante'||value==='atlante france';
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
      const key=[norm(provider),text(config.kind).toUpperCase(),Number(config.powerKw||0).toFixed(3),pricingSignature(config.pricing),text(config.e55cPricingProfileId),text(config.belibPricingProfileId)].join('|');
      const existing=map.get(key);
      if(!existing){map.set(key,config);continue;}
      existing.stalls=Math.max(Number(existing.stalls||0),Number(config.stalls||0));
      if(config.e55cEvseIds)existing.e55cEvseIds=[...new Set([...(existing.e55cEvseIds||[]),...config.e55cEvseIds])];
      if(config.e55cPaymentUrls)existing.e55cPaymentUrls=[...new Set([...(existing.e55cPaymentUrls||[]),...config.e55cPaymentUrls])];
      if(config.belibEvseIds)existing.belibEvseIds=[...new Set([...(existing.belibEvseIds||[]),...config.belibEvseIds])];
      if(config.atlanteEvseIds)existing.atlanteEvseIds=[...new Set([...(existing.atlanteEvseIds||[]),...config.atlanteEvseIds])];
      if(config.atlanteConnectorIds)existing.atlanteConnectorIds=[...new Set([...(existing.atlanteConnectorIds||[]),...config.atlanteConnectorIds])];
      if(config.powerdotIrvePdcIds)existing.powerdotIrvePdcIds=[...new Set([...(existing.powerdotIrvePdcIds||[]),...config.powerdotIrvePdcIds])];
      if(config.powerdotChargerNames)existing.powerdotChargerNames=[...new Set([...(existing.powerdotChargerNames||[]),...config.powerdotChargerNames])];
      if(config.powerdotTariffIds)existing.powerdotTariffIds=[...new Set([...(existing.powerdotTariffIds||[]),...config.powerdotTariffIds])];
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

  function isBelibOperator(station){
    const value=norm(station?.operator);
    return value==='belib'||value.startsWith('belib ');
  }
  function belibProvider(profile){
    if(profile?.customerPlan==='resident')return 'Belib’ direct — Abonné résident Paris';
    if(profile?.customerPlan==='nonresident')return 'Belib’ direct — Abonné non-résident';
    return 'Belib’ direct — Visiteur';
  }
  function pricingWithoutParking(pricing){
    const copy=deepClone(pricing||{type:'rules',rules:[]});
    copy.type='rules';
    copy.rules=(copy.rules||[]).map(rule=>{
      const clean={...rule};
      delete clean.parkingPerMinute;
      delete clean.parkingFee;
      delete clean.parkingCost;
      return clean;
    });
    return copy;
  }
  function directBelibConfigurations(record,data){
    const output=[];
    for(const [configIndex,config] of (record.configurations||[]).entries()){
      for(const profileId of config.pricingProfileIds||[]){
        const profile=data?.profiles?.[profileId];if(!profile)continue;
        const provider=belibProvider(profile),kind=text(config.kind).toUpperCase(),power=Number(config.powerKw);
        output.push({
          id:`belib-direct-${record.stationId}-${configIndex}-${profileId}`,
          label:`${provider} · ${kind} ${power} kW`,kind,powerKw:power,stalls:Number(config.stalls||0),
          pricing:pricingWithoutParking({type:'rules',rules:profile.rules}),offerProvider:provider,offerType:'operator_direct',
          subscriptionId:profile.subscriptionId||null,belibDirect:true,belibVerified:true,belibPricingProfileId:profileId,
          belibCustomerPlan:profile.customerPlan,belibServiceClass:config.serviceClass,belibAnnualFeeEur:Number(profile.annualFeeEur||0),
          belibParkingExcluded:true,belibEvseIds:[...(config.evseIds||[])],belibRoamingEvseIds:[...(config.roamingEvseIds||[])]
        });
      }
    }
    return output;
  }
  function inferBelibServiceClass(config){
    const rules=config?.pricing?.rules||[];
    const perMinute=Math.max(0,...rules.flatMap(rule=>[Number(rule.chargePerMinute||0),Number(rule.idlePerMinute||0)]));
    const perKwh=Math.max(0,...rules.map(rule=>Number(rule.pricePerKwh||0)));
    if(perMinute>=.3)return 'boostPlus';
    if(perMinute>=.1&&perKwh===0)return 'boost';
    if(perKwh>0)return 'flex';
    const power=Number(config?.powerKw||0);
    return power>45?'boostPlus':power>10?'boost':'flex';
  }
  function remapBelibConfig(config,record){
    const kind=text(config?.kind).toUpperCase(),power=Number(config?.powerKw||0),serviceClass=inferBelibServiceClass(config);
    const candidates=(record.configurations||[]).filter(item=>text(item.kind).toUpperCase()===kind&&item.serviceClass===serviceClass)
      .map(item=>({...item,distance:Math.abs(Number(item.powerKw)-power)})).sort((a,b)=>a.distance-b.distance);
    const nearest=candidates[0];
    if(!nearest||nearest.distance>Math.max(1.1,Number(nearest.powerKw)*.20)+1e-9)return null;
    const copy={...config,powerKw:Number(nearest.powerKw),pricing:pricingWithoutParking(config.pricing),belibParkingExcluded:true};
    const provider=providerFromConfigLabel(copy.label)||text(copy.offerProvider);
    if(provider)copy.label=`${provider} · ${kind} ${copy.powerKw} kW`;
    return copy;
  }
  function belibStreetKey(value){
    return norm(value).split(' ').filter(token=>!/^\d/.test(token)&&token!=='paris'&&token!=='france').join(' ');
  }
  function belibLiveStatus(record,live,target){
    const ids=[...new Set((record.configurations||[]).flatMap(config=>config.evseIds||[]))];
    const entries=ids.map(id=>live?.evses?.[id]).filter(Boolean);
    if(!entries.length)return target;
    const values=entries.map(entry=>text(entry.status)).filter(Boolean),normalized=values.map(norm);
    const outValues=new Set(['hors service','en maintenance','maintenance','supprime','supprimee','planifie','planifiee']);
    const available=normalized.some(value=>value==='disponible');
    const outOfService=normalized.length>0&&normalized.every(value=>outValues.has(value));
    target.operationalStatus=available?'available':outOfService?'out_of_service':'unknown';
    target.operationalStatusRaw=[...new Set(values)];
    target.operationalStatusCheckedAt=live.fetchedAt||'';
    target.operationalStatusSource='Paris Open Data — Belib’ temps réel';
    target.operationalStatusStale=false;
    target.scheduledClosureOverride=false;
    target.belibLiveStatusJoined=true;
    target.belibLiveStatusCounts={
      expectedEvse:ids.length,reportedEvse:entries.length,available:normalized.filter(value=>value==='disponible').length,
      occupied:normalized.filter(value=>value==='occupe'||value==='occupee').length,outOfService:normalized.filter(value=>outValues.has(value)).length
    };
    return target;
  }
  function mergedBelibStation(record,data,matches=[],live={evses:{}}){
    const direct=directBelibConfigurations(record,data);
    const existing=matches.flatMap(station=>(station.chargingConfigurations||[]).map(config=>remapBelibConfig(config,record)).filter(Boolean));
    const configurations=mergeConfigurations([...existing,...direct]);
    const first=configurations.find(config=>config.belibDirect)||configurations[0]||{kind:'AC',powerKw:Number(record.maxPowerKw||11),pricing:{type:'rules',rules:[]}};
    const merged={
      id:`france-catalog:belib:${record.stationId}`,catalogStationId:`belib:${record.stationId}`,name:record.name||'Station Belib’',address:record.address||'',
      latitude:Number(record.coordinates[0]),longitude:Number(record.coordinates[1]),operator:'Belib’ (TotalEnergies)',stalls:Number(record.chargePointCount||0),
      kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,
      access:{limited:false,unknown:false,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Accès Belib’ '+(record.access?.hours||'24/7'),condition:record.access?.condition||''},
      lastUpdated:record.lastUpdated||String(data.generatedAt||'').slice(0,10),source:'belibOfficialCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,
      belibStrictOperator:true,belibStationId:record.stationId,belibRoamingStationId:record.roamingStationId,belibParkingExcluded:true,
      belibSourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),belibStatusFallbackJoined:matches.length>0,
      belibOfficialEvseIds:[...new Set((record.configurations||[]).flatMap(config=>config.evseIds||[]))]
    };
    mergeStatus(merged,matches);
    return belibLiveStatus(record,live,merged);
  }
  function mergeBelibCatalog(catalog,data,live={evses:{}},origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.stations)||!data.stations.length)return catalog;
    const official=(data.stations||[]).filter(record=>stationInArea(record,origin,radiusKm));
    const source=catalog.map((station,index)=>({station,index})).filter(item=>isBelibOperator(item.station));
    const matches=new Map(official.map(record=>[record.stationId,[]])),assigned=new Set();
    const assign=(item,maxDistanceKm,requireStreet)=>{
      const sourceKey=belibStreetKey(item.station.address||item.station.name),candidate=official.map(record=>({record,distance:geoDistanceKm(item.station.latitude,item.station.longitude,record.coordinates[0],record.coordinates[1])}))
        .filter(entry=>entry.distance<=maxDistanceKm+1e-9&&(!requireStreet||belibStreetKey(entry.record.address)===sourceKey)).sort((a,b)=>a.distance-b.distance)[0];
      if(!candidate)return false;
      matches.get(candidate.record.stationId).push(item.station);assigned.add(item.index);return true;
    };
    source.forEach(item=>assign(item,.012,false));
    source.filter(item=>!assigned.has(item.index)).forEach(item=>assign(item,.06,true));
    const merged=official.map(record=>mergedBelibStation(record,data,matches.get(record.stationId)||[],live));
    const matched=merged.filter(station=>station.belibSourceCatalogStationIds.length).length;
    const collapsed=merged.reduce((sum,station)=>sum+Math.max(0,station.belibSourceCatalogStationIds.length-1),0);
    const output=[...catalog.filter(station=>!isBelibOperator(station)),...merged];
    window.TCC_BELIB_MERGE_STATS={strictStations:data.stations.length,strictStationsInArea:official.length,sourceBelibStations:source.length,matched,added:official.length-matched,collapsedSourceDuplicates:collapsed,excludedSourceStations:source.length-assigned.size,outputStations:output.length};
    return output;
  }

  function ionityPricing(pricePerKwhEur){
    return {type:'rules',rules:[{
      scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(pricePerKwhEur),
      chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,
      afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'
    }]};
  }
  function ionityDirectConfigurations(location){
    const groups=new Map(),powerVariants=new Map();
    for(const connector of location.connectors||[]){
      const kind=text(connector.kind).toUpperCase(),power=Number(connector.powerKw),price=Number(connector.pricePerKwhEur);
      if(!['AC','DC'].includes(kind)||!(power>0)||!(price>0))continue;
      const powerKey=`${kind}|${power.toFixed(3)}`,key=`${powerKey}|${price.toFixed(6)}`;
      if(!groups.has(key))groups.set(key,{kind,power,price,connectors:[]});
      groups.get(key).connectors.push(connector);
      if(!powerVariants.has(powerKey))powerVariants.set(powerKey,new Set());
      powerVariants.get(powerKey).add(price.toFixed(6));
    }
    return [...groups.values()].map((group,index)=>{
      const refs=[...new Set(group.connectors.map(connector=>text(connector.physicalReference)||text(connector.number)).filter(Boolean))];
      const powerKey=`${group.kind}|${group.power.toFixed(3)}`;
      const provider=powerVariants.get(powerKey)?.size>1?`IONITY Direct (bornes ${refs.join(', ')})`:'IONITY Direct';
      return {
        id:`ionity-direct-${location.uuid}-${index}`,
        label:`${provider} · ${group.kind} ${group.power} kW`,kind:group.kind,powerKw:group.power,stalls:group.connectors.length,
        pricing:ionityPricing(group.price),offerProvider:provider,offerType:'operator_direct',ionityDirect:true,ionityVerified:true,
        ionityLocationUuid:location.uuid,ionityLocationId:location.locationId||'',ionityConnectorUuids:group.connectors.map(connector=>connector.uuid).filter(Boolean),
        ionityPhysicalReferences:refs,ionityPricePerKwhEur:group.price
      };
    });
  }
  function mergedIonityStation(location,data,matches=[]){
    const direct=ionityDirectConfigurations(location);
    const existing=matches.flatMap(station=>station.chargingConfigurations||[]);
    const configurations=mergeConfigurations([...existing,...direct]);
    const first=configurations[0]||direct[0]||{kind:'DC',powerKw:350,pricing:{type:'rules',rules:[]}};
    const base=matches.length?{...primaryStation(matches)}:{
      id:`france-catalog:ionity:${location.uuid}`,catalogStationId:`ionity:${location.uuid}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,
      access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la fiche IONITY — accès à vérifier.'}
    };
    const merged={
      ...base,name:location.name||base.name,address:[location.address,location.postalCode,location.city].filter(Boolean).join(', ')||base.address,
      latitude:Number(location.latitude),longitude:Number(location.longitude),operator:'IONITY',stalls:Number(location.pricedConnectorCount||location.connectorCount||0),
      kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,lastUpdated:String(data.generatedAt||'').slice(0,10),
      ionityStrictCpo:true,ionityCpoIdentifier:'IONITY_CPO',ionityLocationUuid:location.uuid,ionityLocationId:location.locationId||'',
      ionitySourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),ionityStatusJoinedExternally:matches.length>0,
      ionityDirectConnectorCount:Number(location.pricedConnectorCount||0)
    };
    return mergeStatus(merged,matches);
  }
  function mergeIonityCatalog(catalog,data,origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.locations)||!data.locations.length)return catalog;
    const locations=data.locations.filter(location=>!(radiusKm>0)||geoDistanceKm(origin.lat,origin.lon,location.latitude,location.longitude)<=radiusKm+.2);
    const assignments=new Map(),consumed=new Set();
    for(let index=0;index<catalog.length;index++){
      const station=catalog[index];
      if(!isIonityOperator(station)||!Number.isFinite(Number(station.latitude))||!Number.isFinite(Number(station.longitude)))continue;
      let best=null;
      for(const location of locations){
        const distance=geoDistanceKm(station.latitude,station.longitude,location.latitude,location.longitude);
        if(distance<=.15+1e-9&&(!best||distance<best.distance))best={location,distance};
      }
      if(!best)continue;
      if(!assignments.has(best.location.uuid))assignments.set(best.location.uuid,[]);
      assignments.get(best.location.uuid).push({index,station});consumed.add(index);
    }
    let matched=0,added=0,collapsed=0;
    const merged=locations.map(location=>{
      const matches=assignments.get(location.uuid)||[];
      if(matches.length){matched++;collapsed+=Math.max(0,matches.length-1);}else added++;
      return mergedIonityStation(location,data,matches.map(match=>match.station));
    });
    const output=[...catalog.filter((_,index)=>!consumed.has(index)),...merged];
    window.TCC_IONITY_MERGE_STATS={strictStations:data.locations.length,inAreaStations:locations.length,matched,added,collapsedSourceDuplicates:collapsed,outputStations:output.length};
    return output;
  }

  function atlanteDirectConfigurations(location){
    const groups=new Map(),powerVariants=new Map();
    for(const connector of location.connectors||[]){
      const kind=text(connector.kind).toUpperCase(),power=Number(connector.powerKw),price=Number(connector.pricePerKwhEur);
      if(!['AC','DC'].includes(kind)||!(power>0)||!(price>0))continue;
      const powerKey=`${kind}|${power.toFixed(3)}`,key=`${powerKey}|${price.toFixed(6)}`;
      if(!groups.has(key))groups.set(key,{kind,power,price,connectors:[]});
      groups.get(key).connectors.push(connector);
      if(!powerVariants.has(powerKey))powerVariants.set(powerKey,new Set());
      powerVariants.get(powerKey).add(price.toFixed(6));
    }
    return [...groups.values()].map((group,index)=>{
      const references=[...new Set(group.connectors.map(connector=>text(connector.evseId).split('*').at(-1)||text(connector.externalConnectorId)).filter(Boolean))];
      const powerKey=`${group.kind}|${group.power.toFixed(3)}`;
      const provider=powerVariants.get(powerKey)?.size>1?`Atlante direct (bornes ${references.join(', ')})`:'Atlante direct';
      return {
        id:`atlante-direct-${location.id}-${index}`,
        label:`${provider} · ${group.kind} ${group.power} kW`,kind:group.kind,powerKw:group.power,stalls:group.connectors.length,
        pricing:ionityPricing(group.price),offerProvider:provider,offerType:'operator_direct',atlanteDirect:true,atlanteVerified:true,
        atlanteLocationUuid:location.id,atlanteLocationId:location.locationId||'',atlanteEvseIds:group.connectors.map(connector=>connector.evseId).filter(Boolean),
        atlanteConnectorIds:group.connectors.map(connector=>connector.connectorId).filter(Boolean),atlantePricePerKwhEur:group.price
      };
    });
  }
  function mergedAtlanteStation(location,data,matches=[]){
    const direct=atlanteDirectConfigurations(location);
    const existing=matches.flatMap(station=>station.chargingConfigurations||[]);
    const configurations=mergeConfigurations([...existing,...direct]);
    const first=configurations.find(config=>config.atlanteDirect)||configurations[0]||{kind:'DC',powerKw:150,pricing:{type:'rules',rules:[]}};
    const base=matches.length?{...primaryStation(matches)}:{
      id:`france-catalog:atlante:${location.id}`,catalogStationId:`atlante:${location.id}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,
      access:{limited:false,unknown:!location.openTwentyFourSeven,days:{},afterCloseMode:'exit_allowed',afterCloseNote:location.openTwentyFourSeven?'Accès Atlante 24/7.':'Horaires à vérifier dans myAtlante.'}
    };
    const merged={
      ...base,name:location.name||base.name,address:[location.address,location.postalCode,location.city].filter(Boolean).join(', ')||base.address,
      latitude:Number(location.latitude),longitude:Number(location.longitude),operator:'Atlante',stalls:Number(location.pricedConnectorCount||location.connectorCount||0),
      kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,lastUpdated:String(data.generatedAt||'').slice(0,10),
      atlanteStrictCpo:true,atlanteCpo:'FRATL',atlanteCountryCode:'FR',atlantePartyId:'ATL',atlanteLocationUuid:location.id,atlanteLocationId:location.locationId||'',
      atlanteSourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),atlanteStatusJoinedExternally:matches.length>0,
      atlanteDirectConnectorCount:Number(location.pricedConnectorCount||0)
    };
    return mergeStatus(merged,matches);
  }
  function mergeAtlanteCatalog(catalog,data,origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.locations)||!data.locations.length)return catalog;
    const locations=data.locations.filter(location=>!(radiusKm>0)||geoDistanceKm(origin.lat,origin.lon,location.latitude,location.longitude)<=radiusKm+.2);
    const assignments=new Map(),consumed=new Set();
    for(let index=0;index<catalog.length;index++){
      const station=catalog[index];
      if(!isAtlanteOperator(station)||!Number.isFinite(Number(station.latitude))||!Number.isFinite(Number(station.longitude)))continue;
      let best=null;
      for(const location of locations){
        const distance=geoDistanceKm(station.latitude,station.longitude,location.latitude,location.longitude);
        if(distance<=.15+1e-9&&(!best||distance<best.distance))best={location,distance};
      }
      if(!best)continue;
      if(!assignments.has(best.location.id))assignments.set(best.location.id,[]);
      assignments.get(best.location.id).push({index,station});consumed.add(index);
    }
    let matched=0,added=0,collapsed=0;
    const merged=locations.map(location=>{
      const matches=assignments.get(location.id)||[];
      if(matches.length){matched++;collapsed+=Math.max(0,matches.length-1);}else added++;
      return mergedAtlanteStation(location,data,matches.map(match=>match.station));
    });
    const output=[...catalog.filter((_,index)=>!consumed.has(index)),...merged];
    window.TCC_ATLANTE_MERGE_STATS={strictStations:data.locations.length,inAreaStations:locations.length,matched,added,collapsedSourceDuplicates:collapsed,outputStations:output.length};
    return output;
  }

  function isPowerdotOperator(station){
    const value=norm(station?.operator);
    return value==='powerdot'||value==='power dot'||value.startsWith('powerdot ')||value.startsWith('power dot ');
  }
  function powerdotPricing(tariff){
    const rule={scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:(text(tariff?.currencyCode)||'EUR').toUpperCase(),pricePerKwh:0,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'};
    let hasPrice=false;
    for(const element of tariff?.elements||[]){
      const restrictions=element?.restrictions||{};
      for(const component of element?.priceComponents||[]){
        const type=text(component?.type).toUpperCase(),price=Number(component?.pricePerUnit);
        if(!Number.isFinite(price)||price<0)continue;
        if(type==='ENERGY'&&price>0){rule.pricePerKwh=price;hasPrice=true;}
        else if(type==='FLAT'&&price>0){rule.connectionFee=price;hasPrice=true;}
        else if(type==='PARKING_TIME'&&price>0){rule.idlePerMinute=price;hasPrice=true;}
        else if(type==='TIME'&&price>0){
          const thresholdSec=Number(restrictions?.minDurationSec||0);
          if(thresholdSec>0){rule.afterMinutesRate=price;rule.afterMinutesThreshold=thresholdSec/60;}
          else rule.chargePerMinute=price;
          hasPrice=true;
        }
      }
    }
    return hasPrice?{type:'rules',rules:[rule]}:{type:'rules',rules:[]};
  }
  function powerdotLocations(data){
    const map=new Map();
    for(const entry of data?.chargers||[]){
      const location=entry?.location||{},latitude=Number(location.latitude),longitude=Number(location.longitude);
      if(location.countryCode!=='FR'||!Number.isFinite(latitude)||!Number.isFinite(longitude))continue;
      const key=text(location.id)||text(location.uid)||`${latitude.toFixed(6)}|${longitude.toFixed(6)}|${norm(location.name)}`;
      if(!map.has(key))map.set(key,{id:key,uid:text(location.uid),name:text(location.name),address:text(location.address),zipcode:text(location.zipcode),city:text(location.city),latitude,longitude,countryCode:'FR',chargers:[],irvePdcIds:[]});
      const target=map.get(key);
      target.chargers.push(entry);
      target.irvePdcIds=[...new Set([...target.irvePdcIds,...(entry.irvePdcIds||[])])];
    }
    return [...map.values()];
  }
  function powerdotConnectorKind(connector){
    const type=Number(connector?.type||0);
    if(type===2)return 'AC';
    if(type===1)return 'DC';
    return Number(connector?.maxPowerKw||0)<=22.5?'AC':'DC';
  }
  function powerdotDirectConfigurations(location){
    const groups=new Map(),powerVariants=new Map();
    for(const entry of location.chargers||[]){
      const chargerName=text(entry?.chargerName)||text(entry?.charger?.chargerName);
      for(const connector of entry?.charger?.connectors||[]){
        const power=Number(connector?.maxPowerKw),kind=powerdotConnectorKind(connector),pricing=powerdotPricing(connector?.tariff);
        if(!(power>0)||!pricing.rules.length||!pricing.rules.some(rule=>Number(rule.pricePerKwh)>0||Number(rule.chargePerMinute)>0||Number(rule.connectionFee)>0||Number(rule.idlePerMinute)>0||Number(rule.afterMinutesRate)>0))continue;
        const powerKey=`${kind}|${power.toFixed(3)}`,signature=pricingSignature(pricing),key=`${powerKey}|${signature}`;
        if(!groups.has(key))groups.set(key,{kind,power,pricing,connectors:[],chargerNames:new Set(),irvePdcIds:new Set(),tariffIds:new Set()});
        const group=groups.get(key);group.connectors.push(connector);if(chargerName)group.chargerNames.add(chargerName);
        for(const id of entry.irvePdcIds||[])group.irvePdcIds.add(id);
        if(connector?.tariff?.id)group.tariffIds.add(connector.tariff.id);
        if(!powerVariants.has(powerKey))powerVariants.set(powerKey,new Set());powerVariants.get(powerKey).add(signature);
      }
    }
    return [...groups.values()].map((group,index)=>{
      const refs=[...new Set(group.connectors.map(connector=>text(connector.physicalReference)||String(connector.connectorNumber||'')).filter(Boolean))];
      const powerKey=`${group.kind}|${group.power.toFixed(3)}`;
      const provider=powerVariants.get(powerKey)?.size>1&&refs.length?`Powerdot direct (bornes ${refs.join(', ')})`:'Powerdot direct';
      return {id:`powerdot-direct-${location.id}-${index}`,label:`${provider} · ${group.kind} ${group.power} kW`,kind:group.kind,powerKw:group.power,stalls:group.connectors.length,pricing:group.pricing,offerProvider:provider,offerType:'operator_direct',powerdotDirect:true,powerdotVerified:true,powerdotLocationId:location.id,powerdotLocationUid:location.uid,powerdotChargerNames:[...group.chargerNames],powerdotIrvePdcIds:[...group.irvePdcIds],powerdotTariffIds:[...group.tariffIds],powerdotPhysicalReferences:refs};
    });
  }
  function mergedPowerdotStation(location,data,matches=[]){
    const direct=powerdotDirectConfigurations(location);
    const existing=matches.flatMap(station=>station.chargingConfigurations||[]);
    const configurations=mergeConfigurations([...direct,...existing]);
    const first=direct[0]||configurations[0]||{kind:'DC',powerKw:50,pricing:{type:'rules',rules:[]}};
    const base=matches.length?{...primaryStation(matches)}:{id:`france-catalog:powerdot:${location.id}`,catalogStationId:`powerdot:${location.id}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la base tarifaire Powerdot — accès à vérifier.'}};
    const directConnectorCount=direct.reduce((sum,config)=>sum+Number(config.stalls||0),0);
    const merged={...base,name:location.name||base.name,address:[location.address,location.zipcode,location.city].filter(Boolean).join(', ')||base.address,latitude:Number(location.latitude),longitude:Number(location.longitude),operator:'Powerdot',stalls:directConnectorCount,kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,lastUpdated:String(data.generatedAt||'').slice(0,10),powerdotStrictCpo:true,powerdotDirectPricingContext:'adhoc_emsp_empty',powerdotLocationId:location.id,powerdotLocationUid:location.uid,powerdotIrvePdcIds:[...location.irvePdcIds],powerdotSourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),powerdotStatusJoinedExternally:matches.length>0,powerdotDirectConnectorCount:directConnectorCount};
    return mergeStatus(merged,matches);
  }
  function mergePowerdotCatalog(catalog,data,origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.chargers)||!data.chargers.length)return catalog;
    const allLocations=powerdotLocations(data).filter(location=>powerdotDirectConfigurations(location).length>0);
    const locations=allLocations.filter(location=>!(radiusKm>0)||geoDistanceKm(origin.lat,origin.lon,location.latitude,location.longitude)<=radiusKm+.10);
    const assignments=new Map(),consumed=new Set();
    for(let index=0;index<catalog.length;index++){
      const station=catalog[index];
      if(!isPowerdotOperator(station)||!Number.isFinite(Number(station.latitude))||!Number.isFinite(Number(station.longitude)))continue;
      let best=null;
      for(const location of locations){const distance=geoDistanceKm(station.latitude,station.longitude,location.latitude,location.longitude);if(distance<=.08+1e-9&&(!best||distance<best.distance))best={location,distance};}
      if(!best)continue;
      if(!assignments.has(best.location.id))assignments.set(best.location.id,[]);
      assignments.get(best.location.id).push({index,station});consumed.add(index);
    }
    let matched=0,added=0,collapsed=0,directConnectors=0;
    const merged=locations.map(location=>{const matches=assignments.get(location.id)||[];if(matches.length){matched++;collapsed+=Math.max(0,matches.length-1);}else added++;const station=mergedPowerdotStation(location,data,matches.map(match=>match.station));directConnectors+=Number(station.powerdotDirectConnectorCount||0);return station;});
    const output=[...catalog.filter((_,index)=>!consumed.has(index)),...merged];
    window.TCC_POWERDOT_MERGE_STATS={sourceChargers:data.chargers.length,directLocations:allLocations.length,inAreaLocations:locations.length,matched,added,collapsedSourceDuplicates:collapsed,directConnectors,unresolvedIrveStations:Number(data?.counts?.uniqueIrveStations||0)-Number(data?.counts?.coveredIrveStations||0),outputStations:output.length};
    return output;
  }


  function isEtotemOperator(station){
    const value=norm(station?.operator);
    return value.includes('e totem')||value.includes('etotem')||value==='semob'||value.includes('saint etienne metropole');
  }
  function etotemNormTariff(value){return text(value).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
  function etotemNumber(value){const n=Number(String(value||'').replace(',','.'));return Number.isFinite(n)?n:null;}
  function etotemSections(value){
    const source=etotemNormTariff(value),marks=[];
    for(const match of source.matchAll(/(?:^|[\n;])\s*(AC|DC)\s*(?=[:\-–—]|\d|\s)/gi))marks.push({kind:match[1].toUpperCase(),index:match.index+(match[0].length-match[0].trimStart().length)});
    if(!marks.length){for(const match of source.matchAll(/\b(AC|DC)\b\s*[:\-–—]/gi))marks.push({kind:match[1].toUpperCase(),index:match.index});}
    marks.sort((a,b)=>a.index-b.index);const out={};
    for(let i=0;i<marks.length;i++){const mark=marks[i],end=marks[i+1]?.index??source.length;if(!out[mark.kind])out[mark.kind]=source.slice(mark.index,end).trim();}
    return {source,...out};
  }
  function etotemPriceCandidates(segment){
    const s=etotemNormTariff(segment),items=[];
    for(const match of s.matchAll(/(\d+(?:[.,]\d+)?)\s*€\s*(?:\/|par)?\s*kwh/gi)){
      const price=etotemNumber(match[1]);if(!(price>0))continue;
      const before=s.slice(Math.max(0,match.index-130),match.index),after=s.slice(match.index+match[0].length,Math.min(s.length,match.index+match[0].length+50));
      const context=(before+' '+after).toLowerCase();
      const eco=/\b(?:mode|tarif|offre)?\s*eco\b/.test(before.slice(-70).toLowerCase());
      let min=null,max=null;
      const ranges=[...(before.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à|a)\s*(\d+(?:[.,]\d+)?)\s*kw/gi))];
      if(ranges.length){const r=ranges.at(-1);min=etotemNumber(r[1]);max=etotemNumber(r[2]);}
      if(min==null){const upto=[...(before.matchAll(/jusqu(?:'|’|\s)*(?:a|à)?\s*(\d+(?:[.,]\d+)?)\s*kw/gi))];if(upto.length){min=0;max=etotemNumber(upto.at(-1)[1]);}}
      if(min==null){const single=[...(before.matchAll(/(\d+(?:[.,]\d+)?)\s*kw/gi))];if(single.length){const p=etotemNumber(single.at(-1)[1]);if(p!=null){min=Math.max(0,p-.6);max=p+.6;}}}
      items.push({price,eco,minKw:min,maxKw:max,context});
    }
    return items;
  }
  function etotemDefaultEnergyPrice(record,kind,powerKw){
    const sections=etotemSections(record?.tariffText||''),segment=sections[kind]||sections.source;
    let candidates=etotemPriceCandidates(segment).filter(item=>!item.eco);
    if(!candidates.length&&segment!==sections.source)candidates=etotemPriceCandidates(sections.source).filter(item=>!item.eco);
    if(!candidates.length)return null;
    const powerMatches=candidates.filter(item=>item.minKw!=null&&item.maxKw!=null&&powerKw>=item.minKw-1e-9&&powerKw<=item.maxKw+1e-9);
    if(powerMatches.length===1)return powerMatches[0].price;
    const unbounded=candidates.filter(item=>item.minKw==null&&item.maxKw==null);
    const unique=[...new Set(unbounded.map(item=>item.price.toFixed(6)))];
    if(unique.length===1)return Number(unique[0]);
    if(candidates.length===1)return candidates[0].price;
    return null;
  }
  function etotemPostChargePolicy(record,kind){
    const sections=etotemSections(record?.tariffText||''),segment=sections[kind]||sections.source,lower=segment.toLowerCase();
    if(/sans[^.;]{0,40}post[- ]charge/.test(lower))return {idlePerMinute:0,idleGraceMinutes:0,idleCap:0,idleCapStart:'00:00',idleCapEnd:'24:00'};
    if(!/(?:post[- ]charge|une fois[^.;]{0,45}v[eé]hicule[^.;]{0,30}(?:charg[eé]|recharg[eé])|apr[eè]s[^.;]{0,30}(?:fin de )?charge)/i.test(segment))return {idlePerMinute:0,idleGraceMinutes:0,idleCap:0,idleCapStart:'00:00',idleCapEnd:'24:00'};
    const graceMatch=segment.match(/(\d+)\s*min(?:ute)?s?\s+gratuite?s?/i);const grace=graceMatch?Number(graceMatch[1]):0;
    const fees=[...segment.matchAll(/(\d+(?:[.,]\d+)?)\s*€\s*(?:\/|par\s+(?:tranche[^0-9]{0,25})?)\s*(\d+)\s*min/gi)].map(m=>({eur:etotemNumber(m[1]),minutes:Number(m[2])})).filter(x=>x.eur>=0&&x.minutes>0);
    const unique=[...new Map(fees.map(x=>[`${x.eur}|${x.minutes}`,x])).values()];
    const rate=unique.length===1?unique[0].eur/unique[0].minutes:0;
    let idleCap=0,idleCapStart='00:00',idleCapEnd='24:00';
    const cap=segment.match(/plafonn?[eé][^0-9]{0,12}(\d+(?:[.,]\d+)?)\s*€(?:[^0-9]{0,25}(\d{1,2})h(?:\d{2})?[^0-9]{0,15}(\d{1,2})h(?:\d{2})?)?/i);
    if(cap){idleCap=etotemNumber(cap[1])||0;if(cap[2]&&cap[3]){idleCapStart=`${cap[2].padStart(2,'0')}:00`;idleCapEnd=`${cap[3].padStart(2,'0')}:00`;}}
    return {idlePerMinute:rate,idleGraceMinutes:grace,idleCap,idleCapStart,idleCapEnd};
  }
  function etotemPdcGroups(record){
    const groups=new Map();
    for(const pdc of record?.pdcs||[]){
      const connectors=(pdc?.connectors||[]).map(x=>text(x).toUpperCase());const power=Number(pdc?.powerKw||0);if(!(power>0))continue;
      const kind=connectors.some(x=>x.includes('CCS')||x.includes('CHADEMO'))?'DC':'AC';const key=`${kind}|${power.toFixed(3)}`;
      if(!groups.has(key))groups.set(key,{kind,power,stalls:0,pdcIds:[]});const group=groups.get(key);group.stalls++;if(pdc?.id)group.pdcIds.push(pdc.id);
    }
    return [...groups.values()];
  }
  function etotemDirectConfigurations(record){
    return etotemPdcGroups(record).map((group,index)=>{
      const price=etotemDefaultEnergyPrice(record,group.kind,group.power),post=etotemPostChargePolicy(record,group.kind),verified=price!=null;
      const rule=verified?{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:price,chargePerMinute:0,connectionFee:0,idlePerMinute:Number(post.idlePerMinute||0),idleGraceMinutes:Number(post.idleGraceMinutes||0),idleCap:Number(post.idleCap||0),idleCapStart:post.idleCapStart||'00:00',idleCapEnd:post.idleCapEnd||'24:00',afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'}:null;
      const provider=verified?'e-Totem direct':'e-Totem direct (tarif non structuré)';
      return {id:`etotem-direct-${record.stationId}-${index}`,label:`${provider} · ${group.kind} ${group.power} kW`,kind:group.kind,powerKw:group.power,stalls:group.stalls,pricing:{type:'rules',rules:rule?[rule]:[]},offerProvider:provider,offerType:'operator_direct',etotemDirect:true,etotemVerified:verified,etotemStationId:record.stationId,etotemApiStationId:record?.api?.sIdPool||'',etotemNetwork:record?.api?.sNomReseau||'',etotemPdcIds:[...group.pdcIds],etotemTariffText:record.tariffText||'',etotemMatchMethod:record.matchMethod||'',etotemMatchDistanceM:Number(record.matchDistanceM||0)};
    });
  }
  function etotemNameScore(record,station){
    const a=norm(record?.name),b=norm(station?.name);if(!a||!b)return 0;const words=[...new Set(a.split(' ').filter(w=>w.length>=4&&!['totem','borne','station','recharge'].includes(w)))];return words.filter(w=>b.includes(w)).length;
  }
  function mergedEtotemStation(record,data,matches=[]){
    const direct=etotemDirectConfigurations(record),existing=matches.flatMap(station=>station.chargingConfigurations||[]),configurations=mergeConfigurations([...direct,...existing]);
    const first=direct.find(config=>config.etotemVerified)||configurations[0]||{kind:Number(record.maxPowerKw)>22.5?'DC':'AC',powerKw:Number(record.maxPowerKw||11),pricing:{type:'rules',rules:[]}};
    const base=matches.length?{...primaryStation(matches)}:{id:`france-catalog:etotem:${record.stationId}`,catalogStationId:`etotem:${record.stationId}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires e-Totem à vérifier sur la fiche de la station.'}};
    const verifiedCount=direct.filter(config=>config.etotemVerified).reduce((sum,config)=>sum+Number(config.stalls||0),0);
    const merged={...base,name:record.name||base.name,address:record.address||base.address,latitude:Number(record.latitude),longitude:Number(record.longitude),operator:'e-Totem',stalls:Number(record.pdcCount||0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,lastUpdated:String(data.generatedAt||'').slice(0,10),etotemStrictCpo:true,etotemStationId:record.stationId,etotemApiStationId:record?.api?.sIdPool||'',etotemNetwork:record?.api?.sNomReseau||'',etotemSourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),etotemStatusJoinedExternally:matches.length>0,etotemResolved:true,etotemDirectCalculatedPoints:verifiedCount,etotemDirectUnparsedPoints:Math.max(0,Number(record.pdcCount||0)-verifiedCount),etotemRawTariffText:record.tariffText||''};
    return mergeStatus(merged,matches);
  }
  function mergeEtotemCatalog(catalog,data,origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.stations)||!data.stations.length)return catalog;
    const records=data.stations.filter(record=>record?.resolved&&record?.tariffText&&Number.isFinite(Number(record.latitude))&&Number.isFinite(Number(record.longitude))&&(!(radiusKm>0)||geoDistanceKm(origin.lat,origin.lon,record.latitude,record.longitude)<=radiusKm+.12));
    const assignments=new Map(),consumed=new Set();
    for(const record of records){
      const candidates=[];
      for(let index=0;index<catalog.length;index++){
        if(consumed.has(index))continue;const station=catalog[index];if(!Number.isFinite(Number(station.latitude))||!Number.isFinite(Number(station.longitude)))continue;
        const distance=geoDistanceKm(record.latitude,record.longitude,station.latitude,station.longitude);if(distance>.08+1e-9)continue;
        const operatorLike=isEtotemOperator(station),nameScore=etotemNameScore(record,station);if(!operatorLike&&distance>.02&&nameScore<2)continue;
        candidates.push({index,station,distance,operatorLike,nameScore});
      }
      candidates.sort((a,b)=>(Number(b.operatorLike)-Number(a.operatorLike))||(b.nameScore-a.nameScore)||(a.distance-b.distance));
      if(candidates.length){const best=candidates[0];if(best.operatorLike||best.nameScore>=2||best.distance<=.012){assignments.set(record.stationId,[best.station]);consumed.add(best.index);}}
    }
    let matched=0,added=0,directCalculatedPoints=0,directUnparsedPoints=0;
    const merged=records.map(record=>{const matches=assignments.get(record.stationId)||[];if(matches.length)matched++;else added++;const station=mergedEtotemStation(record,data,matches);directCalculatedPoints+=Number(station.etotemDirectCalculatedPoints||0);directUnparsedPoints+=Number(station.etotemDirectUnparsedPoints||0);return station;});
    const output=[...catalog.filter((_,index)=>!consumed.has(index)),...merged];
    window.TCC_ETOTEM_MERGE_STATS={inventoryStations:Number(data?.counts?.inventoryStations||0),resolvedStations:Number(data?.counts?.resolvedStations||0),resolvedWithTariffText:Number(data?.counts?.resolvedWithTariffText||0),inAreaStations:records.length,matched,added,directCalculatedPoints,directUnparsedPoints,coverageByFamily:data?.coverageByFamily||{},outputStations:output.length};
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
    const [rows,statuses,e55c,belib,belibLive,ionity,atlante,powerdot,etotem]=await Promise.all([rowsNear(origin.lat,origin.lon,Number(maxDistanceKm)||0),loadStatusSnapshot(),loadE55cCatalog(),loadBelibCatalog(),loadBelibLive(),loadIonityCatalog(),loadAtlanteCatalog(),loadPowerdotCatalog(),loadEtotemCatalog()]);
    const dayIndex=dayIndexFromSimulation();
    const baseCatalog=rows.map(row=>applyOperationalStatus(stationFromRow(row,dayIndex),statuses));
    const e55cCatalog=mergeE55cCatalog(baseCatalog,e55c,origin,Number(maxDistanceKm)||0);
    const belibCatalog=mergeBelibCatalog(e55cCatalog,belib,belibLive,origin,Number(maxDistanceKm)||0);
    const ionityCatalog=mergeIonityCatalog(belibCatalog,ionity,origin,Number(maxDistanceKm)||0);
    const atlanteCatalog=mergeAtlanteCatalog(ionityCatalog,atlante,origin,Number(maxDistanceKm)||0);
    const powerdotCatalog=mergePowerdotCatalog(atlanteCatalog,powerdot,origin,Number(maxDistanceKm)||0);
    const catalog=mergeEtotemCatalog(powerdotCatalog,etotem,origin,Number(maxDistanceKm)||0);
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
        result.belibCatalogLoaded=Number(window.TCC_BELIB_MERGE_STATS?.strictStationsInArea||0);
        result.belibMergeStats={...(window.TCC_BELIB_MERGE_STATS||{})};
        result.belibLiveLoaded=Object.keys(belibLive?.evses||{}).length>0;
        result.ionityDirectCatalogLoaded=true;
        result.ionityMergeStats={...(window.TCC_IONITY_MERGE_STATS||{})};
        result.atlanteDirectCatalogLoaded=true;
        result.atlanteMergeStats={...(window.TCC_ATLANTE_MERGE_STATS||{})};
        result.powerdotDirectCatalogLoaded=true;
        result.powerdotMergeStats={...(window.TCC_POWERDOT_MERGE_STATS||{})};
        result.etotemDirectCatalogLoaded=true;
        result.etotemMergeStats={...(window.TCC_ETOTEM_MERGE_STATS||{})};
      }
      return result;
    }finally{stations=originalStations;}
  };

  window.TCCFranceCatalog={loadManifest,loadStatusSnapshot,loadE55cCatalog,loadBelibCatalog,loadBelibLive,loadIonityCatalog,loadAtlanteCatalog,loadPowerdotCatalog,loadEtotemCatalog,clearCache(){rawCache.clear();manifestPromise=null;statusPromise=null;e55cPromise=null;belibPromise=null;belibLivePromise=null;belibLiveLoadedAt=0;ionityPromise=null;atlantePromise=null;powerdotPromise=null;etotemPromise=null;},get cachedFragments(){return rawCache.size;}};
  window.TCCFranceCatalogV8={stationFromRow,mergeE55cCatalog,mergedE55cStation,directConfigurations,isE55cOperator,mergeBelibCatalog,mergedBelibStation,directBelibConfigurations,isBelibOperator,belibLiveStatus,mergeIonityCatalog,mergedIonityStation,ionityDirectConfigurations,isIonityOperator,mergeAtlanteCatalog,mergedAtlanteStation,atlanteDirectConfigurations,isAtlanteOperator,mergePowerdotCatalog,mergedPowerdotStation,powerdotDirectConfigurations,powerdotLocations,powerdotPricing,isPowerdotOperator,mergeEtotemCatalog,mergedEtotemStation,etotemDirectConfigurations,etotemDefaultEnergyPrice,etotemPostChargePolicy,isEtotemOperator,geoDistanceKm};
  console.info('[TCC V8] Catalogue national France enrichi des stations et tarifs directs E55C + Belib’ (parking exclu) + IONITY + Atlante + Powerdot + e-Totem direct.');
})();
