const assert=require('node:assert/strict');
const Runtime=require('../assets/v9/runtime-engine.js');

const registry={
  subscriptionCoverage:[
    {subscriptionId:'fastned-gold',countries:['FR','NL'],operatorIds:['fastned'],evidenceSources:['france-direct','netherlands-direct']}
  ],
  sources:[
    {id:'national',countries:['FR'],priority:{identity:50,tariff:30},active:true},
    {id:'electroverse',countries:['FR'],priority:{identity:10,tariff:70},active:true},
    {id:'electroverse-live',countries:['FR'],priority:{identity:10,tariff:80},active:true},
    {id:'atlante-direct',countries:['FR'],priority:{identity:10,tariff:95},active:true},
    {id:'fastned-direct',countries:['FR'],priority:{identity:10,tariff:95},active:true}
  ]
};
const base={canonicalId:'station-a',countryCode:'FR',name:'Station A',latitude:48.8,longitude:2.1,physicalOperator:{id:'powerdot',name:'Powerdot'},evses:[]};
const fastnedBase={canonicalId:'station-fastned',countryCode:'FR',name:'Fastned A',latitude:48.81,longitude:2.11,physicalOperator:{id:'fastned',name:'Fastned'},evses:[]};
const engine=Runtime.createEngine({registry,loaders:{
  national:async()=>[{...base,sourceStationId:'nat-a'},{...fastnedBase,sourceStationId:'nat-fastned'}],
  electroverse:async()=>[{...base,sourceStationId:'ev-a',offers:[{id:'ev-old',provider:'Electroverse',kind:'roaming',countries:['FR'],pricing:{pricePerKwh:0.49},sourceId:'electroverse',priority:70}]}],
  'electroverse-live':async()=>[{...base,sourceStationId:'ev-live-a',offers:[{id:'ev-new',provider:'Electroverse',kind:'roaming',countries:['FR'],pricing:{pricePerKwh:0.49},sourceId:'electroverse-live',priority:80}]}],
  'atlante-direct':async()=>[{...base,sourceStationId:'atl-a',offers:[{id:'atlante-plus',provider:'Atlante',kind:'subscription',subscriptionId:'atlante-plus',countries:['FR','IT','ES','PT'],operatorIds:['atlante','powerdot'],ratesByCountry:{FR:{pricePerKwh:0.39},IT:{pricePerKwh:0.42},ES:{pricePerKwh:0.40},PT:{pricePerKwh:0.41}},sourceId:'atlante-direct',priority:95}]}],
  'fastned-direct':async()=>[{...fastnedBase,sourceStationId:'fastned-a',offers:[{id:'fastned-gold-fr',provider:'Fastned Gold',kind:'subscription',subscriptionId:'fastned-gold',countries:['FR'],operatorIds:['fastned'],pricing:{pricePerKwh:0.43},sourceId:'fastned-direct',priority:95}]}]
}});

(async()=>{
  const area=await engine.queryArea({
    countryCode:'FR',
    subscriptionFilters:{minCountries:2},
    selectedSubscriptions:['atlante-plus','fastned-gold'],
    session:{energyKwh:20,consumptionKwhPer100Km:15,targetCurrency:'EUR'},
    sortBy:'costPerRecoveredKm'
  });
  assert.equal(area.stations.length,2);
  const powerdot=area.stations.find(x=>x.physicalOperator.id==='powerdot');
  assert.equal(powerdot.offers.filter(o=>o.kind==='roaming').length,1,'runtime must dedupe equivalent eMSP offers');
  assert.equal(powerdot.offers.find(o=>o.kind==='roaming').provenance.length,2);
  assert.deepEqual(area.subscriptions.map(x=>x.id),['atlante-plus','fastned-gold']);
  const fastned=area.subscriptions.find(x=>x.id==='fastned-gold');
  assert.deepEqual(fastned.countries,['FR','NL'],'coverage catalogue must enrich countries without changing station tariff scope');
  assert.equal(fastned.countryCount,2);
  assert.deepEqual(fastned.coverageEvidenceSources,['france-direct','netherlands-direct']);
  const frNl=engine.deriveSubscriptionOptions(area.stations,{countryCodes:['FR','NL'],coverageMode:'all'});
  assert.deepEqual(frNl.map(x=>x.id),['fastned-gold']);
  assert.equal(area.diagnostics.subscriptionOptionCount,2);
  assert.equal(area.routingCandidates.length,2);
  const selected=engine.eligibleOffers(powerdot,['atlante-plus']);
  assert.ok(selected.some(o=>o.subscriptionId==='atlante-plus'));
  assert.equal(area.diagnostics.sessionEvaluatedStationCount,2);
  assert.equal(area.diagnostics.sessionComparableStationCount,2);
  assert.ok(area.sessionEvaluations[powerdot.id]);
  assert.equal(area.sessionEvaluations[powerdot.id].best.subscriptionId,'atlante-plus');
  assert.equal(area.sessionEvaluations[powerdot.id].best.total,7.8);
  assert.equal(area.sessionEvaluations[powerdot.id].best.costPerRecoveredKm,0.0585);
  assert.equal(area.rankedStations[0].id,powerdot.id,'cheapest recovered-km station should rank first');
  console.log(JSON.stringify({ok:true,module:'tcc-v9-runtime-engine',stations:area.stations.length,subscriptions:area.subscriptions.map(x=>({id:x.id,countries:x.countries})),best:area.sessionEvaluations[powerdot.id].best},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
