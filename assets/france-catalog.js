// Tesla Charge Companion — catalogue national France hors Tesla.
// Le catalogue reste hors de `stations`/localStorage et n'est chargé que pour
// la zone utile à la comparaison. Les bornes custom et Tesla restent séparées.
(function(){
  const BASE='data/non_tesla_france/';
  const rawCache=new Map();
  let manifestPromise=null;

  async function loadManifest(){
    if(!manifestPromise)manifestPromise=fetch(BASE+'manifest.json',{cache:'no-cache'}).then(r=>{
      if(!r.ok)throw new Error(`Catalogue France indisponible (${r.status})`);
      return r.json();
    }).then(m=>{
      if(Number(m?.stationCount)<40000)throw new Error(`Catalogue France incomplet (${m?.stationCount||0} stations)`);
      return m;
    });
    return manifestPromise;
  }

  async function readGzipJson(file,version=''){
    const cacheKey=`${file}|${version}`;
    if(rawCache.has(cacheKey))return rawCache.get(cacheKey);
    const promise=(async()=>{
      const url=BASE+file+(version?`?v=${encodeURIComponent(version)}`:'');
      const response=await fetch(url,{cache:'force-cache'});
      if(!response.ok)throw new Error(`Fragment France indisponible (${response.status})`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      let text;
      if(bytes[0]===0x1f&&bytes[1]===0x8b){
        if(typeof DecompressionStream!=='function')throw new Error('Ce navigateur ne prend pas en charge la décompression du catalogue France.');
        const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        text=await new Response(stream).text();
      }else text=new TextDecoder().decode(bytes);
      return JSON.parse(text);
    })();
    rawCache.set(cacheKey,promise);
    try{return await promise}catch(err){rawCache.delete(cacheKey);throw err}
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
    const rules=(rows||[]).filter(r=>!Array.isArray(r?.[11])||r[11].includes(dayIndex)).map(r=>({
      scope:r[0]||'allDay',start:r[1]||'00:00',end:r[2]||'24:00',billing:r[3]||'kwh',currency:(r[4]||'EUR').toUpperCase(),
      pricePerKwh:Number(r[5]||0),chargePerMinute:Number(r[6]||0),connectionFee:Number(r[7]||0),idlePerMinute:Number(r[8]||0),
      afterMinutesRate:Number(r[9]||0),afterMinutesThreshold:Number(r[10]||0),afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'
    }));
    return {type:'rules',rules};
  }

  function providerFromConfigLabel(label){
    const s=String(label||'').trim();
    const i=s.indexOf('·');
    return (i>=0?s.slice(0,i):s).trim();
  }

  function pricingSignature(pricing){
    return JSON.stringify((pricing?.rules||[]).map(r=>({
      scope:r.scope||'',start:r.start||'',end:r.end||'',billing:r.billing||'',currency:(r.currency||'EUR').toUpperCase(),
      k:Number(r.pricePerKwh||0),m:Number(r.chargePerMinute||0),f:Number(r.connectionFee||0),i:Number(r.idlePerMinute||0),
      ar:Number(r.afterMinutesRate||0),at:Number(r.afterMinutesThreshold||0)
    })));
  }

  // Electra peut publier plusieurs tarifs distincts au niveau d'une localisation sans
  // indiquer à quelle EVSE/prise/puissance chacun appartient. Ils sont exclus des
  // configurations simulables, mais conservés séparément pour affichage avec avertissement.
  function separateAmbiguousElectra(configs){
    const groups=new Map();
    (configs||[]).forEach((c,index)=>{
      if(providerFromConfigLabel(c.label).toLowerCase()!=='electra')return;
      const key=`${String(c.kind||'').toUpperCase()}|${Number(c.powerKw||0).toFixed(2)}`;
      let g=groups.get(key);if(!g){g={indices:[],sigs:new Set()};groups.set(key,g);}
      g.indices.push(index);g.sigs.add(pricingSignature(c.pricing));
    });
    const drop=new Set(),ambiguous=[];
    for(const [key,g] of groups.entries()){
      if(!(g.indices.length>1&&g.sigs.size>1))continue;
      const unique=new Map();
      for(const i of g.indices){
        drop.add(i);
        const c=configs[i],sig=pricingSignature(c.pricing);
        if(sig&&!unique.has(sig))unique.set(sig,c.pricing);
      }
      const [kind,power]=key.split('|');
      ambiguous.push({provider:'Electra',kind,powerKw:Number(power),pricings:[...unique.values()]});
    }
    return {configs:(configs||[]).filter((_,i)=>!drop.has(i)),ambiguous,suppressed:drop.size};
  }

  function accessFromRows(rows){
    if(!Array.isArray(rows)||!rows.length)return {limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la source — accès à vérifier.'};
    const days={};for(let i=0;i<7;i++)days[String(i)]={open:false,start:'00:00',end:'00:00'};
    for(const r of rows){
      const day=Number(r?.[0]);if(!Number.isInteger(day)||day<0||day>6)continue;
      const start=r[1]||'00:00',end=r[2]||'24:00',current=days[String(day)];
      if(!current.open){days[String(day)]={open:true,start,end};continue;}
      if(start<current.start)current.start=start;if(end>current.end)current.end=end;
    }
    return {limited:true,unknown:false,days,afterCloseMode:'must_stop',afterCloseNote:'Horaires publiés par la source de données.'};
  }

  function stationFromRow(row,dayIndex){
    const rawConfigs=(row[8]||[]).map(c=>({id:c[0],label:c[1],kind:c[2]||'AC',powerKw:Number(c[3]||11),stalls:Number(c[4]||0),pricing:pricingFromRows(c[5],dayIndex)}));
    const separated=separateAmbiguousElectra(rawConfigs),configs=separated.configs;
    const first=configs[0]||rawConfigs.find(c=>providerFromConfigLabel(c.label).toLowerCase()!=='electra')||{kind:'AC',powerKw:11,stalls:0,pricing:{type:'rules',rules:[]}};
    const station={
      id:`france-catalog:${row[0]}`,catalogStationId:row[0],name:row[1]||row[2]||'Borne France',address:row[2]||'',latitude:Number(row[3]),longitude:Number(row[4]),
      operator:row[5]||'Autre',stalls:Number(row[6]||0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configs,
      access:accessFromRows(row[7]),lastUpdated:row[9]||'',source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,
      ambiguousElectraConfigurationsSuppressed:separated.suppressed,ambiguousSourceOffers:separated.ambiguous
    };
    return window.TCCFranceCanonicalOverlay?.apply?.(station)||station;
  }

  async function rowsNear(lat,lon,radiusKm){
    const manifest=await loadManifest();
    const version=manifest.runtimePatchedAt||manifest.allSha256||manifest.generatedAt||'';
    if(!(radiusKm>0))return readGzipJson(manifest.allFile,version);
    const tiles=(manifest.tiles||[]).filter(t=>intersects(t,lat,lon,radiusKm));
    const chunks=await Promise.all(tiles.map(t=>readGzipJson(t.file,version)));
    return chunks.flat();
  }

  if(typeof candidateStations!=='function'){
    console.warn('[TCC] Catalogue France non chargé : candidateStations indisponible.');return;
  }
  const originalCandidateStations=candidateStations;
  candidateStations=async function(filterMode='tesla',maxDistanceKm=0){
    if(filterMode!=='all')return originalCandidateStations(filterMode,maxDistanceKm);
    if(window.TCCFranceCanonicalOverlay?.enabled?.()){
      try{await window.TCCFranceCanonicalOverlay.prepare()}catch(err){console.warn('[TCC] Overlay canonique ignoré :',err)}
    }
    const originText=document.getElementById('simOrigin')?.value?.trim()||localStorage.getItem('tccDefaultOrigin')||'Ma position';
    const origin=await resolveOrigin(originText);
    const rows=await rowsNear(origin.lat,origin.lon,Number(maxDistanceKm)||0);
    const dayIndex=dayIndexFromSimulation();
    const catalog=rows.map(r=>stationFromRow(r,dayIndex));
    const originalStations=stations;
    const ids=new Set(originalStations.map(s=>s.id));
    const extra=catalog.filter(s=>!ids.has(s.id));
    try{
      stations=[...originalStations,...extra];
      const result=await originalCandidateStations(filterMode,maxDistanceKm);
      if(result){
        result.franceCatalogLoaded=extra.length;
        result.canonicalOverlayEnabled=!!window.TCCFranceCanonicalOverlay?.enabled?.();
        result.canonicalOverlayStations=extra.filter(s=>s.canonicalOverlayApplied).length;
      }
      return result;
    }finally{stations=originalStations;}
  };

  window.TCCFranceCatalog={loadManifest,clearCache(){rawCache.clear();manifestPromise=null;},get cachedFragments(){return rawCache.size;}};
  console.info('[TCC] Catalogue national France hors Tesla prêt (chargement géographique à la demande).');
})();