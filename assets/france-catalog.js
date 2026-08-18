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

  async function readGzipJson(file){
    if(rawCache.has(file))return rawCache.get(file);
    const promise=(async()=>{
      const response=await fetch(BASE+file,{cache:'force-cache'});
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
    rawCache.set(file,promise);
    try{return await promise}catch(err){rawCache.delete(file);throw err}
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

  function accessFromRows(rows){
    if(!Array.isArray(rows)||!rows.length)return {limited:false,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non restreints dans la source.'};
    const days={};for(let i=0;i<7;i++)days[String(i)]={open:false,start:'00:00',end:'00:00'};
    for(const r of rows){
      const day=Number(r?.[0]);if(!Number.isInteger(day)||day<0||day>6)continue;
      const start=r[1]||'00:00',end=r[2]||'24:00',current=days[String(day)];
      if(!current.open){days[String(day)]={open:true,start,end};continue;}
      if(start<current.start)current.start=start;if(end>current.end)current.end=end;
    }
    return {limited:true,days,afterCloseMode:'must_stop',afterCloseNote:'Horaires publiés par la source de données.'};
  }

  function stationFromRow(row,dayIndex){
    const configs=(row[8]||[]).map(c=>({id:c[0],label:c[1],kind:c[2]||'AC',powerKw:Number(c[3]||11),stalls:Number(c[4]||0),pricing:pricingFromRows(c[5],dayIndex)}));
    const first=configs[0]||{kind:'AC',powerKw:11,stalls:0,pricing:{type:'rules',rules:[]}};
    return {
      id:`france-catalog:${row[0]}`,catalogStationId:row[0],name:row[1]||row[2]||'Borne France',address:row[2]||'',latitude:Number(row[3]),longitude:Number(row[4]),
      operator:row[5]||'Autre',stalls:Number(row[6]||0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configs,
      access:accessFromRows(row[7]),lastUpdated:row[9]||'',source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true
    };
  }

  async function rowsNear(lat,lon,radiusKm){
    const manifest=await loadManifest();
    if(!(radiusKm>0))return readGzipJson(manifest.allFile);
    const tiles=(manifest.tiles||[]).filter(t=>intersects(t,lat,lon,radiusKm));
    const chunks=await Promise.all(tiles.map(t=>readGzipJson(t.file)));
    return chunks.flat();
  }

  if(typeof candidateStations!=='function'){
    console.warn('[TCC] Catalogue France non chargé : candidateStations indisponible.');return;
  }
  const originalCandidateStations=candidateStations;
  candidateStations=async function(filterMode='tesla',maxDistanceKm=0){
    if(filterMode!=='all')return originalCandidateStations(filterMode,maxDistanceKm);
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
      if(result)result.franceCatalogLoaded=extra.length;
      return result;
    }finally{stations=originalStations;}
  };

  window.TCCFranceCatalog={loadManifest,clearCache(){rawCache.clear();manifestPromise=null;},get cachedFragments(){return rawCache.size;}};
  console.info('[TCC] Catalogue national France hors Tesla prêt (chargement géographique à la demande).');
})();
