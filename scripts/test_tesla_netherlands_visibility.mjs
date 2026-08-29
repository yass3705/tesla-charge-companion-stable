import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const mainRoot=path.resolve(process.argv[2]||'.');
const releaseRoot=path.resolve(process.argv[3]||'.');
const read=(root,relative)=>fs.readFileSync(path.join(root,relative),'utf8');

const tesla=JSON.parse(read(mainRoot,'data/tesla_stations.json'));
assert.ok(Array.isArray(tesla)&&tesla.length>100,'Tesla global catalog must be populated');

const eindhoven=tesla.find(st=>st?.id==='tesla-eindhoven-netherlands');
assert.ok(eindhoven,'Tesla Eindhoven must exist in the global catalog');
assert.equal(eindhoven.source,'teslaSupercharger');
assert.equal(String(eindhoven.countryCode||'').toUpperCase(),'NL');
assert.ok(Number(eindhoven.stalls)>=20,'Tesla Eindhoven stall count looks incomplete');

const toRad=value=>Number(value)*Math.PI/180;
function distanceKm(a,b){
  const lat1=toRad(a.latitude),lat2=toRad(b.latitude);
  const dLat=lat2-lat1,dLon=toRad(b.longitude)-toRad(a.longitude);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

// Same geographic point used by the Eindhoven regression fixture in the catalogue
// integration test. It is deliberately the city centre, not the Supercharger itself.
const eindhovenCity={latitude:51.4416,longitude:5.4697};
const eindhovenAirKm=distanceKm(eindhovenCity,eindhoven);
assert.ok(eindhovenAirKm<=25,`Tesla Eindhoven must be within the user's 25 km search radius; air distance is ${eindhovenAirKm.toFixed(2)} km`);
assert.notEqual(eindhoven.temporarilyUnavailable,true,'Tesla Eindhoven must not be filtered as temporarily unavailable');

// Reproduce the base candidateStations Tesla predicate + 25 km air-distance prefilter
// against the real published Tesla catalogue.
const teslaWithin25Km=tesla.filter(st=>
  st?.temporarilyUnavailable!==true&&
  ((String(st?.operator||'').toLowerCase()==='tesla')||st?.source==='teslaSupercharger')&&
  Number.isFinite(Number(st?.latitude))&&Number.isFinite(Number(st?.longitude))&&
  distanceKm(eindhovenCity,st)<=25+1e-9
).sort((a,b)=>distanceKm(eindhovenCity,a)-distanceKm(eindhovenCity,b));
assert.ok(teslaWithin25Km.some(st=>st?.id===eindhoven.id),'The real Tesla Eindhoven entry must survive the exact Tesla candidate predicate at 25 km');

const aroundEindhoven=tesla.filter(st=>
  st?.source==='teslaSupercharger'&&
  String(st?.countryCode||'').toUpperCase()==='NL'&&
  Number.isFinite(Number(st?.latitude))&&Number.isFinite(Number(st?.longitude))&&
  distanceKm(eindhoven,st)<=50+1e-9
);
assert.ok(aroundEindhoven.length>=2,`Expected at least two Tesla sites within 50 km of Eindhoven, got ${aroundEindhoven.length}`);
assert.ok(aroundEindhoven.some(st=>/best/i.test(`${st?.name||''} ${st?.address||''}`)),'Tesla Best must remain visible in the Eindhoven 50 km fixture');

const nlCatalog=read(mainRoot,'assets/netherlands-catalog.js');
for(const token of [
  "previousCandidateStations('tesla',maxDistanceKm)",
  'const originalStations=stations',
  'stations=[...originalStations,...extra]',
  'result.stations=mergeCandidateStations(upstream,result)',
  'finally{stations=originalStations;}'
])assert.ok(nlCatalog.includes(token),`Netherlands catalog must preserve the pre-existing Tesla/global stations: ${token}`);
assert.ok(nlCatalog.includes("if(filterMode!=='all')return previousCandidateStations"),'DOT-NL must only extend the all-operators path');

const dynamicFilter=read(releaseRoot,'assets/v8-dynamic-filter.js');
assert.ok(dynamicFilter.includes("if(st?.source==='teslaSupercharger')return'Tesla';"),'V8 operator filter must canonicalize Tesla Superchargers to Tesla');
assert.ok(dynamicFilter.includes("candidateStations('all',maxDistanceKm)"),'V8 operator list must be built from the complete prepared area');

const registry=JSON.parse(read(releaseRoot,'data/v8_tariff_sources.json'));
const publishEntries=registry?.publish?.copyFromMain||[];
assert.ok(publishEntries.some(entry=>entry?.path==='data/tesla_stations.json'&&entry?.target==='data/tesla_stations.json'&&entry?.required===true),'V8 publish contract must copy the canonical Tesla catalog from main');
const teslaSource=(registry?.sources||[]).find(source=>source?.id==='tesla-global-catalog');
assert.equal(teslaSource?.status,'active','Tesla global source must be active in V8');
assert.ok((teslaSource?.artifactPaths||[]).includes('data/tesla_stations.json'));

console.log(JSON.stringify({
  ok:true,
  fixture:'Eindhoven city centre 25 km',
  teslaEindhoven:{
    id:eindhoven.id,
    name:eindhoven.name,
    address:eindhoven.address,
    latitude:eindhoven.latitude,
    longitude:eindhoven.longitude,
    stalls:eindhoven.stalls,
    powerKw:eindhoven.powerKw,
    temporarilyUnavailable:!!eindhoven.temporarilyUnavailable,
    distanceFromEindhovenCityKm:Number(eindhovenAirKm.toFixed(2))
  },
  teslaSitesWithin25Km:teslaWithin25Km.map(st=>({
    id:st.id,
    name:st.name,
    distanceKm:Number(distanceKm(eindhovenCity,st).toFixed(2)),
    temporarilyUnavailable:!!st.temporarilyUnavailable
  })),
  dotNlPreservesGlobalStations:true,
  operatorFilterExposesTesla:true,
  canonicalTeslaPublishedFromMain:true
},null,2));
