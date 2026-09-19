const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),preview=path.join(root,'v9-tesla-nl-test');
const Engine=require('../v9-production-runtime/assets/v9/data-engine.js');
const Browser=require('../v9-tesla-nl-test/browser-loaders.js');
const html=fs.readFileSync(path.join(preview,'index.html'),'utf8');
for(const [,src] of html.matchAll(/<script src="([^"]+)"/g))assert.ok(fs.existsSync(path.resolve(preview,src)),src);
const registry=JSON.parse(fs.readFileSync(path.join(preview,'source-registry.json')));
assert.deepEqual(registry.sources.map(s=>s.id),['tesla-global','netherlands-dotnl','netherlands-direct-offers']);
const fetchImpl=async url=>new Response(fs.readFileSync(path.resolve(preview,url)),{status:200});
const loaders=Browser.createRegistryLoaders({registry,basePath:'../v9-production-runtime',fetchImpl,adapters:{
  teslaJson:require('../v9-tesla-nl-test/tesla-json.js'),
  nationalCompact:require('../v9-production-runtime/assets/v9/adapters/national-compact.js'),
  directOffers:require('../v9-production-runtime/assets/v9/adapters/direct-offers.js')
}});
(async()=>{
  const engine=Engine.createEngine({registry,loaders});
  const query={countryCode:'NL',origin:{lat:51.4416,lon:5.4697},radiusKm:25,date:'2026-09-19',routingBudget:80,perOperatorFloor:2};
  const area=await engine.queryArea(query);
  assert.ok(area.stations.length>4000);
  assert.equal(area.diagnostics.errors.length,0);
  const tesla=area.stations.find(s=>s.id==='tesla-eindhoven-netherlands');
  assert.equal(tesla.offers[0].metadata.sourceProvider,'SuC Tracker');
  const filtered=await engine.queryArea({...query,filters:{operatorIds:['tesla']}});
  assert.ok(filtered.stations.length>0);
  assert.ok(filtered.stations.every(s=>s.physicalOperator.id==='tesla'));
  console.log(JSON.stringify({ok:true,stations:area.stations.length,operators:area.operators.length,teslaOnly:filtered.stations.length,source:tesla.offers[0].metadata.sourceProvider}));
})().catch(e=>{console.error(e);process.exit(1)});
