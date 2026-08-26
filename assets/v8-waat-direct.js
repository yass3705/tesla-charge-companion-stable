// Tesla Charge Companion V8 — WAAT France CPO-direct station/configuration tariffs.
// Source: validated WAAT/Monta public web-map guest snapshot. No roaming; unresolved cases fail closed.
(function(){
  'use strict';
  const REVISION='waat-direct-v1-20260826b';
  const DATA_URL='data/waat_direct_tariffs_tcc_france.json';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const compact=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  let dataPromise=null,indexCache=null;

  function validateCatalog(data){
    const c=data?.counts||{},s=data?.scope||{};
    if(data?.schemaVersion!=='1.0.0'||data?.dataset!=='waat-direct-tariffs-tcc-france'||data?.operator!=='WAAT'||data?.country!=='FR')throw new Error('dataset WAAT inattendu');
    if(s.directCpoOnly!==true||s.roamingIncluded!==false||s.stationSpecificPricing!==true||s.unresolvedCasesNeverRankable!==true)throw new Error('périmètre WAAT Direct invalide');
    if(Number(c.franceStations)!==571||Number(c.rankableStations)!==452||Number(c.rankableConfigs)!==507||Number(c.unresolvedStations)!==119)throw new Error('compteurs WAAT inattendus');
    const stations=Array.isArray(data?.stations)?data.stations:[],configs=stations.flatMap(st=>Array.isArray(st?.configs)?st.configs:[]);
    if(stations.length!==571||new Set(stations.map(st=>compact(st?.stationId))).size!==571||configs.length!==507)throw new Error('taille WAAT incohérente');
    if(configs.some(c=>!['AC','DC'].includes(text(c?.kind).toUpperCase())||!(Number(c?.powerKw)>0)||!(Number(c?.directEurPerKwh)>0)||!Array.isArray(c?.groupIds)||!c.groupIds.length))throw new Error('configuration WAAT invalide');
    if(configs.some(c=>(c.groupIds||[]).map(Number).includes(811653)))throw new Error('groupe WAAT ambigu publié');
    return data;
  }

  async function loadCatalog(){
    if(window.TCC_WAAT_DIRECT_CATALOG_V1)return validateCatalog(window.TCC_WAAT_DIRECT_CATALOG_V1);
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=${REVISION}`,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`base WAAT indisponible (${r.status})`);
      return r.json();
    }).then(validateCatalog).then(data=>{
      window.TCC_WAAT_DIRECT_CATALOG_V1=data;indexCache=null;
      try{document.dispatchEvent(new CustomEvent('tcc:waat-map-ready',{detail:{rankableStations:Number(data.counts?.rankableStations||0),rankableConfigs:Number(data.counts?.rankableConfigs||0)}}))}catch(e){}
      return data;
    }).catch(err=>{console.warn('[TCC V8] Base WAAT Direct ignorée :',err?.message||err);return null;});
    return dataPromise;
  }

  function operatorValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.networkName,st?.partyId,st?.cpoId,st?.provider,st?.brand].map(norm).filter(Boolean)}
  function collectWaatStationIds(st){
    const ids=new Set(),seen=new Set();
    function scan(v,depth=0){
      if(v==null||depth>4)return;
      if(typeof v==='string'||typeof v==='number'){
        const raw=String(v).toUpperCase();
        for(const m of raw.match(/FRWA2P[A-Z0-9]+/g)||[])ids.add(compact(m));
        const loose=/FR[^A-Z0-9]*WA2[^A-Z0-9]*P[^A-Z0-9]*([A-Z0-9]+)/g;let m;
        while((m=loose.exec(raw)))ids.add(`FRWA2P${m[1]}`);
        return;
      }
      if(typeof v!=='object'||seen.has(v))return;seen.add(v);
      if(Array.isArray(v)){v.slice(0,250).forEach(x=>scan(x,depth+1));return;}
      for(const [k,x] of Object.entries(v)){
        const nk=norm(k);if(depth<=1||/(?:evse|pdc|station|source|external|identifier|^id$|ids|catalog)/.test(nk))scan(x,depth+1);
      }
    }
    scan(st);return [...ids];
  }
  function isWaatOperator(st){
    if(collectWaatStationIds(st).length)return true;
    return operatorValues(st).some(v=>v==='waat'||v.startsWith('waat ')||v.includes(' waat ')||v.includes('fr wa2')||v.includes('frwa2'));
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
  function powerTolerance(a,b){return Math.max(Number(a)||0,Number(b)||0)>25?3.5:.75}
  function compatible(c,cfg){return text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<=powerTolerance(c?.powerKw,cfg.powerKw)}
  function hasDirect(configs,cfg){return (configs||[]).some(c=>(c?.waatDirectOffer===true||providerOf(c)==='waat direct')&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<=powerTolerance(c?.powerKw,cfg.powerKw))}

  function stationCoordinates(st){
    if(Array.isArray(st?.coordinates)&&st.coordinates.length>=2){const a=Number(st.coordinates[0]),b=Number(st.coordinates[1]);if(Number.isFinite(a)&&Number.isFinite(b))return[a,b];}
    const lat=Number(st?.lat??st?.latitude??st?.location?.lat??st?.coords?.lat),lng=Number(st?.lng??st?.lon??st?.longitude??st?.location?.lng??st?.location?.lon??st?.coords?.lng??st?.coords?.lon);
    return Number.isFinite(lat)&&Number.isFinite(lng)?[lat,lng]:null;
  }
  function distM(a,b){if(!a||!b)return Infinity;const R=6371000,rad=x=>x*Math.PI/180,dLat=rad(b[0]-a[0]),dLon=rad(b[1]-a[1]),h=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
  function indexes(data){
    if(indexCache?.data===data)return indexCache;
    const byStation=new Map(),byName=new Map(),byAddress=new Map(),coords=[];
    const add=(idx,key,rec)=>{if(!key)return;if(!idx.has(key))idx.set(key,[]);idx.get(key).push(rec)};
    for(const station of data?.stations||[]){
      const rec={...station,stationId:compact(station?.stationId),configs:Array.isArray(station?.configs)?station.configs:[]};
      if(rec.stationId)byStation.set(rec.stationId,rec);
      add(byName,norm(station?.name),rec);add(byAddress,norm(station?.address),rec);
      if(Array.isArray(station?.coordinates)&&station.coordinates.length>=2)coords.push(rec);
    }
    indexCache={data,byStation,byName,byAddress,coords};return indexCache;
  }
  function resolveRecords(records,cfg,mode,requireEvery=true){
    const recs=[...new Set((records||[]).filter(Boolean))];if(!recs.length)return null;
    const matched=[];
    for(const rec of recs){const hits=(rec.configs||[]).filter(c=>compatible(c,cfg));if(requireEvery&&!hits.length)return null;for(const c of hits)matched.push({rec,c});}
    if(!matched.length)return null;
    const prices=new Set(matched.map(x=>Number(x.c.directEurPerKwh).toFixed(6)));if(prices.size!==1)return null;
    return{config:matched[0].c,matchMode:mode,matchedStationIds:[...new Set(matched.map(x=>x.rec.stationId))]};
  }
  function resolveConfig(st,cfg,data){
    if(!data?.stations)return null;const idx=indexes(data),ids=collectWaatStationIds(st).map(compact);
    for(const sid of ids){const rec=idx.byStation.get(sid);if(rec){const hit=resolveRecords([rec],cfg,'station_id');if(hit)return hit;return null;}}
    if(!isWaatOperator(st))return null;
    for(const n of [norm(st?.name),norm(st?._sourceName)].filter(x=>x.length>=6)){
      const recs=idx.byName.get(n)||[];if(recs.length){const hit=resolveRecords(recs,cfg,'exact_name_power');if(hit)return hit;}
    }
    for(const a of [norm(st?.address),norm(st?._sourceAddress)].filter(x=>x.length>=8)){
      const recs=idx.byAddress.get(a)||[];if(recs.length){const hit=resolveRecords(recs,cfg,'exact_address_power');if(hit)return hit;}
    }
    const here=stationCoordinates(st);if(here){
      const near=idx.coords.map(rec=>({rec,d:distM(here,rec.coordinates)})).filter(x=>x.d<=80).sort((a,b)=>a.d-b.d);
      if(near.length){const cutoff=Math.min(80,near[0].d+20),recs=near.filter(x=>x.d<=cutoff).map(x=>x.rec);const hit=resolveRecords(recs,cfg,'coordinate_power');if(hit)return hit;}
    }
    return null;
  }

  function pricing(price){return {type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(price),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}],waatDirectExact:true}}
  function addOffers(st,data=window.TCC_WAAT_DIRECT_CATALOG_V1){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!data?.stations)return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      if(hasDirect([...base,...added],cfg))continue;
      const hit=resolveConfig(st,cfg,data);if(!hit)continue;
      const c=hit.config,price=Number(c.directEurPerKwh);if(!(price>0))continue;
      added.push({
        id:`waat-direct:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
        label:`WAAT Direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:Math.max(1,cfg.stalls||1),
        pricing:pricing(price),offerProvider:'WAAT Direct',offerType:'operator_direct',waatDirectOffer:true,waatVerified:true,
        waatSource:'Monta public Web Map guest',waatMapVersion:data.schemaVersion,waatStationId:(hit.matchedStationIds||[])[0]||'',
        waatMatchMode:hit.matchMode,waatMontaGroupIds:[...(c.groupIds||[])],waatDirectEurPerKwh:price,waatRevision:REVISION
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
  window.TCCWaatDirectV8={revision:REVISION,validateCatalog,loadCatalog,isWaatOperator,physicalConfigs,collectWaatStationIds,resolveConfig,pricing,addOffers,applyToPrepared,install,clearCache(){dataPromise=null;indexCache=null;delete window.TCC_WAAT_DIRECT_CATALOG_V1}};
})();
