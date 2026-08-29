// Tesla Charge Companion — catalogue national Pays-Bas hors Tesla (DOT-NL).
// Chargement tuilé à la demande, sans injection persistante dans localStorage.
(function(){
  'use strict';
  const BASE='data/non_tesla_netherlands/';
  const rawCache=new Map();
  let manifestPromise=null;
  let durationPricingPromise=null;
  let accessIntervalsPromise=null;

  async function ensureDurationPricing(){
    if(window.TCCOcpiDurationPricing){window.TCCOcpiDurationPricing.install(window);return window.TCCOcpiDurationPricing;}
    if(!durationPricingPromise)durationPricingPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='assets/ocpi-duration-pricing.js?v=1';
      script.onload=()=>{if(!window.TCCOcpiDurationPricing)return reject(new Error('Extension tarifaire OCPI absente'));window.TCCOcpiDurationPricing.install(window);resolve(window.TCCOcpiDurationPricing);};
      script.onerror=()=>reject(new Error('Impossible de charger l’extension tarifaire OCPI'));document.head.appendChild(script);
    });
    return durationPricingPromise;
  }

  async function ensureAccessIntervals(){
    if(window.TCCOcpiAccessIntervals){window.TCCOcpiAccessIntervals.install(window);return window.TCCOcpiAccessIntervals;}
    if(!accessIntervalsPromise)accessIntervalsPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='assets/ocpi-access-intervals.js?v=1';
      script.onload=()=>{if(!window.TCCOcpiAccessIntervals)return reject(new Error('Extension horaires OCPI absente'));window.TCCOcpiAccessIntervals.install(window);resolve(window.TCCOcpiAccessIntervals);};
      script.onerror=()=>reject(new Error('Impossible de charger l’extension horaires OCPI'));document.head.appendChild(script);
    });
    return accessIntervalsPromise;
  }

  async function loadManifest(){
    if(!manifestPromise)manifestPromise=fetch(BASE+'manifest.json',{cache:'no-cache'}).then(r=>{
      if(!r.ok)throw new Error(`Catalogue Pays-Bas indisponible (${r.status})`);return r.json();
    }).then(m=>{
      if(Number(m?.schemaVersion)!==3)throw new Error(`Schema Pays-Bas inattendu (${m?.schemaVersion})`);
      if(Number(m?.stationCount)<70000)throw new Error(`Catalogue Pays-Bas incomplet (${m?.stationCount||0} stations)`);
      const s=m?.scope||{};
      if(s.countryCode!=='NL'||s.teslaExcluded!==true||s.ocpiDurationBands!==true||s.ocpiOpeningTimes!==true||s.ocpiParkingRestrictions!==true)throw new Error('Périmètre DOT-NL invalide');
      return m;
    });
    return manifestPromise;
  }

  async function readGzipJson(file,version=''){
    const key=`${file}|${version}`;if(rawCache.has(key))return rawCache.get(key);
    const promise=(async()=>{
      const response=await fetch(BASE+file+(version?`?v=${encodeURIComponent(version)}`:''),{cache:'force-cache'});
      if(!response.ok)throw new Error(`Fragment Pays-Bas indisponible (${response.status})`);
      const bytes=new Uint8Array(await response.arrayBuffer());let text;
      if(bytes[0]===0x1f&&bytes[1]===0x8b){
        if(typeof DecompressionStream!=='function')throw new Error('Décompression gzip indisponible dans ce navigateur');
        text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      }else text=new TextDecoder().decode(bytes);
      return JSON.parse(text);
    })();
    rawCache.set(key,promise);try{return await promise}catch(err){rawCache.delete(key);throw err}
  }

  function intersects(tile,lat,lon,radiusKm){
    if(!(radiusKm>0))return true;const latDelta=radiusKm/110.574;const cos=Math.max(.15,Math.cos(lat*Math.PI/180));const lonDelta=radiusKm/(111.320*cos);
    return tile.maxLat>=lat-latDelta&&tile.minLat<=lat+latDelta&&tile.maxLon>=lon-lonDelta&&tile.minLon<=lon+lonDelta;
  }
  function pointNearNlBounds(lat,lon,radiusKm,bounds){
    if(!Array.isArray(bounds)||bounds.length!==4)return true;
    if(lat>=bounds[0]&&lat<=bounds[1]&&lon>=bounds[2]&&lon<=bounds[3])return true;
    if(!(radiusKm>0))return false;const latDelta=radiusKm/110.574;const lonDelta=radiusKm/(111.320*Math.max(.15,Math.cos(lat*Math.PI/180)));
    return lat+latDelta>=bounds[0]&&lat-latDelta<=bounds[1]&&lon+lonDelta>=bounds[2]&&lon-lonDelta<=bounds[3];
  }
  function simulationDate(){return document.getElementById('simDate')?.value||new Date().toISOString().slice(0,10);}
  function dayIndexFromSimulation(){const value=simulationDate();const date=new Date(`${value}T12:00:00`);return Number.isFinite(date.getTime())?date.getDay():new Date().getDay();}

  function pricingFromRows(rows,dayIndex){
    const rules=(rows||[]).filter(r=>!Array.isArray(r?.[11])||r[11].includes(dayIndex)).map(r=>({
      scope:r[0]||'allDay',start:r[1]||'00:00',end:r[2]||'24:00',billing:r[3]||'kwh',currency:(r[4]||'EUR').toUpperCase(),
      pricePerKwh:Number(r[5]||0),chargePerMinute:Number(r[6]||0),connectionFee:Number(r[7]||0),idlePerMinute:Number(r[8]||0),
      afterMinutesRate:Number(r[9]||0),afterMinutesThreshold:Number(r[10]||0),afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00',
      ocpiDurationBands:Array.isArray(r[12])?r[12]:[]
    }));
    return {type:'rules',rules};
  }

  const amsterdamFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function localParts(iso){
    const d=new Date(iso);if(!Number.isFinite(d.getTime()))return null;const p={};for(const x of amsterdamFmt.formatToParts(d))if(x.type!=='literal')p[x.type]=x.value;
    return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
  }
  function toMin(v){if(v==='24:00')return 1440;const m=String(v||'00:00').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):0;}
  function toHHMM(m){m=Math.max(0,Math.min(1440,Math.round(m)));return m===1440?'24:00':`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
  function mergeIntervals(xs){
    const a=(xs||[]).map(x=>[Math.max(0,toMin(x[0])),Math.min(1440,toMin(x[1]))]).filter(x=>x[1]>x[0]).sort((x,y)=>x[0]-y[0]);const out=[];
    for(const x of a){const p=out[out.length-1];if(p&&x[0]<=p[1])p[1]=Math.max(p[1],x[1]);else out.push(x.slice());}return out;
  }
  function subtractIntervals(base,cuts){
    let out=mergeIntervals(base);for(const cut of mergeIntervals(cuts)){const next=[];for(const x of out){if(cut[1]<=x[0]||cut[0]>=x[1])next.push(x);else{if(cut[0]>x[0])next.push([x[0],cut[0]]);if(cut[1]<x[1])next.push([cut[1],x[1]]);}}out=next;}return out;
  }
  function exceptionSlice(begin,end,dateStr){
    const a=localParts(begin),b=localParts(end);if(!a||!b||dateStr<a.date||dateStr>b.date)return null;
    const s=dateStr===a.date?toMin(a.time):0,e=dateStr===b.date?toMin(b.time):1440;return e>s?[s,e]:null;
  }
  function parkingNote(parkingType,restrictions){
    const labels={EV_ONLY:'stationnement réservé aux VE',PLUGGED:'véhicule branché requis',DISABLED:'emplacement PMR',CUSTOMERS:'réservé aux clients',MOTORCYCLES:'motos'};
    const parts=[];if(parkingType)parts.push(`Parking : ${String(parkingType).replaceAll('_',' ').toLowerCase()}`);
    if(Array.isArray(restrictions)&&restrictions.length)parts.push(`Restrictions : ${restrictions.map(x=>labels[x]||String(x).replaceAll('_',' ').toLowerCase()).join(', ')}`);
    return parts.join(' · ');
  }
  function accessFromCompact(compact,dateStr){
    if(!Array.isArray(compact)||!compact.length)return {limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires DOT-NL non fournis — accès à vérifier.'};
    const mode=Number(compact[0]||0),regular=Array.isArray(compact[1])?compact[1]:[],exceptions=Array.isArray(compact[2])?compact[2]:[],parkingType=compact[3]||'',restrictions=Array.isArray(compact[4])?compact[4]:[];
    const note=parkingNote(parkingType,restrictions);if(mode===0)return {limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:note||'Horaires DOT-NL non fournis — accès à vérifier.',parkingType,parkingRestrictions:restrictions};
    const d=new Date(`${dateStr}T12:00:00`),day=Number.isFinite(d.getTime())?d.getDay():new Date().getDay();
    let intervals=mode===2?[[0,1440]]:regular.filter(r=>Number(r?.[0])===day).map(r=>[toMin(r[1]),toMin(r[2])]);
    const openings=[],closings=[];for(const ex of exceptions){const slice=exceptionSlice(ex?.[1],ex?.[2],dateStr);if(!slice)continue;(Number(ex[0])===1?openings:closings).push(slice);}
    intervals=subtractIntervals(intervals,closings);intervals=mergeIntervals([...intervals,...openings]);
    const stringIntervals=intervals.map(x=>[toHHMM(x[0]),toHHMM(x[1])]);
    const allDay=stringIntervals.length===1&&stringIntervals[0][0]==='00:00'&&stringIntervals[0][1]==='24:00';
    return {limited:!allDay,unknown:false,days:{},afterCloseMode:'must_stop',afterCloseNote:note||'Horaires publiés par DOT-NL.',parkingType,parkingRestrictions:restrictions,ocpiIntervals:{date:dateStr,intervals:stringIntervals}};
  }

  function statusFromRow(raw){const value=String(raw||'UNKNOWN').toUpperCase();if(value==='IN_SERVICE')return 'available';if(value==='OUT_OF_SERVICE')return 'out_of_service';return 'unknown';}
  function stationFromRow(row,dayIndex,dateStr){
    const configs=(row[8]||[]).map(c=>({id:c[0],label:c[1],kind:c[2]||'AC',powerKw:Number(c[3]||11),stalls:Number(c[4]||0),pricing:pricingFromRows(c[5],dayIndex)}));
    const first=configs[0]||{kind:'AC',powerKw:11,stalls:0,pricing:{type:'rules',rules:[]}};const operationalStatus=statusFromRow(row[10]);
    return {
      id:`netherlands-catalog:${row[0]}`,catalogStationId:row[0],name:row[1]||row[2]||'Borne Pays-Bas',address:row[2]||'',latitude:Number(row[3]),longitude:Number(row[4]),operator:row[5]||'DOT-NL',stalls:Number(row[6]||0),kind:first.kind,powerKw:first.powerKw,
      pricing:first.pricing,chargingConfigurations:configs,access:accessFromCompact(row[7],dateStr),lastUpdated:row[9]||'',source:'netherlandsNationalCatalog',countryCode:'NL',temporarilyUnavailable:operationalStatus==='out_of_service',readOnlyCatalog:true,
      operationalStatus,operationalStatusRaw:[row[10]||'UNKNOWN'],operationalStatusSource:'DOT-NL snapshot',operationalStatusStale:false
    };
  }

  async function rowsNear(lat,lon,radiusKm){
    const manifest=await loadManifest();const bounds=manifest?.scope?.europeanNetherlandsBounds;if(!pointNearNlBounds(lat,lon,radiusKm,bounds))return [];
    const version=manifest.generatedAt||'';if(!(radiusKm>0))return readGzipJson(manifest.allFile,version);
    const tiles=(manifest.tiles||[]).filter(t=>intersects(t,lat,lon,radiusKm));if(!tiles.length)return [];return (await Promise.all(tiles.map(t=>readGzipJson(t.file,version)))).flat();
  }

  function mergeCandidateStations(upstream,catalogResult){
    const merged=[],seen=new Set();
    for(const st of [...(upstream?.stations||[]),...(catalogResult?.stations||[])]){
      if(!st)continue;const key=String(st.id||st.catalogStationId||`${st.latitude}|${st.longitude}|${st.operator||''}`);if(seen.has(key))continue;seen.add(key);merged.push(st);
    }
    return merged;
  }

  if(typeof candidateStations!=='function'){console.warn('[TCC] Catalogue Pays-Bas non chargé : candidateStations indisponible.');return;}
  const previousCandidateStations=candidateStations;
  candidateStations=async function(filterMode='tesla',maxDistanceKm=0){
    if(filterMode!=='all')return previousCandidateStations(filterMode,maxDistanceKm);

    // Important en zone dense : le moteur historique limite à 80 candidats avant
    // calcul routier. On évalue donc d'abord les couches globales (notamment Tesla),
    // puis DOT-NL, et on fusionne les deux résultats. Ainsi des dizaines de bornes AC
    // très proches ne peuvent plus évincer tous les Superchargeurs du rayon demandé.
    const upstream=await previousCandidateStations(filterMode,maxDistanceKm);
    let upstreamRoutes={};try{upstreamRoutes={...(routeResults||{})};}catch(e){}

    const origin=upstream?.origin||await resolveOrigin(document.getElementById('simOrigin')?.value?.trim()||localStorage.getItem('tccDefaultOrigin')||'Ma position');
    const radius=Number(maxDistanceKm)||0;
    const rows=await rowsNear(origin.lat,origin.lon,radius);if(!rows.length)return upstream;
    await Promise.all([ensureDurationPricing(),ensureAccessIntervals()]);const dayIndex=dayIndexFromSimulation(),dateStr=simulationDate();const catalog=rows.map(r=>stationFromRow(r,dayIndex,dateStr));
    const originalStations=stations;const ids=new Set(originalStations.map(s=>s.id));const extra=catalog.filter(s=>!ids.has(s.id));
    try{
      stations=[...originalStations,...extra];
      const result=await previousCandidateStations(filterMode,maxDistanceKm);
      if(!result)return upstream;
      result.stations=mergeCandidateStations(upstream,result);
      result.netherlandsCatalogLoaded=extra.length;
      result.upstreamStationsPreserved=(upstream?.stations||[]).length;
      try{routeResults={...upstreamRoutes,...(routeResults||{})};}catch(e){}
      return result;
    }finally{stations=originalStations;}
  };

  window.TCCNetherlandsCatalog={loadManifest,rowsNear,accessFromCompact,mergeCandidateStations,clearCache(){rawCache.clear();manifestPromise=null;},get cachedFragments(){return rawCache.size;}};
  console.info('[TCC] Catalogue national Pays-Bas hors Tesla prêt (DOT-NL, tarifs + horaires OCPI, chargement géographique à la demande, candidats globaux préservés).');
})();
