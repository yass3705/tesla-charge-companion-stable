// Tesla Charge Companion V8 — WAAT France CPO-direct station/configuration tariffs.
// Source: validated public Monta Web Map guest snapshot, pinned in the release workflow.
// Strict scope: WAAT physical CPO only (FR*WA2), no roaming, no network-wide fallback.
(function(){
  'use strict';
  const REVISION='waat-direct-v1-20260826a';
  const DATA_URL='data/waat_monta_direct_tariffs_france.json.gz';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const compact=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  let dataPromise=null,indexCache=null;

  async function readGzipJson(url){
    const r=await fetch(`${url}?v=${REVISION}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`base WAAT indisponible (${r.status})`);
    const bytes=new Uint8Array(await r.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('compression WAAT invalide');
    if(typeof DecompressionStream!=='function')throw new Error('décompression gzip WAAT indisponible');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  function validateCatalog(data){
    const c=data?.counts||{},s=data?.scope||{};
    if(data?.schemaVersion!=='2.0.0'||data?.dataset!=='waat-monta-direct-tariffs-france'||data?.operator!=='WAAT'||data?.country!=='FR')throw new Error('dataset WAAT inattendu');
    if(s.directCpoOnly!==true||s.roamingIncluded!==false||s.stationSpecificPricing!==true||s.unresolvedCasesNeverRankable!==true||s.zeroPriceAutoRanked!==false||s.dynamicPricingAutoRanked!==false||s.rangePricingAutoRanked!==false)throw new Error('périmètre WAAT Direct invalide');
    if(Number(c.inventoryStations)!==571||Number(c.queriedStations)!==571||Number(c.mapHttp200)!==571||Number(c.mapErrors)!==0)throw new Error('couverture WAAT invalide');
    if(Number(c.rankableStations)!==452||Number(c.rankablePhysicalConfigs)!==507||Number(c.unresolvedPhysicalConfigs)!==164)throw new Error('compteurs WAAT inattendus');
    return data;
  }

  async function loadCatalog(){
    if(window.TCC_WAAT_DIRECT_CATALOG_V1)return validateCatalog(window.TCC_WAAT_DIRECT_CATALOG_V1);
    if(!dataPromise)dataPromise=readGzipJson(DATA_URL).then(validateCatalog).then(data=>{
      window.TCC_WAAT_DIRECT_CATALOG_V1=data;indexCache=null;
      try{document.dispatchEvent(new CustomEvent('tcc:waat-map-ready',{detail:{rankableStations:Number(data.counts?.rankableStations||0),rankableConfigs:Number(data.counts?.rankablePhysicalConfigs||0)}}))}catch(e){}
      return data;
    }).catch(err=>{console.warn('[TCC V8] Base WAAT Direct ignorée :',err?.message||err);return null;});
    return dataPromise;
  }

  function operatorValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.networkName,st?.partyId,st?.cpoId].map(norm).filter(Boolean)}
  function isWaatOperator(st){
    const raw=[st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.networkName,st?.partyId,st?.cpoId,st?.id,st?.catalogStationId].map(text).join(' | ');
    if(/FR\s*\*?\s*WA2/i.test(raw)||/FRWA2/i.test(raw))return true;
    return operatorValues(st).some(v=>v==='waat'||v.startsWith('waat ')||v.includes(' waat '));
  }
  function providerOf(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}

  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls,pricing:st?.pricing}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(c?.waatDirectOffer===true||providerOf(c)==='waat direct')continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Math.max(0,Number(c?.stalls||st?.stalls||0))});
    }
    return out;
  }
  function hasDirect(configs,cfg){return (configs||[]).some(c=>(c?.waatDirectOffer===true||providerOf(c)==='waat direct')&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.35)}

  function indexes(data){
    if(indexCache?.data===data)return indexCache;
    const byStation=new Map(),byName=new Map(),byAddress=new Map();
    const add=(idx,key,rec)=>{if(!key)return;if(!idx.has(key))idx.set(key,[]);idx.get(key).push(rec)};
    for(const station of data?.stations||[]){
      const sid=compact(station?.stationIdNormalized||station?.stationId),rec={station,stationId:sid};
      if(sid)byStation.set(sid,rec);
      add(byName,norm(station?.stationName),rec);add(byAddress,norm(station?.address),rec);
    }
    indexCache={data,byStation,byName,byAddress};return indexCache;
  }

  function collectWaatStationIds(st){
    const station=new Set(),seen=new Set();
    function scan(v,depth=0,key=''){
      if(v==null||depth>4)return;
      if(typeof v==='string'||typeof v==='number'){
        const raw=String(v).toUpperCase();
        for(const m of raw.match(/FRWA2P[A-Z0-9]+/g)||[])station.add(compact(m));
        return;
      }
      if(typeof v!=='object'||seen.has(v))return;seen.add(v);
      if(Array.isArray(v)){v.slice(0,250).forEach(x=>scan(x,depth+1,key));return;}
      for(const [k,x] of Object.entries(v)){
        const nk=norm(k);if(depth<=1||/(?:pdc|station|source|external|identifier|^id$|ids|catalog)/.test(nk))scan(x,depth+1,k);
      }
    }
    scan(st);return [...station];
  }

  function stationRecord(st,data){
    if(!data?.stations)return null;const idx=indexes(data);
    for(const sid of collectWaatStationIds(st)){const rec=idx.byStation.get(sid);if(rec)return {...rec,matchMode:'station_id'}}
    if(!isWaatOperator(st))return null;
    for(const n of [norm(st?.name),norm(st?._sourceName)].filter(x=>x.length>=6)){
      const recs=idx.byName.get(n)||[];if(recs.length===1)return {...recs[0],matchMode:'exact_name'};
    }
    for(const a of [norm(st?.address),norm(st?._sourceAddress)].filter(x=>x.length>=8)){
      const recs=idx.byAddress.get(a)||[];if(recs.length===1)return {...recs[0],matchMode:'exact_address'};
    }
    return null;
  }

  function resolveConfig(st,cfg,data){
    const rec=stationRecord(st,data);if(!rec)return null;
    const hits=(rec.station?.integrationConfigs||[]).filter(c=>c?.rankable===true&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.6&&Number(c?.directEurPerKwh)>0);
    if(!hits.length)return null;
    const prices=[...new Set(hits.map(c=>Number(c.directEurPerKwh).toFixed(6)))];if(prices.length!==1)return null;
    return {station:rec.station,matchMode:rec.matchMode,kind:cfg.kind,powerKw:cfg.powerKw,directEurPerKwh:Number(prices[0]),groupIds:[...new Set(hits.flatMap(c=>c?.groupIds||[]))]};
  }

  function pricing(price){return {type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(price),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}],waatDirectExact:true}}

  function addOffers(st,data=window.TCC_WAAT_DIRECT_CATALOG_V1){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!data?.stations)return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      if(hasDirect([...base,...added],cfg))continue;
      const hit=resolveConfig(st,cfg,data);if(!hit)continue;
      added.push({
        id:`waat-direct:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
        label:`WAAT Direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:Math.max(1,cfg.stalls||1),
        pricing:pricing(hit.directEurPerKwh),offerProvider:'WAAT Direct',offerType:'operator_direct',waatDirectOffer:true,waatVerified:true,
        waatSource:'Monta public Web Map guest',waatMapVersion:data.schemaVersion,waatStationId:hit.station?.stationIdNormalized||hit.station?.stationId||'',
        waatMatchMode:hit.matchMode,waatMontaGroupIds:hit.groupIds,waatDirectEurPerKwh:hit.directEurPerKwh
      });
    }
    if(!added.length)return st;
    return {...st,chargingConfigurations:[...base,...added],_waatDirectVerified:true,_waatDirectOfferCount:added.length,_waatDirectRevision:REVISION};
  }

  async function applyToPrepared(result){
    if(!result||!Array.isArray(result.stations))return result;
    const data=await loadCatalog();if(!data)return result;
    let matched=0,offers=0;
    result.stations=result.stations.map(st=>{const out=addOffers(st,data);if(out?._waatDirectVerified){matched++;offers+=Number(out._waatDirectOfferCount||0)}return out});
    result.waatDirectApplied=true;result.waatDirectRevision=REVISION;result.waatDirectStats={matchedStations:matched,directOffers:offers};
    window.TCC_WAAT_DIRECT_STATS={...result.waatDirectStats};return result;
  }

  function install(){
    const current=window.candidateStations;if(typeof current!=='function')return false;if(current.__tccWaatDirectV1)return true;
    const wrapped=async function(...args){const result=await current.apply(this,args);return applyToPrepared(result)};
    wrapped.__tccWaatDirectV1=true;wrapped.__tccOriginal=current;window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){};
    console.info('[TCC V8] WAAT Direct actif : station + AC/DC + puissance, sans fallback réseau.');return true;
  }

  loadCatalog();
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>180)clearInterval(timer)},100);
  window.TCCWaatDirectV8={revision:REVISION,validateCatalog,loadCatalog,isWaatOperator,physicalConfigs,collectWaatStationIds,stationRecord,resolveConfig,pricing,addOffers,applyToPrepared,install,clearCache(){dataPromise=null;indexCache=null;delete window.TCC_WAAT_DIRECT_CATALOG_V1}};
})();
