// Tesla Charge Companion — catalogue national Pays-Bas hors Tesla (DOT-NL).
// Chargement tuilé à la demande, sans injection persistante dans localStorage.
(function(){
  'use strict';
  const BASE='data/non_tesla_netherlands/';
  const rawCache=new Map();
  let manifestPromise=null;
  let durationPricingPromise=null;

  async function ensureDurationPricing(){
    if(window.TCCOcpiDurationPricing){window.TCCOcpiDurationPricing.install(window);return window.TCCOcpiDurationPricing;}
    if(!durationPricingPromise)durationPricingPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='assets/ocpi-duration-pricing.js?v=1';
      script.onload=()=>{
        if(!window.TCCOcpiDurationPricing)return reject(new Error('Extension tarifaire OCPI absente'));
        window.TCCOcpiDurationPricing.install(window);resolve(window.TCCOcpiDurationPricing);
      };
      script.onerror=()=>reject(new Error('Impossible de charger l’extension tarifaire OCPI'));
      document.head.appendChild(script);
    });
    return durationPricingPromise;
  }

  async function loadManifest(){
    if(!manifestPromise)manifestPromise=fetch(BASE+'manifest.json',{cache:'no-cache'}).then(r=>{
      if(!r.ok)throw new Error(`Catalogue Pays-Bas indisponible (${r.status})`);
      return r.json();
    }).then(m=>{
      if(Number(m?.schemaVersion)!==2)throw new Error(`Schema Pays-Bas inattendu (${m?.schemaVersion})`);
      if(Number(m?.stationCount)<70000)throw new Error(`Catalogue Pays-Bas incomplet (${m?.stationCount||0} stations)`);
      if(m?.scope?.countryCode!=='NL'||m?.scope?.teslaExcluded!==true||m?.scope?.ocpiDurationBands!==true)throw new Error('Périmètre DOT-NL invalide');
      return m;
    });
    return manifestPromise;
  }

  async function readGzipJson(file,version=''){
    const key=`${file}|${version}`;
    if(rawCache.has(key))return rawCache.get(key);
    const promise=(async()=>{
      const response=await fetch(BASE+file+(version?`?v=${encodeURIComponent(version)}`:''),{cache:'force-cache'});
      if(!response.ok)throw new Error(`Fragment Pays-Bas indisponible (${response.status})`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      let text;
      if(bytes[0]===0x1f&&bytes[1]===0x8b){
        if(typeof DecompressionStream!=='function')throw new Error('Décompression gzip indisponible dans ce navigateur');
        text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      }else text=new TextDecoder().decode(bytes);
      return JSON.parse(text);
    })();
    rawCache.set(key,promise);
    try{return await promise}catch(err){rawCache.delete(key);throw err}
  }

  function intersects(tile,lat,lon,radiusKm){
    if(!(radiusKm>0))return true;
    const latDelta=radiusKm/110.574;
    const cos=Math.max(.15,Math.cos(lat*Math.PI/180));
    const lonDelta=radiusKm/(111.320*cos);
    return tile.maxLat>=lat-latDelta&&tile.minLat<=lat+latDelta&&tile.maxLon>=lon-lonDelta&&tile.minLon<=lon+lonDelta;
  }

  function pointNearNlBounds(lat,lon,radiusKm,bounds){
    if(!Array.isArray(bounds)||bounds.length!==4)return true;
    if(lat>=bounds[0]&&lat<=bounds[1]&&lon>=bounds[2]&&lon<=bounds[3])return true;
    if(!(radiusKm>0))return false;
    const latDelta=radiusKm/110.574;
    const lonDelta=radiusKm/(111.320*Math.max(.15,Math.cos(lat*Math.PI/180)));
    return lat+latDelta>=bounds[0]&&lat-latDelta<=bounds[1]&&lon+lonDelta>=bounds[2]&&lon-lonDelta<=bounds[3];
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
      afterMinutesRate:Number(r[9]||0),afterMinutesThreshold:Number(r[10]||0),afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00',
      ocpiDurationBands:Array.isArray(r[12])?r[12]:[]
    }));
    return {type:'rules',rules};
  }

  function statusFromRow(raw){
    const value=String(raw||'UNKNOWN').toUpperCase();
    if(value==='IN_SERVICE')return 'available';
    if(value==='OUT_OF_SERVICE')return 'out_of_service';
    return 'unknown';
  }

  function stationFromRow(row,dayIndex){
    const configs=(row[8]||[]).map(c=>({
      id:c[0],label:c[1],kind:c[2]||'AC',powerKw:Number(c[3]||11),stalls:Number(c[4]||0),pricing:pricingFromRows(c[5],dayIndex)
    }));
    const first=configs[0]||{kind:'AC',powerKw:11,stalls:0,pricing:{type:'rules',rules:[]}};
    const operationalStatus=statusFromRow(row[10]);
    return {
      id:`netherlands-catalog:${row[0]}`,catalogStationId:row[0],name:row[1]||row[2]||'Borne Pays-Bas',address:row[2]||'',
      latitude:Number(row[3]),longitude:Number(row[4]),operator:row[5]||'DOT-NL',stalls:Number(row[6]||0),kind:first.kind,powerKw:first.powerKw,
      pricing:first.pricing,chargingConfigurations:configs,
      access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non encore compactés depuis DOT-NL.'},
      lastUpdated:row[9]||'',source:'netherlandsNationalCatalog',countryCode:'NL',temporarilyUnavailable:operationalStatus==='out_of_service',readOnlyCatalog:true,
      operationalStatus,operationalStatusRaw:[row[10]||'UNKNOWN'],operationalStatusSource:'DOT-NL snapshot',operationalStatusStale:false
    };
  }

  async function rowsNear(lat,lon,radiusKm){
    const manifest=await loadManifest();
    const bounds=manifest?.scope?.europeanNetherlandsBounds;
    if(!pointNearNlBounds(lat,lon,radiusKm,bounds))return [];
    const version=manifest.generatedAt||'';
    if(!(radiusKm>0))return readGzipJson(manifest.allFile,version);
    const tiles=(manifest.tiles||[]).filter(t=>intersects(t,lat,lon,radiusKm));
    if(!tiles.length)return [];
    return (await Promise.all(tiles.map(t=>readGzipJson(t.file,version)))).flat();
  }

  if(typeof candidateStations!=='function'){
    console.warn('[TCC] Catalogue Pays-Bas non chargé : candidateStations indisponible.');return;
  }

  const previousCandidateStations=candidateStations;
  candidateStations=async function(filterMode='tesla',maxDistanceKm=0){
    if(filterMode!=='all')return previousCandidateStations(filterMode,maxDistanceKm);
    const originText=document.getElementById('simOrigin')?.value?.trim()||localStorage.getItem('tccDefaultOrigin')||'Ma position';
    const origin=await resolveOrigin(originText);
    const radius=Number(maxDistanceKm)||0;
    const rows=await rowsNear(origin.lat,origin.lon,radius);
    if(!rows.length)return previousCandidateStations(filterMode,maxDistanceKm);
    await ensureDurationPricing();
    const dayIndex=dayIndexFromSimulation();
    const catalog=rows.map(r=>stationFromRow(r,dayIndex));
    const originalStations=stations;
    const ids=new Set(originalStations.map(s=>s.id));
    const extra=catalog.filter(s=>!ids.has(s.id));
    try{
      stations=[...originalStations,...extra];
      const result=await previousCandidateStations(filterMode,maxDistanceKm);
      if(result)result.netherlandsCatalogLoaded=extra.length;
      return result;
    }finally{stations=originalStations;}
  };

  window.TCCNetherlandsCatalog={loadManifest,rowsNear,clearCache(){rawCache.clear();manifestPromise=null;},get cachedFragments(){return rawCache.size;}};
  console.info('[TCC] Catalogue national Pays-Bas hors Tesla prêt (DOT-NL, chargement géographique à la demande).');
})();
