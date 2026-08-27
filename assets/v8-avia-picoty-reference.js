// Tesla Charge Companion V8 — AVIA VOLT / Picoty inventory adapter.
// No rankable tariff is emitted until an official station-level direct price is validated.
(function(){
  'use strict';
  const VERSION='v8-avia-picoty-reference-20260827a';
  const DATA_URL='data/avia_picoty_station_index_v1.json?v=20260827a';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const compact=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  let catalog=null,catalogPromise=null,indexCache=null;

  function loadCatalog(){
    if(catalogPromise)return catalogPromise;
    catalogPromise=fetch(DATA_URL,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`AVIA Picoty dataset unavailable (${r.status})`);
      return r.json();
    }).then(data=>{
      if(data?.dataset!=='avia-volt-picoty-reference-stations-v1'||data?.policy?.failClosed!==true||data?.policy?.rankableTariffAvailable!==false||!Array.isArray(data?.stations))throw new Error('AVIA Picoty dataset invalid');
      catalog=data;indexCache=null;return data;
    }).catch(err=>{console.warn('[TCC V8] AVIA Picoty reference not loaded:',err);return null;});
    return catalogPromise;
  }
  function operatorValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network].map(norm).filter(Boolean)}
  function isPicotyOperator(st){return operatorValues(st).some(v=>v==='picoty'||v.includes('avia volt')||v.includes('picoty'))}
  function indexes(data){
    if(indexCache?.data===data)return indexCache;
    const byStation=new Map(),byName=new Map(),byAddress=new Map();
    const add=(idx,key,rec)=>{if(!key)return;if(!idx.has(key))idx.set(key,[]);idx.get(key).push(rec)};
    for(const raw of data?.stations||[]){
      const rec={...raw,stationId:compact(raw?.stationId)};
      if(!rec.stationId.startsWith('FRPY2'))continue;
      add(byStation,rec.stationId,rec);add(byName,norm(rec.stationName),rec);add(byAddress,norm(rec.address),rec);
    }
    indexCache={data,byStation,byName,byAddress};return indexCache;
  }
  function collectStationIds(st){
    const ids=new Set(),seen=new Set();
    function scan(v,depth=0){
      if(v==null||depth>4)return;
      if(typeof v==='string'||typeof v==='number'){
        const raw=String(v).toUpperCase();for(const m of raw.match(/FRPY2[A-Z0-9]+/g)||[])ids.add(compact(m));return;
      }
      if(typeof v!=='object'||seen.has(v))return;seen.add(v);
      if(Array.isArray(v)){v.slice(0,250).forEach(x=>scan(x,depth+1));return;}
      for(const [k,x] of Object.entries(v)){const nk=norm(k);if(depth<=1||/(?:evse|pdc|station|source|external|identifier|^id$|ids)/.test(nk))scan(x,depth+1);}
    }
    scan(st);return[...ids];
  }
  function unique(rows){return Array.isArray(rows)&&rows.length===1?rows[0]:null}
  function resolve(st,data=catalog){
    if(!data?.stations)return null;const idx=indexes(data);
    for(const sid of collectStationIds(st)){const hit=unique(idx.byStation.get(sid)||[]);if(hit)return{...hit,aviaMatchMode:'station_id'};}
    if(!isPicotyOperator(st))return null;
    for(const n of [norm(st?.name),norm(st?._sourceName)].filter(x=>x.length>=6)){const hit=unique(idx.byName.get(n)||[]);if(hit)return{...hit,aviaMatchMode:'exact_name'};}
    for(const a of [norm(st?.address),norm(st?._sourceAddress)].filter(x=>x.length>=8)){const hit=unique(idx.byAddress.get(a)||[]);if(hit)return{...hit,aviaMatchMode:'exact_address'};}
    return null;
  }
  function markStation(st,data=catalog){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!data?.stations)return st;
    const rec=resolve(st,data);if(!rec)return st;
    return {...st,_tccAviaPicoty:true,_tccAviaPicotyStationId:rec.stationId||'',_tccAviaPicotyMatchMode:rec.aviaMatchMode,_tccAviaPicotyRankable:false,_tccAviaPicotyReferenceProvider:'AVIA VOLT / Picoty direct'};
  }
  async function enrichPrepared(prepared){
    if(!prepared||!Array.isArray(prepared.stations))return prepared;
    const data=await loadCatalog();if(!data)return prepared;
    let matched=0;
    prepared.stations=prepared.stations.map(st=>{const next=markStation(st,data);if(next!==st)matched++;return next;});
    prepared.aviaPicotyReferencePipelineApplied=true;prepared.aviaPicotyReferenceMatched=matched;return prepared;
  }
  function register(){const p=window.TCCV8DirectPipeline;if(!p?.registerPreparedEnricher)return false;p.registerPreparedEnricher('avia-picoty-reference',enrichPrepared,70);return true;}
  if(!register()&&typeof document!=='undefined')document.addEventListener('tcc:direct-offer-pipeline-ready',register,{once:true});
  window.TCCV8AviaPicoty={version:VERSION,loadCatalog,resolve,markStation,isPicotyOperator,enrichPrepared,get catalog(){return catalog}};
})();
