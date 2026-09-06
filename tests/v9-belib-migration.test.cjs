const assert=require('node:assert/strict');
const fs=require('node:fs');
const Engine=require('../assets/v9/data-engine.js');
const DirectOffers=require('../assets/v9/adapters/direct-offers.js');

const payload=JSON.parse(fs.readFileSync('data/v9/france-belib-offers.json','utf8'));
const normalized=DirectOffers.normalizePayload(payload);

assert.equal(payload.policy.subscriptionsOptIn,true,'Belib subscriptions must stay opt-in');
assert.equal(payload.policy.networkBrandOnly,true,'Belib rules must target the commercial network, not the physical operator');
assert.equal(payload.directOffers.length,4,'Belib visitor tariff must expose the four official charging classes');
assert.equal(payload.subscriptionOffers.length,8,'Belib must expose resident and non-resident tariffs for each charging class');
assert.equal(normalized.offerRules.filter(r=>r.offerKind==='direct').length,4);
assert.equal(normalized.offerRules.filter(r=>r.offerKind==='subscription').length,8);

const station={
  canonicalId:'belib-test-flex',
  sourceStationId:'FR*BEL*TEST',
  countryCode:'FR',
  name:'Belib test Flex',
  address:'Paris',
  latitude:48.86,
  longitude:2.35,
  physicalOperator:{id:'totalenergies',name:'TotalEnergies'},
  networkBrand:"Belib'",
  evses:[{id:'FR*BEL*E1',pdcIds:['FR*BEL*E1'],connectors:[{id:'c1',kind:'AC',powerKw:7}]}],
  status:{state:'available',sourceId:'france-irve-dynamic'}
};

const registry={sources:[
  {id:'france-national',countries:['FR'],priority:{identity:55,connectors:60,status:0,tariff:30},active:true},
  {id:'france-belib-offers',countries:['FR'],priority:{tariff:115},active:true,optional:true}
]};

(async()=>{
  const engine=Engine.createEngine({registry,loaders:{
    'france-national':async()=>[station],
    'france-belib-offers':async()=>normalized
  }});
  const area=await engine.queryArea({countryCode:'FR'});
  assert.equal(area.stations.length,1);
  const result=area.stations[0];
  assert.equal(result.physicalOperator.id,'totalenergies','physical operator must remain independent from Belib network brand');
  assert.equal(result.networkBrand,"Belib'");

  const visitor=result.offers.filter(o=>o.kind==='direct');
  const subscriptions=result.offers.filter(o=>o.kind==='subscription');
  assert.equal(visitor.length,1,'only the exact 7 kW Belib visitor class may attach');
  assert.equal(visitor[0].id,'belib-visitor-flex');
  assert.equal(subscriptions.length,2,'only resident/non-resident 7 kW subscriptions may attach');
  assert.deepEqual(subscriptions.map(o=>o.subscriptionId).sort(),['belib-nonresident','belib-resident']);
  assert.ok(!result.offers.some(o=>o.id.includes('boost')||o.id.includes('moto')),'foreign Belib power classes must not leak onto Flex');

  const publicOffers=Engine.eligibleOffers(result,[]);
  assert.equal(publicOffers.length,1,'no Belib subscription may affect pricing until explicitly selected');
  assert.equal(publicOffers[0].id,'belib-visitor-flex');

  const residentOffers=Engine.eligibleOffers(result,['belib-resident']);
  assert.equal(residentOffers.length,2);
  assert.ok(residentOffers.some(o=>o.id==='belib-resident-flex'),'resident tariff must become eligible only after selection');
  assert.ok(!residentOffers.some(o=>o.id==='belib-nonresident-flex'),'non-resident tariff must remain excluded');

  console.log(JSON.stringify({ok:true,networkBrand:result.networkBrand,physicalOperator:result.physicalOperator.id,visitor:visitor[0].id,subscriptions:subscriptions.map(o=>o.subscriptionId).sort()},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
