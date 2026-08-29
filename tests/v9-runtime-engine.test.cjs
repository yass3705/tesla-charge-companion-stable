const assert=require('node:assert/strict');
const Runtime=require('../assets/v9/runtime-engine.js');

const registry={sources:[
  {id:'national',countries:['FR'],priority:{identity:50,tariff:30},active:true},
  {id:'electroverse',countries:['FR'],priority:{identity:10,tariff:70},active:true},
  {id:'electroverse-live',countries:['FR'],priority:{identity:10,tariff:80},active:true},
  {id:'atlante-direct',countries:['FR'],priority:{identity:10,tariff:95},active:true}
]};
const base={canonicalId:'station-a',countryCode:'FR',name:'Station A',latitude:48.8,longitude:2.1,physicalOperator:{id:'powerdot',name:'Powerdot'},evses:[]};
const engine=Runtime.createEngine({registry,loaders:{
  national:async()=>[{...base,sourceStationId:'nat-a'}],
  electroverse:async()=>[{...base,sourceStationId:'ev-a',offers:[{id:'ev-old',provider:'Electroverse',kind:'roaming',countries:['FR'],pricing:{pricePerKwh:0.49},sourceId:'electroverse',priority:70}]}],
  'electroverse-live':async()=>[{...base,sourceStationId:'ev-live-a',offers:[{id:'ev-new',provider:'Electroverse',kind:'roaming',countries:['FR'],pricing:{pricePerKwh:0.49},sourceId:'electroverse-live',priority:80}]}],
  'atlante-direct':async()=>[{...base,sourceStationId:'atl-a',offers:[{id:'atlante-plus',provider:'Atlante',kind:'subscription',subscriptionId:'atlante-plus',countries:['FR','IT','ES','PT'],operatorIds:['atlante','powerdot'],ratesByCountry:{FR:{pricePerKwh:0.39},IT:{pricePerKwh:0.42},ES:{pricePerKwh:0.40},PT:{pricePerKwh:0.41}},sourceId:'atlante-direct',priority:95}]}]
}});

(async()=>{
  const area=await engine.queryArea({countryCode:'FR',subscriptionFilters:{minCountries:3}});
  assert.equal(area.stations.length,1);
  assert.equal(area.stations[0].offers.filter(o=>o.kind==='roaming').length,1,'runtime must dedupe equivalent eMSP offers');
  assert.equal(area.stations[0].offers.find(o=>o.kind==='roaming').provenance.length,2);
  assert.deepEqual(area.subscriptions.map(x=>x.id),['atlante-plus']);
  assert.equal(area.diagnostics.subscriptionOptionCount,1);
  assert.equal(area.routingCandidates[0].id,area.stations[0].id);
  const selected=engine.eligibleOffers(area.stations[0],['atlante-plus']);
  assert.ok(selected.some(o=>o.subscriptionId==='atlante-plus'));
  console.log(JSON.stringify({ok:true,module:'tcc-v9-runtime-engine',stations:area.stations.length,offers:area.stations[0].offers.length,subscriptions:area.subscriptions.length},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
