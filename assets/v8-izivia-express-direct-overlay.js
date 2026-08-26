// Tesla Charge Companion V8 — IZIVIA Express CPO direct national (fail-closed).
// Scope: only direct public IZIVIA Express prices from the audited national dataset.
// Roaming and subscription prices are intentionally excluded.
(function(){
  'use strict';
  const DATA_URL='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/national/izivia_express_direct_tcc_v8.json';
  const REVISION='rc48-izivia-express-20260826a';
  const MAX_MATCH_METERS=120;
  const MAX_PREPARED_STATIONS=80;
  let dataPromise=null,candidateInstalled=false,pricingInstalled=false;
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const finite=v=>Number.isFinite(Number(v));

  function haversineKm(aLat,aLon,bLat,bLon){
    const R=6371,toRad=x=>Number(x)*Math.PI/180,p1=toRad(aLat),p2=toRad(bLat),dp=toRad(Number(bLat)-Number(aLat)),dl=toRad(Number(bLon)-Number(aLon));
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function isIziviaStation(st){
    const fields=[st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.sourceOperator].map(norm).filter(Boolean);
    return fields.some(v=>v==='izivia'||v.startsWith('izivia ')||v.includes(' izivia ')||v==='sodetrel'||v.startsWith('sodetrel '));
  }
  function exactFormula(config){return config?.pricing?.iziviaExact||null;}
  function validatePost(post){
    if(post==null)return true;
    if(post.billing==='started_block'){
      if(!(Number(post.blockMinutes)>0)||!(Number(post.blockFeeEur)>=0))throw new Error('bloc post-charge IZIVIA invalide');
      return true;
    }
    if(!['started_minute','linear_minute'].includes(post.billing)||!(Number(post.ratePerMinuteEur)>=0))throw new Error('post-charge IZIVIA invalide');
    return true;
  }
  function validateEnergy(energy){
    if(!energy||!['started_kwh','linear_kwh'].includes(energy.billing)||!(Number(energy.ratePerKwhEur)>=0))throw new Error('énergie IZIVIA invalide');
    return true;
  }
  function validateExact(exact){
    if(!exact||exact.currency!=='EUR')throw new Error('formule IZIVIA invalide');
    if(exact.family==='session_cap'){
      validateEnergy(exact.energy);validatePost(exact.postCharge);
      if(!(Number(exact.sessionCapEur)>0))throw new Error('plafond IZIVIA invalide');return true;
    }
    if(exact.family==='simple_postcharge'){
      validateEnergy(exact.energy);validatePost(exact.postCharge);return true;
    }
    if(exact.family==='day_night_included_energy'){
      if(exact.tariffSelection!=='connection_start_local_time')throw new Error('sélection jour/nuit IZIVIA invalide');
      validateEnergy(exact.day?.energy);validatePost(exact.day?.postCharge);
      if(!(Number(exact.night?.connectionFeeEur)>=0)||!(Number(exact.night?.includedEnergyKwh)>=0))throw new Error('forfait nocturne IZIVIA invalide');
      validateEnergy(exact.night?.extraEnergy);return true;
    }
    throw new Error(`famille IZIVIA inconnue: ${exact.family||'—'}`);
  }
  function validateData(data){
    if(data?.dataset!=='izivia-express-direct-tcc-v8-france'||data?.schemaVersion!=='1.0.0')throw new Error('dataset IZIVIA Express V8 inattendu');
    const s=data?.scope||{},c=data?.counts||{},stations=Array.isArray(data?.stations)?data.stations:[];
    if(s.countryCode!=='FR'||s.onlyDirectCpo!==true||s.roamingIncluded!==false||s.subscriptionDiscountsIncluded!==false||s.failClosed!==true)throw new Error('périmètre IZIVIA direct invalide');
    if(Number(c.officialStationRows)!==155||Number(c.tccLocations)!==153||Number(c.directPricePublishedRows)!==146||Number(c.directPriceNotPublishedRows)!==9||Number(c.pricedTccLocations)!==144||Number(c.exactConfigurations)!==313||Number(c.excludedAmbiguousConfigurations)!==0||Number(c.distinctRawTariffs)!==18)throw new Error('comptages IZIVIA Express inattendus');
    const fam=c.familyFormulaRows||{};if(Number(fam.session_cap)!==75||Number(fam.day_night_included_energy)!==68||Number(fam.simple_postcharge)!==3)throw new Error('familles tarifaires IZIVIA inattendues');
    if(stations.length!==153)throw new Error(`inventaire IZIVIA inattendu (${stations.length})`);
    let configs=0,priced=0;
    for(const st of stations){
      if(!text(st.stationId).startsWith('FRE04POAZS')||!finite(st.latitude)||!finite(st.longitude))throw new Error(`station IZIVIA invalide: ${st?.stationId||'—'}`);
      const cs=Array.isArray(st.configurations)?st.configurations:[];if(cs.length)priced++;
      for(const cfg of cs){
        if(cfg?.iziviaDirect!==true||cfg?.iziviaStrictExact!==true||cfg?.offerType!=='operator_direct')throw new Error(`configuration IZIVIA non stricte: ${st.stationId}`);
        if(!['AC','DC'].includes(text(cfg.kind).toUpperCase())||!(Number(cfg.powerKw)>0)||!(Number(cfg.stalls)>0))throw new Error(`configuration IZIVIA invalide: ${st.stationId}`);
        if(Number(cfg.powerKw)<=3&&text(cfg.kind).toUpperCase()!=='AC')throw new Error(`prise lente IZIVIA non AC: ${st.stationId}`);
        validateExact(exactFormula(cfg));configs++;
      }
    }
    if(priced!==144||configs!==313)throw new Error(`couverture IZIVIA incohérente (${priced}/${configs})`);
    return data;
  }
  async function loadData(){
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=20260826a`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`base IZIVIA indisponible (${r.status})`);return r.json();}).then(data=>{validateData(data);window.TCC_IZIVIA_EXPRESS_DIRECT_V8=data;return data;}).catch(err=>{dataPromise=null;console.warn('[TCC V8] IZIVIA Express direct ignoré:',err?.message||err);return null;});
    return dataPromise;
  }
  function configProvider(c){const explicit=text(c?.offerProvider);if(explicit)return explicit;const label=text(c?.label||c?.configurationLabel),i=label.indexOf('·');return(i>=0?label.slice(0,i):label).trim();}
  function configKey(c){return[norm(configProvider(c)),text(c?.kind).toUpperCase(),Number(c?.powerKw||0).toFixed(3),JSON.stringify(c?.pricing?.iziviaExact||c?.pricing||null)].join('|');}
  function mergeConfigurations(sources,direct=[]){
    const out=[],seen=new Set();
    for(const st of sources)for(const cfg of(Array.isArray(st?.chargingConfigurations)?st.chargingConfigurations:[])){const k=configKey(cfg);if(seen.has(k))continue;seen.add(k);out.push(clone(cfg));}
    for(const cfg of direct){const k=configKey(cfg);if(seen.has(k))continue;seen.add(k);out.push(clone(cfg));}
    return out;
  }
  function locationAirKm(loc,origin){const v=[origin?.lat,origin?.lon,loc?.latitude,loc?.longitude].map(Number);return v.every(Number.isFinite)?haversineKm(...v):Infinity;}
  function stationAirKm(st,origin){const existing=Number(st?._airKm);if(Number.isFinite(existing))return existing;const v=[origin?.lat,origin?.lon,st?.latitude,st?.longitude].map(Number);return v.every(Number.isFinite)?haversineKm(...v):Infinity;}
  function pricedInArea(data,prepared){const max=Math.max(0,Number(prepared?.maxDistanceKm||0)),origin=prepared?.origin||{};return(data?.stations||[]).filter(st=>(st.configurations||[]).length).map(st=>({...st,_airKm:locationAirKm(st,origin)})).filter(st=>Number.isFinite(st._airKm)&&(max<=0||st._airKm<=max+1e-9));}
  function identityCompatible(st,loc){
    if(isIziviaStation(st))return true;
    const sn=norm(st?.name),ln=norm(loc?.name),sa=norm(st?.address),la=norm(loc?.address);
    if(sn&&ln&&(sn.includes(ln)||ln.includes(sn)))return true;
    return sa.length>=12&&la.length>=12&&(sa.includes(la)||la.includes(sa));
  }
  function buildAssignments(base,official){
    const pairs=[];
    base.forEach((st,index)=>{const lat=Number(st.latitude),lon=Number(st.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;official.forEach((loc,locIndex)=>{const meters=haversineKm(lat,lon,loc.latitude,loc.longitude)*1000;if(meters<=MAX_MATCH_METERS+1e-6&&identityCompatible(st,loc))pairs.push({index,locIndex,meters});});});
    pairs.sort((a,b)=>a.meters-b.meters||a.index-b.index||a.locIndex-b.locIndex);
    const assignedBase=new Set(),assignedLocation=new Set(),byLocation=new Map();
    for(const p of pairs){if(assignedBase.has(p.index)||assignedLocation.has(p.locIndex))continue;assignedBase.add(p.index);assignedLocation.add(p.locIndex);byLocation.set(p.locIndex,[p]);}
    return{assignedBase,byLocation};
  }
  const directConfigs=loc=>(loc.configurations||[]).map(clone);
  function canonicalFromMatches(loc,matches,base,origin){
    const primary=base[matches[0].index],sources=matches.map(x=>base[x.index]),configs=mergeConfigurations(sources,directConfigs(loc)),first=configs.find(c=>c?.iziviaDirect)||configs[0];
    return{...primary,name:loc.name||primary.name,address:loc.address||primary.address,latitude:Number(loc.latitude),longitude:Number(loc.longitude),operator:'IZIVIA',countryCode:'FR',kind:first?.kind||primary.kind,powerKw:Number(first?.powerKw||primary.powerKw||11),pricing:first?.pricing||primary.pricing,chargingConfigurations:configs,stalls:Math.max(Number(primary.stalls||0),...(loc.configurations||[]).map(c=>Number(c.stalls||0))),_airKm:locationAirKm(loc,origin),iziviaExpressDirect:true,iziviaExpressStationId:loc.stationId,iziviaExpressOfficialStationIds:loc.officialStationIds||[loc.stationId],iziviaStatusJoinedExternally:true,_iziviaExpressOverlayRevision:REVISION};
  }
  function syntheticFromOfficial(loc,origin){
    const configs=directConfigs(loc),first=configs[0],id=`izivia-express-direct:${loc.stationId}`;
    return{id,catalogStationId:id,name:loc.name||'IZIVIA Express',address:loc.address||'',operator:'IZIVIA',latitude:Number(loc.latitude),longitude:Number(loc.longitude),countryCode:'FR',source:'iziviaExpressDirectInventory',kind:first?.kind||'AC',powerKw:Number(first?.powerKw||11),stalls:Math.max(1,...configs.map(c=>Number(c.stalls||0))),pricing:first?.pricing||{type:'rules',rules:[]},chargingConfigurations:configs,access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la couche tarifaire IZIVIA — accès à vérifier.'},temporarilyUnavailable:false,readOnlyCatalog:true,operationalStatus:'unknown',operationalStatusSource:'',_airKm:locationAirKm(loc,origin),iziviaExpressDirect:true,iziviaExpressStationId:loc.stationId,iziviaExpressOfficialStationIds:loc.officialStationIds||[loc.stationId],iziviaStatusJoinedExternally:false,_iziviaExpressOverlayRevision:REVISION};
  }
  function mergePrepared(prepared,data){
    validateData(data);if(!prepared||!Array.isArray(prepared.stations))return prepared;if(prepared.iziviaExpressDirectOverlayRevision===REVISION)return prepared;
    const base=prepared.stations.slice(),origin=prepared.origin||{},official=pricedInArea(data,prepared),{assignedBase,byLocation}=buildAssignments(base,official),kept=base.filter((_,i)=>!assignedBase.has(i)),merged=[];let matched=0,added=0;
    official.forEach((loc,i)=>{const matches=byLocation.get(i)||[];if(matches.length){merged.push(canonicalFromMatches(loc,matches,base,origin));matched++;}else{merged.push(syntheticFromOfficial(loc,origin));added++;}});
    let stations=[...kept,...merged];stations.forEach(st=>{if(!Number.isFinite(Number(st._airKm)))st._airKm=stationAirKm(st,origin);});stations.sort((a,b)=>stationAirKm(a,origin)-stationAirKm(b,origin));if(stations.length>MAX_PREPARED_STATIONS)stations=stations.slice(0,MAX_PREPARED_STATIONS);
    prepared.stations=stations;prepared.iziviaExpressDirectOverlayApplied=true;prepared.iziviaExpressDirectOverlayRevision=REVISION;prepared.iziviaExpressDirectOverlayStats={nationalLocations:data.counts.tccLocations,pricedNationalLocations:data.counts.pricedTccLocations,pricedInPreparedArea:official.length,matchedRuntimeSites:matched,addedOfficialSites:added,preparedStationCount:stations.length};return prepared;
  }
  async function applyToPrepared(prepared){const data=window.TCC_IZIVIA_EXPRESS_DIRECT_V8||await loadData();return data?mergePrepared(prepared,data):prepared;}
  function installCandidateWrapper(){
    if(candidateInstalled)return true;const current=window.candidateStations;if(typeof current!=='function')return false;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){const result=await current.apply(this,arguments);if(filterMode!=='all'||!result||!Array.isArray(result.stations))return result;return applyToPrepared(result);};
    wrapped.__tccIziviaExpressDirectV1=true;wrapped.__tccOriginal=current;window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}candidateInstalled=true;return true;
  }
  function toMinutes(value){const m=text(value).match(/^(\d{1,2}):(\d{2})/);return m?(Number(m[1])*60+Number(m[2]))%1440:NaN;}
  function occupiedMinutes(chargeMinutes,unplugTime,startTime){const charge=Math.max(0,Number(chargeMinutes||0));if(!unplugTime||!startTime)return charge;const a=toMinutes(startTime),b=toMinutes(unplugTime);if(!Number.isFinite(a)||!Number.isFinite(b))return charge;let delta=b-a;if(delta<0)delta+=1440;return Math.max(charge,delta);}
  const startedUnits=value=>{const n=Math.max(0,Number(value||0));return n>1e-9?Math.ceil(n-1e-9):0;};
  function energyCost(component,kwh){if(!component)return 0;const e=Math.max(0,Number(kwh||0)),units=component.billing==='started_kwh'?startedUnits(e):e;return units*Math.max(0,Number(component.ratePerKwhEur||0));}
  function postChargeCost(post,minutes){
    if(!post)return 0;const m=Math.max(0,Number(minutes||0));if(!(m>1e-9))return 0;
    if(post.billing==='started_block')return startedUnits(m/Math.max(1e-9,Number(post.blockMinutes||0)))*Math.max(0,Number(post.blockFeeEur||0));
    const units=post.billing==='started_minute'?startedUnits(m):m;return units*Math.max(0,Number(post.ratePerMinuteEur||0));
  }
  function exactCost(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime){
    const exact=pp?.iziviaExact;if(!exact)return null;validateExact(exact);
    const charge=Math.max(0,Number(chargeMinutes||0)),occupied=occupiedMinutes(charge,unplugTime,startTime),postMinutes=Math.max(0,occupied-charge),energy=Math.max(0,Number(billedEnergy||0));
    let connection=0,chargeCost=0,idleCost=0,rawTotal=0,total=0,capSavings=0,night=false;
    if(exact.family==='day_night_included_energy'){
      const minute=Number.isFinite(Number(startMin))?((Number(startMin)%1440)+1440)%1440:toMinutes(startTime);night=!(minute>=480&&minute<1200);
      if(night){connection=Math.max(0,Number(exact.night.connectionFeeEur||0));const extra=Math.max(0,energy-Math.max(0,Number(exact.night.includedEnergyKwh||0)));chargeCost=energyCost(exact.night.extraEnergy,extra);}
      else{chargeCost=energyCost(exact.day.energy,energy);idleCost=postChargeCost(exact.day.postCharge,postMinutes);}
      rawTotal=total=connection+chargeCost+idleCost;
    }else{
      chargeCost=energyCost(exact.energy,energy);idleCost=postChargeCost(exact.postCharge,postMinutes);rawTotal=chargeCost+idleCost;total=rawTotal;
      if(exact.family==='session_cap'){total=Math.min(rawTotal,Math.max(0,Number(exact.sessionCapEur||0)));capSavings=Math.max(0,rawTotal-total);if(capSavings>0){const keptCharge=Math.min(chargeCost,total);chargeCost=keptCharge;idleCost=Math.max(0,total-keptCharge);}}
    }
    return{total,rawTotal,connection,chargeCost,idleCost,durationSurcharge:0,occupiedMinutes:occupied,postChargeMinutes:postMinutes,capSavings,night,currencies:['EUR']};
  }
  function installPricing(){
    if(pricingInstalled)return true;const current=window.priceWithRules;if(typeof current!=='function')return false;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      if(!pp?.iziviaExact)return current.apply(this,arguments);const base=current.apply(this,arguments),exact=exactCost(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime);if(!exact)return base;
      return{...(base||{}),total:exact.total,connection:exact.connection,chargeCost:exact.chargeCost,idleCost:exact.idleCost,durationSurcharge:0,occupiedMinutes:exact.occupiedMinutes,currencies:['EUR'],iziviaExactPricing:true,iziviaRawBeforeCap:exact.rawTotal,iziviaCapSavings:exact.capSavings,iziviaNightTariff:exact.night,iziviaPostChargeMinutes:exact.postChargeMinutes};
    };
    wrapped.__tccIziviaExpressPricingV1=true;wrapped.__tccOriginal=current;window.priceWithRules=wrapped;try{priceWithRules=wrapped}catch(e){}pricingInstalled=true;return true;
  }
  function install(){const a=installCandidateWrapper(),b=installPricing();return a&&b;}
  window.TCCV8IziviaExpressDirect={loadData,validateData,validateExact,exactCost,mergePrepared,applyToPrepared,install,revision:REVISION};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>160)clearInterval(timer);},100);
})();
