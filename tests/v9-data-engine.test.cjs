const assert=require('node:assert/strict');
const Engine=require('../assets/v9/data-engine.js');

const origin={lat:51.4416,lon:5.4697};
const connector=p=>[{id:`evse-${p}`,connectors:[{id:`c-${p}`,powerKw:p,kind:p>50?'DC':'AC'}]}];

function denseDotNl(count=1000){
  return Array.from({length:count},(_,i)=>({
    canonicalId:`dotnl-${i}`,
    sourceStationId:`NL-${i}`,
    countryCode:'NL',
    name:`DOT-NL ${i}`,
    address:`${i} Teststraat, Eindhoven`,
    latitude:51.4416+(i%50)/10000,
    longitude:5.4697+(Math.floor(i/50)%20)/10000,
    physicalOperator:{id:`operator-${i%15}`,name:`Operator ${i%15}`},
    evses:connector(i%4===0?150:11),
    status:{state:'available',sourceId:'dotnl'}
  }));
}

const teslaEindhoven={
  canonicalId:'tesla-eindhoven-netherlands',
  sourceStationId:'tesla-eindhoven-netherlands',
  aliases:['tesla:tesla-eindhoven-netherlands'],
  countryCode:'NL',
  name:'Tesla Eindhoven, Netherlands',
  address:'322 Aalsterweg, Eindhoven 5644 RL, Netherlands',
  latitude:51.407102,longitude:5.479618,
  physicalOperator:{id:'tesla',name:'Tesla'},
  networkBrand:'Tesla Supercharger',
  evses:connector(150),
  status:{state:'available',sourceId:'tesla-global'},
  offers:[{id:'tesla-public',provider:'Tesla',kind:'direct',countries:['NL'],currency:'EUR',pricing:{type:'tesla'}}]
};

const registry={sources:[
  {id:'tesla-global',countries:['*'],priority:{identity:100,connectors:100,status:80,tariff:100},active:true},
  {id:'netherlands-dotnl',countries:['NL'],priority:{identity:60,connectors:65,status:65,tariff:35},active:true}
]};

async function denseAreaTest(){
  const engine=Engine.createEngine({registry,loaders:{
    'tesla-global':async()=>[teslaEindhoven],
    'netherlands-dotnl':async()=>denseDotNl(1000)
  }});
  const area=await engine.queryArea({countryCode:'NL',origin,radiusKm:25,routingBudget:80,perOperatorFloor:2});
  assert.equal(area.stations.length,1001,'all source stations must be merged before any routing budget');
  assert.ok(area.stations.some(s=>s.id==='tesla-eindhoven-netherlands'),'Tesla must survive a dense national catalogue');
  assert.ok(area.operators.some(o=>o.id==='tesla'),'operators must be derived from the final canonical stations');
  assert.ok(area.routingCandidates.some(s=>s.id==='tesla-eindhoven-netherlands'),'routing budget must preserve operator representation');
  assert.ok(area.routingCandidates.length>=80,'routing budget is applied after merge, never to source ingestion');
  assert.equal(area.diagnostics.fragmentCount,1001);
  return area;
}

async function sourceOrderTest(){
  const fragments={
    'tesla-global':async()=>[teslaEindhoven],
    'netherlands-dotnl':async()=>denseDotNl(20)
  };
  const a=Engine.createEngine({registry,loaders:fragments});
  const b=Engine.createEngine({registry:{sources:[...registry.sources].reverse()},loaders:fragments});
  const qa={countryCode:'NL',origin,radiusKm:25,routingBudget:20};
  const [ra,rb]=await Promise.all([a.queryArea(qa),b.queryArea(qa)]);
  const compact=r=>({stations:r.stations,operators:r.operators,routing:r.routingCandidates.map(s=>s.id)});
  assert.deepEqual(compact(ra),compact(rb),'source registration/load order must not change the canonical result');
}

