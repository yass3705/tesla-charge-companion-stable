const assert=require('assert');
const DataEngine=require('../assets/v9/data-engine.js');
const Legacy=require('../assets/v9/adapters/legacy-direct-tariffs.js');

const payload={
  dataset:'e55c-operated-france-tcc-v8',generatedAt:'2026-08-29T00:00:00Z',
  scope:{strictOperatorValue:'ELECTRIC 55 CHARGING'},
  profiles:{p22:{rules:[{scope:'allDay',billing:'kwh',currency:'EUR',pricePerKwh:.29}]}},
  stations:[{
    stationId:'FR*E55*S*001',localStationId:'001',
    configurations:[
      {kind:'AC',powerKw:22,priceStatus:'resolved_e55c_scan_pay',pricingProfileId:'p22',evseIds:['FR*E55*E*001*1'],localEvseIds:[],paymentUrls:['https://example.invalid/pay']},
      {kind:'DC',powerKw:150,priceStatus:'unresolved',pricingProfileId:'',evseIds:['FR*E55*E*001*2']},
      {kind:'AC',powerKw:22,priceStatus:'resolved_e55c_scan_pay',pricingProfileId:'p22',evseIds:[]}
    ]
  }]
};

const normalized=Legacy.normalizePayload(payload,{priority:{tariff:97}});
assert.equal(normalized.offerRules.length,1,'only verified rules with exact EVSE identity should migrate');
const rule=normalized.offerRules[0];
assert.equal(rule.metadata.identityMode,'exact_evse');
assert.equal(rule.priority,97);
assert(rule.operatorIds.includes('electric-55-charging'));
assert.deepEqual(rule.evseIds,['FR*E55*E*001*1']);
assert.equal(rule.pricing.rules[0].pricePerKwh,.29);

const registry={sources:[
  {id:'national',adapter:'test',countries:['FR'],capabilities:['inventory'],priority:{identity:55,connectors:60},active:true},
  {id:'e55c',adapter:'test',countries:['FR'],capabilities:['tariff'],priority:{tariff:97},active:true,optional:true}
]};
const nationalStation={
  canonicalId:'FR:national:test',sourceStationId:'national-1',countryCode:'FR',name:'E55C test',address:'Test',latitude:48.8,longitude:2.0,
  physicalOperator:{name:'Electric 55 Charging'},networkBrand:'E55C',
  evses:[{id:'cfg-ac',pdcIds:['FR*E55*E*001*1'],connectors:[{kind:'AC',powerKw:22}]}],status:{state:'available'}
};
const engine=DataEngine.createEngine({registry,loaders:{national:async()=>[nationalStation],e55c:async()=>normalized}});

(async()=>{
  const area=await engine.queryArea({countryCode:'FR',origin:{lat:48.8,lon:2.0},radiusKm:5});
  assert.equal(area.stations.length,1);
  const direct=area.stations[0].offers.filter(o=>o.provider==='E55C direct');
  assert.equal(direct.length,1,'verified direct E55C offer should attach to the national station');
  assert.equal(direct[0].pricing.rules[0].pricePerKwh,.29);
  assert.equal(direct[0].metadata.verified,true);

  const mismatch={...nationalStation,canonicalId:'FR:national:other',evses:[{id:'cfg-ac',pdcIds:['FR*OTHER*E*9'],connectors:[{kind:'AC',powerKw:22}]}]};
  const engine2=DataEngine.createEngine({registry,loaders:{national:async()=>[mismatch],e55c:async()=>normalized}});
  const area2=await engine2.queryArea({countryCode:'FR',origin:{lat:48.8,lon:2.0},radiusKm:5});
  assert.equal(area2.stations[0].offers.filter(o=>o.provider==='E55C direct').length,0,'E55C offer must not attach without exact EVSE identity');
  console.log('V9 E55C exact migration OK');
})().catch(error=>{console.error(error);process.exit(1);});