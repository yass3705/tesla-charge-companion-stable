const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const Engine=require('../assets/v9/data-engine.js');
const Tesla=require('../assets/v9/adapters/tesla-json.js');
const National=require('../assets/v9/adapters/national-compact.js');
const Direct=require('../assets/v9/adapters/direct-offers.js');

const root=path.resolve(__dirname,'..');
function localFetch(url){
  const clean=String(url).split('?')[0].replace(/^\/+/,''),file=path.join(root,clean);
  if(!fs.existsSync(file))return Promise.resolve({ok:false,status:404,json:async()=>({}),arrayBuffer:async()=>new ArrayBuffer(0)});
  let bytes=fs.readFileSync(file);if(clean.endsWith('.gz'))bytes=zlib.gunzipSync(bytes);
  const arrayBuffer=()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  return Promise.resolve({ok:true,status:200,json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>arrayBuffer()});
}

(async()=>{
  const registry=JSON.parse(fs.readFileSync(path.join(root,'data/v9/source-registry.json'),'utf8'));
  const engine=Engine.createEngine({registry,loaders:{
    'tesla-global':Tesla.createLoader({url:'data/tesla_stations.json',fetchImpl:localFetch}),
    'netherlands-dotnl':National.createLoader({base:'data/non_tesla_netherlands/',countryCode:'NL',sourceId:'netherlands-dotnl',fetchImpl:localFetch}),
    'netherlands-direct-offers':Direct.createLoader({url:'data/netherlands_direct_tariffs_v1.json',fetchImpl:localFetch})
  }});
  const area=await engine.queryArea({countryCode:'NL',origin:{lat:51.4416,lon:5.4697},radiusKm:25,date:'2026-08-29',routingBudget:80,perOperatorFloor:2});
  assert.ok(area.stations.length>1000,`real Eindhoven query looks incomplete: ${area.stations.length}`);
  const tesla=area.stations.find(s=>s.id==='tesla-eindhoven-netherlands');
  assert.ok(tesla,'real Tesla Eindhoven must be present in the unified area');
  assert.ok(area.operators.some(o=>o.id==='tesla'),'Tesla must be visible in operators derived from the real final area');
  assert.ok(area.routingCandidates.some(s=>s.id==='tesla-eindhoven-netherlands'),'operator-aware routing budget must retain Tesla Eindhoven');
  assert.ok(area.stations.length>area.routingCandidates.length,'routing budget must be separate from the complete area catalogue');

  const fastned=area.stations.find(s=>Engine.operatorId(s.physicalOperator)==='fastned');
  assert.ok(fastned,'a real Fastned station should exist in the Eindhoven 25 km area');
  const fastnedDirect=fastned.offers.find(o=>o.id==='fastned-direct-nl');
  const fastnedGold=fastned.offers.find(o=>o.id==='fastned-gold');
  assert.equal(fastnedDirect?.pricing?.pricePerKwh,0.77,'NL direct offer must attach declaratively after physical merge');
  assert.equal(fastnedGold?.pricing?.pricePerKwh,0.54,'NL subscription offer must attach declaratively after physical merge');
  assert.ok(!Engine.eligibleOffers(fastned,[]).some(o=>o.subscriptionId==='fastned-gold'),'Fastned Gold must remain opt-in');
  assert.ok(Engine.eligibleOffers(fastned,['fastned-gold']).some(o=>o.subscriptionId==='fastned-gold'),'selected Fastned Gold must become eligible');

  assert.ok(area.diagnostics.sources['netherlands-dotnl'].stationCount>1000,'DOT-NL adapter must load real geographic shards');
  assert.ok(area.diagnostics.sources['tesla-global'].stationCount>100,'Tesla adapter must load the canonical global source');
  assert.ok(area.diagnostics.sources['netherlands-direct-offers'].offerRuleCount>=10,'direct offers must be loaded as rules, not station wrappers');

  console.log(JSON.stringify({
    ok:true,fixture:'real Eindhoven 25 km',stations:area.stations.length,operators:area.operators.length,routingCandidates:area.routingCandidates.length,
    tesla:{id:tesla.id,name:tesla.name},fastned:{id:fastned.id,direct:fastnedDirect.pricing.pricePerKwh,gold:fastnedGold.pricing.pricePerKwh},
    sourceDiagnostics:area.diagnostics.sources
  },null,2));
})().catch(err=>{console.error(err);process.exit(1);});
