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
  'const originalStations=stations',
  'stations=[...originalStations,...extra]',
  'finally{stations=originalStations;}'
])assert.ok(nlCatalog.includes(token),`Netherlands catalog must preserve the pre-existing global stations: ${token}`);
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
  fixture:'Eindhoven 50 km',
  teslaEindhoven:{id:eindhoven.id,stalls:eindhoven.stalls,powerKw:eindhoven.powerKw},
  teslaSitesWithin50Km:aroundEindhoven.map(st=>({id:st.id,name:st.name,distanceKm:Number(distanceKm(eindhoven,st).toFixed(1))})),
  dotNlPreservesGlobalStations:true,
  operatorFilterExposesTesla:true,
  canonicalTeslaPublishedFromMain:true
},null,2));
