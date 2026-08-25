// Tesla Charge Companion V8 RC4.8 — Freshmile CPO direct national (fail-closed).
// Scope: only strict Freshmile-operated French EVSEs with a tariff formula that
// this runtime reproduces exactly. Regional networks, roaming, preferential and
// unsupported/ambiguous tariffs stay out of ranking.
(function(){
  'use strict';
  const DATA_URL='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/national/freshmile_direct_tcc_v8.json.gz';
  const REVISION='rc48-freshmile-direct-remote-20260825c';
  const MAX_MATCH_METERS=120;
  const MAX_PREPARED_STATIONS=80;
  let dataPromise=null;
  let candidateInstalled=false;
  let lastPrepared=null;
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));

  function haversineKm(aLat,aLon,bLat,bLon){
    const R=6371,toRad=x=>Number(x)*Math.PI/180,p1=toRad(aLat),p2=toRad(bLat),dp=toRad(Number(bLat)-Number(aLat)),dl=toRad(Number(bLon)-Number(aLon));
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function isFreshmileStation(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network].map(norm).filter(Boolean).some(v=>v==='freshmile'||v.startsWith('freshmile '));}
  function exactFormula(config){return config?.pricing?.freshmileExact||null;}
  function validateExact(exact){
    if(!exact||exact.currency!=='EUR')throw new Error('formule Freshmile hors EUR/invalide');
    const energy=exact.energy||null,time=exact.time||null;
    if(exact.free===true){if(exact.sessionFeeEur||energy||time)throw new Error('formule gratuite Freshmile incohérente');return true;}
    if(exact.sessionFeeEur!=null&&!(Number(exact.sessionFeeEur)>=0))throw new Error('frais de session Freshmile invalides');
    if(energy&&(!(Number(energy.amount)>=0)||!['started_kwh','linear_kwh'].includes(energy.billing)))throw new Error('composante énergie Freshmile invalide');
    if(time){
      if(!(Number(time.amount)>=0)||time.billing!=='started_minute'||!['charge','occupied'].includes(time.appliesTo))throw new Error('composante temps Freshmile invalide');
      if(time.startAfterMinutes!=null&&!(Number(time.startAfterMinutes)>=0))throw new Error('seuil temps Freshmile invalide');
    }
    if(!energy&&!time&&!(Number(exact.sessionFeeEur)>0))throw new Error('formule Freshmile vide');
    return true;
  }
  function validateData(data){
    if(data?.dataset!=='freshmile-direct-tcc-v8-france'||data?.schemaVersion!=='1.0.0')throw new Error('dataset Freshmile V8 inattendu');
    const scope=data?.scope||{};
    if(scope.countryCode!=='FR'||scope.onlyDirectCpo!==true||scope.onlyStrictTccExact!==true)throw new Error('périmètre Freshmile direct invalide');
    if(scope.roamingIncluded!==false||scope.configuredRegionalNetworksIncluded!==false||scope.preferentialTariffsIncluded!==false)throw new Error('itinérance/réseau régional configuré/préférentiel présent dans Freshmile direct');
    if(scope.regionalNetworkCandidatesMayRemain!==true)throw new Error('audit résiduel Freshmile inattendu');
    const stations=Array.isArray(data?.stations)?data.stations:[],counts=data?.counts||{};
    if(stations.length!==Number(counts.strictPublishedStations)||stations.length<900||stations.length>1500)throw new Error(`inventaire Freshmile strict inattendu (${stations.length})`);
    const stationIds=new Set();let evseCount=0,configCount=0;
    for(const st of stations){
      if(!text(st?.stationId).startsWith('FRFR')||stationIds.has(st.stationId))throw new Error(`station Freshmile invalide/dupliquée: ${st?.stationId||'—'}`);
      stationIds.add(st.stationId);
      if(!Number.isFinite(Number(st.latitude))||!Number.isFinite(Number(st.longitude)))throw new Error(`coordonnées Freshmile absentes: ${st.stationId}`);
      const configs=Array.isArray(st.configurations)?st.configurations:[];
      if(!configs.length)throw new Error(`station Freshmile sans tarif strict: ${st.stationId}`);
      const evses=new Set();
      for(const cfg of configs){
        if(cfg?.freshmileDirect!==true||cfg?.freshmileVerified!==true||cfg?.freshmileStrictExact!==true||cfg?.offerType!=='operator_direct')throw new Error(`configuration Freshmile non stricte: ${st.stationId}`);
        if(!['AC','DC'].includes(text(cfg.kind).toUpperCase())||!(Number(cfg.powerKw)>0)||!(Number(cfg.stalls)>0))throw new Error(`puissance Freshmile invalide: ${st.stationId}`);
        validateExact(exactFormula(cfg));
        for(const id of cfg.freshmileEvseIds||[])evses.add(text(id));
        configCount++;
      }
      evseCount+=evses.size;
    }
    if(configCount!==Number(counts.strictPublishedConfigurations)||evseCount!==Number(counts.strictPublishedEvse))throw new Error(`comptages Freshmile incohérents (${configCount}/${evseCount})`);
    if(!Number.isInteger(Number(counts.conflictingEvseExcluded))||Number(counts.conflictingEvseExcluded)<0)throw new Error('garde-fou conflits Freshmile invalide');
    return data;
  }
  async function gunzipJson(response){
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('compression Freshmile invalide');
    if(typeof DecompressionStream!=='function')throw new Error('décompression gzip non prise en charge');
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  async function loadData(){
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=20260825c`,{cache:'no-store'}).then(async r=>{
      if(!r.ok)throw new Error(`base Freshmile stricte indisponible (${r.status})`);
      return gunzipJson(r);
    }).then(data=>{
      validateData(data);window.TCC_FRESHMILE_DIRECT_V8=data;return data;
    }).catch(err=>{
      dataPromise=null;console.warn('[TCC V8] Freshmile direct ignoré:',err?.message||err);return null;
    });
    return dataPromise;
  }
  function configProvider(c){const explicit=text(c?.offerProvider);if(explicit)return explicit;const label=text(c?.label||c?.configurationLabel),i=label.indexOf('·');return (i>=0?label.slice(0,i):label).trim();}
  function configKey(c){const exact=c?.pricing?.freshmileExact||null;return [norm(configProvider(c)),text(c?.kind).toUpperCase(),Number(c?.powerKw||0).toFixed(3),JSON.stringify(exact||c?.pricing||null)].join('|');}
  function mergeConfigurations(sources,direct=[]){
    const out=[],seen=new Set();
    for(const st of sources)for(const cfg of (Array.isArray(st?.chargingConfigurations)?st.chargingConfigurations:[])){const key=configKey(cfg);if(seen.has(key))continue;seen.add(key);out.push(clone(cfg));}
    for(const cfg of direct){const key=configKey(cfg);if(seen.has(key))continue;seen.add(key);out.push(clone(cfg));}
    return out;
  }
  function locationAirKm(loc,origin){const values=[origin?.lat,origin?.lon,loc?.latitude,loc?.longitude].map(Number);return values.every(Number.isFinite)?haversineKm(...values):Infinity;}
  function stationAirKm(st,origin){const existing=Number(st?._airKm);if(Number.isFinite(existing))return existing;const values=[origin?.lat,origin?.lon,st?.latitude,st?.longitude].map(Number);return values.every(Number.isFinite)?haversineKm(...values):Infinity;}
  function inArea(data,prepared){const max=Math.max(0,Number(prepared?.maxDistanceKm||0)),origin=prepared?.origin||{};return (data?.stations||[]).map(st=>({...st,_airKm:locationAirKm(st,origin)})).filter(st=>Number.isFinite(st._airKm)&&(max<=0||st._airKm<=max+1e-9));}
  function buildAssignments(base,official){
    const pairs=[];
    base.forEach((st,index)=>{
      if(!isFreshmileStation(st))return;
      const lat=Number(st.latitude),lon=Number(st.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      official.forEach((loc,locIndex)=>{const meters=haversineKm(lat,lon,loc.latitude,loc.longitude)*1000;if(meters<=MAX_MATCH_METERS+1e-6)pairs.push({index,locIndex,meters});});
    });
    pairs.sort((a,b)=>a.meters-b.meters||a.index-b.index||a.locIndex-b.locIndex);
    const assignedBase=new Set(),assignedLocation=new Set(),byLocation=new Map();
    for(const pair of pairs){if(assignedBase.has(pair.index)||assignedLocation.has(pair.locIndex))continue;assignedBase.add(pair.index);assignedLocation.add(pair.locIndex);byLocation.set(pair.locIndex,[pair]);}
    return{assignedBase,byLocation};
  }
  function directConfigs(loc){return (loc.configurations||[]).map(clone);}
  function canonicalFromMatches(loc,matches,base,origin){
    const primary=base[matches[0].index],sources=matches.map(x=>base[x.index]),configurations=mergeConfigurations(sources,directConfigs(loc)),first=configurations.find(c=>c?.freshmileDirect)||configurations[0];
    return{...primary,name:loc.name||primary.name,address:loc.address||primary.address,latitude:Number(loc.latitude),longitude:Number(loc.longitude),operator:'Freshmile',countryCode:'FR',kind:first?.kind||primary.kind,powerKw:Number(first?.powerKw||primary.powerKw||11),pricing:first?.pricing||primary.pricing,chargingConfigurations:configurations,stalls:Math.max(Number(primary.stalls||0),...(loc.configurations||[]).map(c=>Number(c.stalls||0))),_airKm:locationAirKm(loc,origin),freshmileStrictCpo:true,freshmileDirectStationId:loc.stationId,freshmileSourceCatalogStationIds:sources.map(x=>x.catalogStationId).filter(Boolean),freshmileStatusJoinedExternally:true,freshmileDirectConfigurationCount:(loc.configurations||[]).length,_freshmileOverlayRevision:REVISION};
  }
  function syntheticFromOfficial(loc,origin){
    const configs=directConfigs(loc),first=configs[0],id=`freshmile-direct:${loc.stationId}`,stalls=new Set(configs.flatMap(c=>c.freshmileEvseIds||[])).size;
    return{id,catalogStationId:id,name:loc.name||'Station Freshmile',address:loc.address||'',operator:'Freshmile',latitude:Number(loc.latitude),longitude:Number(loc.longitude),countryCode:'FR',source:'freshmileDirectInventory',kind:first?.kind||'AC',powerKw:Number(first?.powerKw||11),stalls,pricing:first?.pricing||{type:'rules',rules:[]},chargingConfigurations:configs,access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la couche tarifaire Freshmile — accès à vérifier.'},temporarilyUnavailable:false,readOnlyCatalog:true,operationalStatus:'unknown',operationalStatusSource:'',_airKm:locationAirKm(loc,origin),freshmileStrictCpo:true,freshmileDirectStationId:loc.stationId,freshmileSourceCatalogStationIds:[],freshmileStatusJoinedExternally:false,freshmileDirectConfigurationCount:configs.length,_freshmileOverlayRevision:REVISION};
  }
  function mergePrepared(prepared,data){
    validateData(data);
    if(!prepared||!Array.isArray(prepared.stations))return prepared;
    if(prepared.freshmileDirectOverlayApplied&&prepared.freshmileDirectOverlayRevision===REVISION)return prepared;
    const base=prepared.stations.slice(),origin=prepared.origin||{},official=inArea(data,prepared),{assignedBase,byLocation}=buildAssignments(base,official),kept=base.filter((_,index)=>!assignedBase.has(index)),merged=[];
    let matched=0,added=0;
    official.forEach((loc,locIndex)=>{const matches=byLocation.get(locIndex)||[];if(matches.length){merged.push(canonicalFromMatches(loc,matches,base,origin));matched++;}else{merged.push(syntheticFromOfficial(loc,origin));added++;}});
    let stations=[...kept,...merged];
    stations.forEach(st=>{if(!Number.isFinite(Number(st._airKm)))st._airKm=stationAirKm(st,origin);});
    stations.sort((a,b)=>stationAirKm(a,origin)-stationAirKm(b,origin));
    if(stations.length>MAX_PREPARED_STATIONS)stations=stations.slice(0,MAX_PREPARED_STATIONS);
    prepared.stations=stations;prepared.freshmileDirectOverlayApplied=true;prepared.freshmileDirectOverlayRevision=REVISION;
    prepared.freshmileDirectOverlayStats={strictNationalStations:data.stations.length,strictInPreparedArea:official.length,matchedRuntimeSites:matched,addedStrictSites:added,preparedStationCount:stations.length};
    return prepared;
  }
  async function applyToPrepared(prepared){const data=window.TCC_FRESHMILE_DIRECT_V8||await loadData();return data?mergePrepared(prepared,data):prepared;}
  function installCandidateWrapper(){
    if(candidateInstalled)return true;
    const current=window.candidateStations;if(typeof current!=='function')return false;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){const result=await current.apply(this,arguments);if(filterMode!=='all'||!result||!Array.isArray(result.stations))return result;return applyToPrepared(result);};
    wrapped.__tccFreshmileDirectV1=true;wrapped.__tccOriginal=current;window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}candidateInstalled=true;return true;
  }
  function occupiedMinutes(chargeMinutes,unplugTime,startTime){
    const charge=Math.max(0,Number(chargeMinutes||0));if(!unplugTime||!startTime)return charge;
    const toMin=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})/);return m?(Number(m[1])*60+Number(m[2]))%1440:NaN;};
    const a=toMin(startTime),b=toMin(unplugTime);if(!Number.isFinite(a)||!Number.isFinite(b))return charge;let delta=b-a;if(delta<0)delta+=1440;return Math.max(charge,delta);
  }
  const startedUnits=value=>{const n=Math.max(0,Number(value||0));return n>1e-9?Math.ceil(n-1e-9):0;};
  function exactCost(pp,chargeMinutes,billedEnergy,unplugTime,startTime){
    const exact=pp?.freshmileExact;if(!exact)return null;validateExact(exact);
    if(exact.free===true)return{total:0,connection:0,energyCost:0,timeCost:0,occupiedMinutes:occupiedMinutes(chargeMinutes,unplugTime,startTime)};
    const occupied=occupiedMinutes(chargeMinutes,unplugTime,startTime),energy=exact.energy||null,time=exact.time||null,connection=Math.max(0,Number(exact.sessionFeeEur||0));
    let energyCost=0,timeCost=0;
    if(energy){const units=energy.billing==='started_kwh'?startedUnits(billedEnergy):Math.max(0,Number(billedEnergy||0));energyCost=units*Number(energy.amount||0);}
    if(time){const minutes=time.appliesTo==='occupied'?occupied:Math.max(0,Number(chargeMinutes||0)),threshold=Math.max(0,Number(time.startAfterMinutes||0)),billable=Math.max(0,minutes-threshold);timeCost=startedUnits(billable)*Number(time.amount||0);}
    return{total:connection+energyCost+timeCost,connection,energyCost,timeCost,occupiedMinutes:occupied,timeAppliesTo:time?.appliesTo||null};
  }
  function installPricing(){
    if(window.__TCC_FRESHMILE_PRICING_INSTALLED__)return true;
    const current=window.priceWithRules;if(typeof current!=='function')return false;
    const wrapped=function(pp,startMinute,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      if(!pp?.freshmileExact)return current.apply(this,arguments);
      const base=current.apply(this,arguments);if(base?.error)return base;
      let exact;try{exact=exactCost(pp,chargeMinutes,billedEnergy,unplugTime,startTime);}catch(err){return{error:`Tarif Freshmile strict invalide: ${err.message}`};}
      if(!exact)return base;
      return{...base,total:exact.total,connection:exact.connection,chargeCost:exact.energyCost+(exact.timeAppliesTo==='charge'?exact.timeCost:0),connectedTimeCost:exact.timeAppliesTo==='occupied'?exact.timeCost:0,idleCost:0,durationSurcharge:0,occupiedMinutes:exact.occupiedMinutes,currencies:['EUR'],freshmileDirectPricing:true,freshmileExactPricing:true,freshmileEnergyCost:exact.energyCost,freshmileTimeCost:exact.timeCost};
    };
    wrapped.__tccFreshmileExactV1=true;wrapped.__tccOriginal=current;window.priceWithRules=wrapped;try{priceWithRules=wrapped}catch(e){}window.__TCC_FRESHMILE_PRICING_INSTALLED__=true;return true;
  }
  function markRevision(){
    const banner=document.getElementById('tccPreviewBanner');
    if(banner&&/RC4\.8/.test(text(banner.textContent))&&!/Freshmile direct/i.test(text(banner.textContent)))banner.textContent=`${text(banner.textContent)} · Freshmile direct strict`;
  }
  loadData();let attempts=0;
  const timer=setInterval(async()=>{
    attempts++;installPricing();installCandidateWrapper();
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;
    if(prepared&&prepared!==lastPrepared){await applyToPrepared(prepared);lastPrepared=prepared;window.TCC_V8_AREA_CACHE.prepared=prepared;}
    markRevision();
    if(attempts>2400)clearInterval(timer);
  },50);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(markRevision,0),{once:true});else setTimeout(markRevision,0);

  window.TCCV8FreshmileDirect={loadData,validateData,mergePrepared,applyToPrepared,isFreshmileStation,exactCost,installPricing,installCandidateWrapper,revision:REVISION};
  console.info('[TCC V8] Freshmile direct strict prêt : inventaire + tarification exacte fail-closed.');
})();
