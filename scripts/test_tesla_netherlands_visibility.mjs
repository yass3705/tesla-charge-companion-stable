import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

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

const eindhovenCity={latitude:51.4416,longitude:5.4697};
const eindhovenAirKm=distanceKm(eindhovenCity,eindhoven);
assert.ok(eindhovenAirKm<=25,`Tesla Eindhoven must be within the user's 25 km search radius; air distance is ${eindhovenAirKm.toFixed(2)} km`);
assert.notEqual(eindhoven.temporarilyUnavailable,true,'Tesla Eindhoven must not be filtered as temporarily unavailable');

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

const hotfix=read(releaseRoot,'assets/v8-rc48bn-runtime-hotfix.js');
for(const token of [
  "REVISION='rc48cg-nl-final-operator-sync'",
  "Object.defineProperty(window,'TCC_V8_AREA_CACHE'",
  'ensureNetherlandsTesla',
  'protectPreparedAssignments',
  'ensureTeslaOperatorChoice'
])assert.ok(hotfix.includes(token),`V8 Netherlands Tesla cache/operator guard missing: ${token}`);

const denseLocals=Array.from({length:80},(_,i)=>({
  id:`nl-regression-${i}`,
  catalogStationId:`NL:REG:${i}`,
  operator:`NL operator ${i%11}`,
  source:'netherlandsNationalCatalog',
  latitude:51.4416+i/100000,
  longitude:5.4697+i/100000
}));
const statusEl={textContent:'✓ 80 borne(s) mise(s) à jour dans un rayon routier maximal de 25 km. Tu peux lancer la simulation.'};
const hintEl={textContent:'11 opérateur(s) disponibles dans la zone chargée.'};
const operatorInputs=Array.from({length:11},(_,i)=>({type:'checkbox',value:`NL operator ${i}`,checked:false}));
const operatorHost={
  dataset:{},
  children:operatorInputs.slice(),
  querySelectorAll(selector){return selector==='input[type=checkbox]'?this.children.filter(x=>x?.type==='checkbox'):[];},
  appendChild(node){
    this.children.push(node);
    if(node?.children)for(const child of node.children)if(child?.type==='checkbox')this.children.push(child);
    return node;
  }
};
const refreshSnapshots=[];
const context={
  console,
  WeakMap,Map,Set,Array,Number,String,Date,JSON,Math,Promise,
  setTimeout:(fn)=>{fn();return 1;},
  clearTimeout:()=>{},
  queueMicrotask,
  requestAnimationFrame:(fn)=>{fn();return 1;},
  routeResults:{'nl-regression-0':{distanceKm:1,durationMin:2}},
  candidateStations:async function(mode,maxDistanceKm){
    assert.equal(mode,'tesla','cache repair must request the protected Tesla-only path');
    assert.equal(Number(maxDistanceKm),25,'cache repair must preserve the user radius');
    context.routeResults={[eindhoven.id]:{distanceKm:4.2,durationMin:8}};
    return {origin:{lat:eindhovenCity.latitude,lon:eindhovenCity.longitude},stations:[eindhoven],maxDistanceKm:25};
  },
  document:{
    readyState:'loading',
    addEventListener:()=>{},
    querySelector:()=>null,
    querySelectorAll:()=>[],
    getElementById(id){if(id==='simMaxDistance')return {value:'25'};if(id==='routeStatus')return statusEl;if(id==='augOperatorChoices')return operatorHost;if(id==='tccDynamicOperatorHint')return hintEl;return null;},
    createElement(tag){
      if(tag==='label')return {className:'',children:[],appendChild(node){this.children.push(node);return node;}};
      if(tag==='input')return {type:'',value:'',checked:false};
      return {dataset:{},style:{},appendChild:()=>{}};
    },
    createTextNode:text=>({textContent:String(text)}),
    head:{appendChild:()=>{}},
    documentElement:{}
  },
  MutationObserver:function(){this.observe=()=>{};},
  TCCV8DynamicOperators:{refresh(list){refreshSnapshots.push((list||[]).map(st=>st.id));}}
};
context.window=context;
vm.createContext(context);
vm.runInContext(hotfix,context,{filename:'assets/v8-rc48bn-runtime-hotfix.js'});

context.TCC_V8_AREA_CACHE={prepared:{stations:denseLocals.slice(),netherlandsCatalogLoaded:80,maxDistanceKm:25}};
await new Promise(resolve=>setImmediate(resolve));
const prepared=context.TCC_V8_AREA_CACHE.prepared;
assert.equal(prepared.stations.length,81,'the final Netherlands cache must contain the 80 dense DOT-NL stations plus Tesla');
assert.ok(prepared.stations.some(st=>st?.id===eindhoven.id),'Tesla Eindhoven must be restored into the final V8 area cache');
assert.equal(prepared.protectedTeslaCandidateCount,1,'the cache must expose the protected Tesla count');
assert.ok(context.routeResults['nl-regression-0'],'existing DOT-NL route metadata must survive Tesla repair');
assert.ok(context.routeResults[eindhoven.id],'Tesla route metadata must be merged into the prepared area');
assert.match(statusEl.textContent,/^✓ 81 borne\(s\)/,'the visible prepared-station count must reflect the restored Tesla candidate');
assert.ok(refreshSnapshots.some(ids=>ids.includes(eindhoven.id)),'dynamic operator choices must be refreshed with Tesla');
assert.ok(operatorHost.querySelectorAll('input[type=checkbox]').some(input=>input.value==='Tesla'),'final operator DOM must contain the Tesla checkbox even if the remembered dynamic snapshot is stale');
assert.match(hintEl.textContent,/12 opérateur\(s\)/,'operator hint must reflect Tesla after final cache protection');

prepared.stations=denseLocals.slice();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(prepared.stations.length,81,'late overlay re-truncation must not reduce the protected Netherlands cache back to 80');
assert.ok(prepared.stations.some(st=>st?.id===eindhoven.id),'late overlays must never evict Tesla Eindhoven again');

const registry=JSON.parse(read(releaseRoot,'data/v8_tariff_sources.json'));
const publishEntries=registry?.publish?.copyFromMain||[];
assert.ok(publishEntries.some(entry=>entry?.path==='data/tesla_stations.json'&&entry?.target==='data/tesla_stations.json'&&entry?.required===true),'V8 publish contract must copy the canonical Tesla catalog from main');
const teslaSource=(registry?.sources||[]).find(source=>source?.id==='tesla-global-catalog');
assert.equal(teslaSource?.status,'active','Tesla global source must be active in V8');
assert.ok((teslaSource?.artifactPaths||[]).includes('data/tesla_stations.json'));

console.log(JSON.stringify({
  ok:true,
  fixture:'Eindhoven city centre 25 km + dense 80-station DOT-NL cache',
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
  preparedBeforeProtection:80,
  preparedAfterProtection:prepared.stations.length,
  teslaProtectedAfterLateRetruncate:true,
  teslaOperatorVisible:operatorHost.querySelectorAll('input[type=checkbox]').some(input=>input.value==='Tesla'),
  visibleStatus:statusEl.textContent,
  dotNlPreservesGlobalStations:true,
  operatorFilterExposesTesla:true,
  canonicalTeslaPublishedFromMain:true
},null,2));
