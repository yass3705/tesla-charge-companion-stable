const assert=require('node:assert/strict');
const Engine=require('../assets/v9/data-engine.js');
const Legacy=require('../assets/v9/adapters/legacy-direct-stations.js');

const payload={
  dataset:'ionity-direct-operated-stations-france',generatedAt:'2026-08-29T00:00:00Z',
  scope:{requiredCpoIdentifier:'IONITY_CPO'},
  locations:[{
    uuid:'uuid-1',locationId:'loc-1',
    connectors:[
      {uuid:'c1',physicalReference:'1',kind:'DC',powerKw:350,pricePerKwhEur:.69},
      {uuid:'c2',physicalReference:'2',kind:'DC',powerKw:350,pricePerKwhEur:.69},
      {uuid:'c3',physicalReference:'3',kind:'DC',powerKw:350,pricePerKwhEur:0}
    ]
  }]
};
const normalized=Legacy.normalizePayload(payload,{priority:{tariff:96}});
assert.equal(normalized.offerRules.length,1);
assert.equal(normalized.offerRules[0].metadata.identityMode,'explicit_provider_crosswalk');
assert.equal(normalized.offerRules[0].priority,96);
assert.deepEqual(normalized.offerRules[0].stationIds,['ionity:uuid-1','ionity-location:loc-1']);
assert.equal(normalized.offerRules[0].pricing.rules[0].pricePerKwh,.69);

const registry={sources:[
  {id:'national',countries:['FR'],priority:{identity:55,connectors:60},active:true},
  {id:'ionity',countries:['FR'],priority:{tariff:96},active:true,optional:true}
]};
const base={
  canonicalId:'FR:national:IONITY1',sourceStationId:'IONITY1',countryCode:'FR',name:'IONITY test',address:'Test',latitude:48.8,longitude:2.0,
  physicalOperator:{name:'IONITY'},networkBrand:'IONITY',
  evses:[{id:'cfg-dc',connectors:[{kind:'DC',powerKw:350}]}],status:{state:'available'}
};

(async()=>{
  const withCrosswalk={...base,aliases:['ionity:uuid-1']};
  const engine=Engine.createEngine({registry,loaders:{national:async()=>[withCrosswalk],ionity:async()=>normalized}});
  const area=await engine.queryArea({countryCode:'FR'});
  const direct=area.stations[0].offers.filter(o=>o.provider==='IONITY Direct');
  assert.equal(direct.length,1,'IONITY tariff should attach when explicit provider crosswalk alias exists');
  assert.equal(direct[0].pricing.rules[0].pricePerKwh,.69);

  const withoutCrosswalk={...base,aliases:[]};
  const engine2=Engine.createEngine({registry,loaders:{national:async()=>[withoutCrosswalk],ionity:async()=>normalized}});
  const area2=await engine2.queryArea({countryCode:'FR'});
  assert.equal(area2.stations[0].offers.filter(o=>o.provider==='IONITY Direct').length,0,'IONITY tariff must stay absent without explicit provider crosswalk');
  console.log('V9 IONITY fail-closed migration OK');
})().catch(error=>{console.error(error);process.exit(1);});