async function stationLimitBeforeOfferJoinTest(){
  const r={sources:[
    {id:'stations',countries:['NL'],priority:{identity:50},active:true},
    {id:'offers',countries:['NL'],priority:{tariff:90},active:true,optional:true}
  ]};
  const rows=denseDotNl(200);
  const rules=rows.map((station,i)=>({id:`rule-${i}`,provider:'Test',countries:['NL'],stationIds:[station.canonicalId],pricing:{pricePerKwh:.5},priority:90}));
  const engine=Engine.createEngine({registry:r,loaders:{stations:async()=>rows,offers:async()=>({offerRules:rules})}});
  const area=await engine.queryArea({countryCode:'NL',origin,radiusKm:25,stationLimit:24,routingBudget:80});
  assert.equal(area.stations.length,24,'device station limit must be applied before the expensive offer join');
  assert.equal(area.diagnostics.sourceStationCount,200,'pre-limit station count remains observable');
  assert.equal(area.diagnostics.stationLimitApplied,true);
  assert.equal(area.diagnostics.stationLimit,24);
  assert(area.stations.every(st=>st.offers.some(o=>o.provider==='Test')),'selected stations retain their exact offers');
}

async function fieldPriorityAndOffersTest(){
  const r={sources:[
    {id:'national',countries:['NL'],priority:{identity:50,connectors:55,status:60,tariff:30},active:true},
    {id:'direct',countries:['NL'],priority:{identity:90,connectors:90,status:50,tariff:95},active:true}
  ]};
  const national={
    canonicalId:'shared-site',aliases:['ocpi:NL:ABC'],countryCode:'NL',name:'National fallback',latitude:51.4,longitude:5.4,
    physicalOperator:{id:'ionity',name:'IONITY'},evses:connector(50),status:{state:'available',sourceId:'national'},
    offers:[{id:'ionity-national',provider:'IONITY',kind:'national_fallback',countries:['NL'],pricing:{pricePerKwh:0.823}}]
  };
  const direct={
    canonicalId:'shared-site',aliases:['ocpi:NL:ABC'],countryCode:'NL',name:'IONITY Eindhoven',latitude:51.40001,longitude:5.40001,
    physicalOperator:{id:'ionity',name:'IONITY'},evses:connector(350),status:{state:'unknown',sourceId:'direct'},
    offers:[
      {id:'ionity-direct',provider:'IONITY',kind:'direct',countries:['NL'],pricing:{pricePerKwh:0.76}},
      {id:'ionity-power',provider:'IONITY',kind:'subscription',subscriptionId:'ionity-power',countries:['FR','NL'],ratesByCountry:{NL:{pricePerKwh:0.43},FR:{pricePerKwh:0.39}}}
    ]
  };
  const engine=Engine.createEngine({registry:r,loaders:{national:async()=>[national],direct:async()=>[direct]}});
  const area=await engine.queryArea({countryCode:'NL'});
  assert.equal(area.stations.length,1,'national and direct fragments with the same canonical identity must merge');
  const st=area.stations[0];
  assert.equal(st.name,'IONITY Eindhoven','higher identity priority must win without replacing the entity');
  assert.equal(st.evses[0].connectors[0].powerKw,350,'higher connector priority must win');
  assert.equal(st.status.state,'available','field-specific status priority must be independent from identity priority');
  assert.ok(st.offers.some(o=>o.kind==='national_fallback'),'national fallback remains available as provenance/fallback');
  assert.ok(st.offers.some(o=>o.id==='ionity-direct'&&o.pricing.pricePerKwh===0.76),'verified direct offer must be attached');
  const publicOnly=Engine.eligibleOffers(st,[]);
  assert.ok(!publicOnly.some(o=>o.subscriptionId),'subscription offers must be opt-in');
  const selected=Engine.eligibleOffers(st,['ionity-power']);
  const power=selected.find(o=>o.id==='ionity-power');
  assert.equal(power.pricing.pricePerKwh,0.43,'one global subscription must materialize the NL country rate');
  assert.equal(Engine.materializeOffer(direct.offers[1],'FR').pricing.pricePerKwh,0.39,'the same subscription must materialize a different country rate');
}

