const assert=require('node:assert/strict');
const L=require('../assets/v9/browser-loaders.js');
const manifest={tiles:[
  {id:'near',minLat:48.5,maxLat:49,minLon:2,maxLon:2.5,file:'near.json.gz'},
  {id:'far',minLat:45,maxLat:45.5,minLon:5,maxLon:5.5,file:'far.json.gz'}
]};
const bounds=L.boundsFromQuery({origin:{lat:48.8,lon:2.1},radiusKm:20});
assert(bounds.minLat<48.8&&bounds.maxLat>48.8);
assert.deepEqual(L.selectTiles(manifest,{origin:{lat:48.8,lon:2.1},radiusKm:20}).map(x=>x.id),['near']);
assert.deepEqual(L.selectTiles(manifest,{}),[]);
const registry={sources:[
  {id:'tesla-global',adapter:'tesla-json',path:'data/tesla.json',active:true},
  {id:'france-national',adapter:'national-compact-v2',manifest:'data/fr/manifest.json',root:'data/fr/',countries:['FR'],active:true},
  {id:'france-offers',adapter:'direct-offer-json',path:'data/offers.json',active:true},
  {id:'future',adapter:'unknown',active:true},
  {id:'off',adapter:'direct-offer-json',path:'data/off.json',active:false}
]};
const adapters={
  teslaJson:{createLoader:()=>async()=>[]},
  directOffers:{createLoader:()=>async()=>({offerRules:[]})},
  nationalCompact:{normalizeRow:x=>x}
};
const loaders=L.createRegistryLoaders({registry,adapters,fetchImpl:async()=>{throw new Error('not called');}});
assert.deepEqual(Object.keys(loaders).sort(),['france-national','france-offers','tesla-global']);
console.log(JSON.stringify({ok:true,selectedTiles:['near'],loaderIds:Object.keys(loaders).sort()},null,2));
