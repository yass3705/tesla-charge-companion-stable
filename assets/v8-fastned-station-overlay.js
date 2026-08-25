// Tesla Charge Companion V8 RC4.8 — inventaire national Fastned officiel.
// Cette couche ajoute/fusionne uniquement les sites exploités par Fastned en France.
// Les tarifs restent fournis par v8-operator-tariff-overlay.js et le statut temps réel
// reste prioritairement issu du catalogue Electroverse/Electra déjà chargé par TCC.
(function(){
  'use strict';
  const DATA_URL='data/fastned_direct_stations_france.json.gz';
  const REVISION='rc48-fastned-national-1';
  const MAX_MATCH_METERS=250;
  const MAX_PREPARED_STATIONS=80;
  let dataPromise=null;

  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));

  function haversineKm(aLat,aLon,bLat,bLon){
    const R=6371,toRad=x=>Number(x)*Math.PI/180;
    const p1=toRad(aLat),p2=toRad(bLat),dp=toRad(Number(bLat)-Number(aLat)),dl=toRad(Number(bLon)-Number(aLon));
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }

  function isFastnedStation(st){
    return [st?.operator,st?._sourceOperator,st?.cpo,st?.network]
      .map(norm).filter(Boolean).some(v=>v==='fastned'||v.startsWith('fastned '));
  }

  function validateData(data){
    if(data?.dataset!=='fastned-direct-operated-stations-france')throw new Error('dataset Fastned inattendu');
    if(data?.operator!=='Fastned'||data?.country!=='FR')throw new Error('périmètre Fastned France invalide');
    const scope=data?.scope||{};
    if(scope.officialFastnedLocationPagesOnly!==true||scope.onlyFastnedCpoLocations!==true)throw new Error('garde-fou CPO Fastned absent');
    if(scope.partnerOperatorLocationsIncluded!==false||scope.roamingTariffsIncluded!==false)throw new Error('itinérance/partenaires ne doivent pas entrer dans la base physique Fastned');
    if(scope.liveStatusIncluded!==false)throw new Error('le statut live ne doit pas venir de la base statique Fastned');
    const locations=Array.isArray(data?.locations)?data.locations:[];
    if(locations.length<50||locations.length>120)throw new Error(`nombre de sites Fastned France inattendu: ${locations.length}`);
    const ids=new Set();
    for(const loc of locations){
      if(!loc?.stationId||ids.has(loc.stationId))throw new Error(`identifiant Fastned dupliqué/invalide: ${loc?.stationId||'—'}`);
      ids.add(loc.stationId);
      if(loc.country!=='FR')throw new Error(`site Fastned hors France: ${loc.stationId}`);
      if(!Number.isFinite(Number(loc.latitude))||!Number.isFinite(Number(loc.longitude)))throw new Error(`coordonnées Fastned absentes: ${loc.stationId}`);
      if(!(Number(loc.chargingPoints)>0)||!(Number(loc.maxPowerKw)>=50))throw new Error(`caractéristiques Fastned invalides: ${loc.stationId}`);
    }
    return data;
  }

  async function gunzipJson(response){
    const bytes=await response.arrayBuffer();
    if(typeof DecompressionStream!=='function')throw new Error('décompression gzip non prise en charge par ce navigateur');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const raw=await new Response(stream).text();
    return JSON.parse(raw);
  }

  async function loadData(){
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=20260825a`,{cache:'no-store'}).then(async r=>{
      if(!r.ok)throw new Error(`inventaire Fastned indisponible (${r.status})`);
      return gunzipJson(r);
    }).then(data=>{
      validateData(data);
      window.TCC_FASTNED_STATION_INVENTORY_V1=data;
      return data;
    }).catch(err=>{
      dataPromise=null;
      console.warn('[TCC V8] Inventaire national Fastned non chargé:',err?.message||err);
      return null;
    });
    return dataPromise;
  }

  function configProvider(c){
    const explicit=text(c?.offerProvider);if(explicit)return explicit;
    const label=text(c?.label||c?.configurationLabel),i=label.indexOf('·');
    return (i>=0?label.slice(0,i):label).trim();
  }
  function configKey(c){
    const pricing=JSON.stringify(c?.pricing||null);
    return [norm(configProvider(c)),text(c?.kind).toUpperCase(),Number(c?.powerKw||0).toFixed(2),pricing].join('|');
  }
  function mergeConfigurations(stations){
    const out=[],seen=new Set();
    for(const st of stations){
      const configs=Array.isArray(st?.chargingConfigurations)?st.chargingConfigurations:[];
      for(const c of configs){
        const key=configKey(c);if(seen.has(key))continue;
        seen.add(key);out.push(clone(c));
      }
    }
    return out;
  }

  function locationAirKm(loc,origin){
    const a=Number(origin?.lat),b=Number(origin?.lon),c=Number(loc?.latitude),d=Number(loc?.longitude);
    return [a,b,c,d].every(Number.isFinite)?haversineKm(a,b,c,d):Infinity;
  }
  function stationAirKm(st,origin){
    const existing=Number(st?._airKm);if(Number.isFinite(existing))return existing;
    const a=Number(origin?.lat),b=Number(origin?.lon),c=Number(st?.latitude),d=Number(st?.longitude);
    return [a,b,c,d].every(Number.isFinite)?haversineKm(a,b,c,d):Infinity;
  }

  function officialInPreparedArea(data,prepared){
    const max=Math.max(0,Number(prepared?.maxDistanceKm||0));
    const origin=prepared?.origin||{};
    return (data?.locations||[]).map(loc=>({...loc,_airKm:locationAirKm(loc,origin)}))
      .filter(loc=>Number.isFinite(loc._airKm)&&(max<=0||loc._airKm<=max+1e-9));
  }

  function buildAssignments(baseStations,officialLocations){
    const pairs=[];
    baseStations.forEach((st,index)=>{
      if(!isFastnedStation(st))return;
      const lat=Number(st?.latitude),lon=Number(st?.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      officialLocations.forEach((loc,locIndex)=>{
        const meters=haversineKm(lat,lon,Number(loc.latitude),Number(loc.longitude))*1000;
        if(meters<=MAX_MATCH_METERS+1e-6)pairs.push({index,locIndex,meters});
      });
    });
    pairs.sort((a,b)=>a.meters-b.meters||a.index-b.index||a.locIndex-b.locIndex);
    const assignedBase=new Set(),byLocation=new Map();
    for(const pair of pairs){
      if(assignedBase.has(pair.index))continue;
      assignedBase.add(pair.index);
      if(!byLocation.has(pair.locIndex))byLocation.set(pair.locIndex,[]);
      byLocation.get(pair.locIndex).push(pair);
    }
    return {byLocation,assignedBase};
  }

  function canonicalFromMatches(loc,matches,baseStations,origin){
    const ordered=matches.slice().sort((a,b)=>a.meters-b.meters);
    const primary=baseStations[ordered[0].index];
    const sources=ordered.map(x=>baseStations[x.index]);
    const configurations=mergeConfigurations(sources);
    const airKm=locationAirKm(loc,origin);
    const out={
      ...primary,
      name:loc.name||primary.name,
      operator:'Fastned',
      address:loc.address||primary.address,
      latitude:Number(loc.latitude),longitude:Number(loc.longitude),countryCode:'FR',
      totalSiteStalls:Number(loc.chargingPoints),
      _airKm:airKm,
      _fastnedOfficial:true,
      fastnedStationId:loc.stationId,
      fastnedSlug:loc.slug,
      fastnedOfficialUrl:loc.stationPageUrl,
      fastnedChargingPoints:Number(loc.chargingPoints),
      fastnedMaxPowerKw:Number(loc.maxPowerKw),
      fastnedConnectorTypes:Array.isArray(loc.connectorTypes)?loc.connectorTypes.slice():[],
      _fastnedMergedSourceCount:sources.length,
      _fastnedMatchMode:'geo_operator',
      _fastnedMatchDistanceMeters:Math.round(ordered[0].meters),
      _fastnedOverlayRevision:REVISION
    };
    if(configurations.length)out.chargingConfigurations=configurations;
    return out;
  }

  function syntheticFromOfficial(loc,origin){
    const id=`fastned-official:${loc.slug}`;
    return {
      id,catalogStationId:id,
      name:loc.name,operator:'Fastned',address:loc.address,
      latitude:Number(loc.latitude),longitude:Number(loc.longitude),countryCode:'FR',
      source:'fastnedOfficialInventory',
      kind:'DC',powerKw:Number(loc.maxPowerKw),stalls:Number(loc.chargingPoints),totalSiteStalls:Number(loc.chargingPoints),
      pricing:{type:'rules',rules:[]},
      access:{limited:false},temporarilyUnavailable:false,
      _airKm:locationAirKm(loc,origin),
      _fastnedOfficial:true,
      fastnedStationId:loc.stationId,fastnedSlug:loc.slug,fastnedOfficialUrl:loc.stationPageUrl,
      fastnedChargingPoints:Number(loc.chargingPoints),fastnedMaxPowerKw:Number(loc.maxPowerKw),
      fastnedConnectorTypes:Array.isArray(loc.connectorTypes)?loc.connectorTypes.slice():[],
      _fastnedMergedSourceCount:0,_fastnedMatchMode:'official_only',_fastnedMatchDistanceMeters:null,
      _fastnedOverlayRevision:REVISION
    };
  }

  function mergePrepared(prepared,data){
    validateData(data);
    if(!prepared||!Array.isArray(prepared.stations))return prepared;
    if(prepared.fastnedStationOverlayApplied&&prepared.fastnedStationOverlayRevision===REVISION)return prepared;

    const base=prepared.stations.slice(),origin=prepared.origin||{};
    const official=officialInPreparedArea(data,prepared);
    const {byLocation,assignedBase}=buildAssignments(base,official);
    const kept=base.filter((_,index)=>!assignedBase.has(index));
    const merged=[];
    let matched=0,added=0,collapsed=0;

    official.forEach((loc,locIndex)=>{
      const matches=byLocation.get(locIndex)||[];
      if(matches.length){
        merged.push(canonicalFromMatches(loc,matches,base,origin));
        matched++;collapsed+=Math.max(0,matches.length-1);
      }else{
        merged.push(syntheticFromOfficial(loc,origin));added++;
      }
    });

    let stations=[...kept,...merged];
    stations.forEach(st=>{if(!Number.isFinite(Number(st._airKm)))st._airKm=stationAirKm(st,origin);});
    stations.sort((a,b)=>stationAirKm(a,origin)-stationAirKm(b,origin));
    if(stations.length>MAX_PREPARED_STATIONS)stations=stations.slice(0,MAX_PREPARED_STATIONS);

    prepared.stations=stations;
    prepared.fastnedStationOverlayApplied=true;
    prepared.fastnedStationOverlayRevision=REVISION;
    prepared.fastnedStationOverlayStats={
      officialNationalCount:(data.locations||[]).length,
      officialInPreparedArea:official.length,
      matchedRuntimeSites:matched,
      addedOfficialSites:added,
      collapsedRuntimeDuplicates:collapsed,
      preparedStationCount:stations.length
    };
    return prepared;
  }

  async function applyToPrepared(prepared){
    const data=window.TCC_FASTNED_STATION_INVENTORY_V1||await loadData();
    if(!data)return prepared;
    return mergePrepared(prepared,data);
  }

  function markRevision(){
    const banner=document.getElementById('tccPreviewBanner');
    if(banner&&/RC4\.8/.test(text(banner.textContent))&&!/Fastned national/i.test(text(banner.textContent))){
      banner.textContent=`${text(banner.textContent)} · Fastned national`;
    }
  }

  loadData();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(markRevision,0),{once:true});else setTimeout(markRevision,0);

  window.TCCV8FastnedStationOverlay={loadData,validateData,mergePrepared,applyToPrepared,isFastnedStation,revision:REVISION};
  console.info('[TCC V8] Inventaire national Fastned prêt.');
})();