async function optionalSourceFailureIsolationTest(){
  const r={sources:[
    {id:'good',countries:['NL'],priority:{identity:50},active:true},
    {id:'broken',countries:['NL'],priority:{identity:99},active:true,optional:true}
  ]};
  const engine=Engine.createEngine({registry:r,loaders:{good:async()=>[teslaEindhoven],broken:async()=>{throw new Error('offline')}}});
  const area=await engine.queryArea({countryCode:'NL'});
  assert.equal(area.stations.length,1,'one failed optional source must not erase healthy sources');
  assert.equal(area.diagnostics.errors.length,1);
  assert.equal(area.diagnostics.errors[0].sourceId,'broken');
}

async function requiredSourceFailureTest(){
  const r={sources:[
    {id:'france-national',countries:['FR'],priority:{identity:50},active:true},
    {id:'optional-overlay',countries:['FR'],priority:{tariff:99},active:true,optional:true}
  ]};
  const engine=Engine.createEngine({registry:r,loaders:{
    'france-national':async()=>{throw new Error('national baseline unavailable')},
    'optional-overlay':async()=>[]
  }});
  await assert.rejects(
    ()=>engine.queryArea({countryCode:'FR'}),
    err=>err?.code==='TCC_V9_REQUIRED_SOURCE_FAILED'&&err.failures?.[0]?.sourceId==='france-national',
    'a failed required physical baseline must fail the query explicitly'
  );
}

function exactTariffScopeLeakageTest(){
  const source={id:'france-etotem-offers',priority:{tariff:130}};
  const rule={
    id:'etotem-planchonnais-ac',provider:'e-Totem direct',countries:['FR'],operatorAliases:['e-Totem'],
    evseIds:['FRETIE44172C15','FR*ETI*E44172*C15'],connectorKinds:['AC'],minPowerKw:22,maxPowerKw:22,
    currency:'EUR',priority:130,pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.40}]}
  };
  const target={
    id:'irve-planchonnais',aliases:['irve-station:FRETIE44172P1'],countryCode:'FR',name:'Planchonnais',
    physicalOperator:{id:'e-totem',name:'e-Totem'},networkBrand:'Nantes Métropole / e-Totem',
    evses:[{id:'FRETIE44172C15',connectors:[{id:'type2',powerKw:22,kind:'AC'}]}],offers:[],provenance:[]
  };
  const foreignSameOperator={
    id:'irve-other-etotem',aliases:['irve-station:OTHER'],countryCode:'FR',name:'Other e-Totem station',
    physicalOperator:{id:'e-totem',name:'e-Totem'},networkBrand:'e-Totem',
    evses:[{id:'FR*G10*E99999*1',connectors:[{id:'type2',powerKw:22,kind:'AC'}]}],offers:[],provenance:[]
  };
  assert.equal(Engine.ruleMatchesStation(rule,target),true,'the exact verified PDC must match');
  assert.equal(Engine.ruleMatchesStation(rule,foreignSameOperator),false,'same operator, connector and power must never be enough for a station-scoped tariff');
  const [a,b]=Engine.applyOfferRules([target,foreignSameOperator],[{rule,source}]);
  assert.equal(a.offers.length,1,'the exact target receives the tariff');
  assert.equal(a.offers[0].pricing.rules[0].pricePerKwh,0.40);
  assert.equal(b.offers.length,0,'a different e-Totem station must receive no leaked tariff');
}

(async()=>{
  const dense=await denseAreaTest();
  await sourceOrderTest();
  await stationLimitBeforeOfferJoinTest();
  await fieldPriorityAndOffersTest();
  await optionalSourceFailureIsolationTest();
  await requiredSourceFailureTest();
  exactTariffScopeLeakageTest();
  console.log(JSON.stringify({
    ok:true,
    engine:'tcc-v9-unified-data',
    denseFixture:{stations:dense.stations.length,operators:dense.operators.length,routingCandidates:dense.routingCandidates.length,teslaVisible:dense.operators.some(o=>o.id==='tesla')},
    invariants:['merge-before-prune','operator-from-final-state','source-order-independent','field-level-priority','multi-country-subscription','optional-source-failure-isolation','required-source-fail-closed','exact-station-tariff-no-network-leakage']
  },null,2));
})().catch(err=>{console.error(err);process.exit(1);});
