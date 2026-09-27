'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const pricing=require('../v9-production-runtime/assets/v9/pricing-engine.js');
(async()=>{
for(const prefix of ['v9-test','v9-production-runtime']){
 const base=path.join(__dirname,'..',prefix);
 const adapter=require(base+'/assets/v9/adapters/morocco-public.js');
 const browser=require(base+'/assets/v9/browser-loaders.js');
 const registry=require(base+'/data/v9/source-registry.json');
 const data=require(base+'/data/v9/morocco-shell-al-jazira.json');
 const sources=registry.sources.filter(s=>s.id==='morocco-shell-al-jazira');
 assert.equal(sources.length,1);
 const requests=[];
 const loaders=browser.createRegistryLoaders({registry:{sources},basePath:'/preview',adapters:{moroccoPublic:adapter},fetchImpl:async url=>{
 requests.push(url);return {ok:true,json:async()=>data};
 }});
 const stations=await loaders[sources[0].id]();
 assert.deepEqual(requests,['/preview/data/v9/morocco-shell-al-jazira.json']);
 assert.equal(stations.length,1);
 const station=stations[0],offer=station.offers[0];
 assert.equal(station.status.state,'unknown');
 assert.equal(station.physicalOperator,null);
 assert.deepEqual(station.evses,[]);
 assert.equal(offer.metadata.fallbackApplied,true);
 assert.match(offer.provider,/repli TCC/);
 const free=pricing.evaluateOffer(offer,{energyKwh:40,durationMinutes:30});
 assert.equal(free.complete,true);assert.equal(free.totalEur,0);assert.equal(free.currency,'MAD');
 const paid=adapter.normalizeShellAlJazira({...data,tariff:{sourceType:'official',sourceUrl:'https://example.org/tariff',currency:'MAD',pricePerKwh:3}})[0].offers[0];
 assert.equal(paid.metadata.fallbackApplied,false);
 assert.equal(pricing.evaluateOffer(paid,{energyKwh:40}).totalEur,120);
 for(const stationPatch of [{id:'other'},{countryCode:'FR'},{networkBrand:'Kilowatt'}])
 assert.throws(()=>adapter.normalizeShellAlJazira({...data,station:{...data.station,...stationPatch}}),/scope mismatch/);
 assert.throws(()=>adapter.normalizeShellAlJazira({...data,tariff:{sourceType:'official',currency:'MAD',pricePerKwh:-1}}),/invalid/);
 assert.equal(registry.sources.find(s=>s.id==='morocco-kilowatt-public').profile,'kilowatt-native');
 console.log(prefix+': loading, fallback pricing, explicit-price precedence, scope and unknown-status checks passed');
}
})().catch(e=>{console.error(e);process.exitCode=1;});
