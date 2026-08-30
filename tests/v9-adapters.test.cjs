const assert=require('node:assert/strict');
const fs=require('node:fs');
const Tesla=require('../assets/v9/adapters/tesla-json.js');
const National=require('../assets/v9/adapters/national-compact.js');
const Direct=require('../assets/v9/adapters/direct-offers.js');

const tesla=Tesla.normalizeStation({
  id:'tesla-eindhoven-netherlands',countryCode:'NL',name:'Tesla Eindhoven, Netherlands',address:'322 Aalsterweg',latitude:51.407102,longitude:5.479618,
  operator:'Tesla',source:'teslaSupercharger',kind:'DC',powerKw:150,stalls:24,temporarilyUnavailable:false,
  pricing:{type:'rules',rules:[{billing:'kwh',pricePerKwh:0.4,currency:'EUR'}]}
});
assert.equal(tesla.canonicalId,'tesla-eindhoven-netherlands');
assert.equal(tesla.physicalOperator.id,'tesla');
assert.equal(tesla.evses[0].connectors[0].powerKw,150);
assert.equal(tesla.status.state,'available');
assert.equal(tesla.offers[0].kind,'direct');

const frRow=[
  'FRLOC1','Test France','1 rue Test',48.85,2.35,'Example CPO',4,
  [[1,'08:00','20:00'],[2,'08:00','20:00']],
  [['cfg-ac','Example CPO · Public','AC',22,4,[['allDay','00:00','24:00','kwh','EUR',0.35,0,0,0,0,0,[1,2,3,4,5,6,0]]]]],
  '2026-08-29'
];
const fr=National.normalizeRow(frRow,{countryCode:'FR',sourceId:'france-national',schemaVersion:1,queryDate:'2026-08-29'});
assert.equal(fr.countryCode,'FR');
assert.equal(fr.physicalOperator.name,'Example CPO');
assert.equal(fr.evses[0].connectors[0].powerKw,22);
assert.equal(fr.offers[0].kind,'national_fallback');
assert.equal(fr.offers[0].pricing.rules[0].pricePerKwh,0.35);
assert.equal(fr.access.kind,'weekly');

const nlAccess=[1,[[6,'09:00','18:00']],[], 'ON_STREET',['EV_ONLY']];
const nlRow=[
  'NLLOC1','Test Nederland','Teststraat 1',51.44,5.47,'Allego',2,nlAccess,
  [['cfg-dc','Allego · Public','DC',150,2,[['allDay','00:00','24:00','kwh','EUR',0.61831,0,0,0,0,0,[6],[['TIME',18000,null,0.04999317]]]]]],
  '2026-08-29','IN_SERVICE'
];
const nl=National.normalizeRow(nlRow,{countryCode:'NL',sourceId:'netherlands-dotnl',schemaVersion:3,queryDate:'2026-08-29'});
assert.equal(nl.countryCode,'NL');
assert.equal(nl.status.state,'available');
assert.equal(nl.access.kind,'ocpi');
assert.equal(nl.access.parkingType,'ON_STREET');
assert.deepEqual(nl.access.parkingRestrictions,['EV_ONLY']);
assert.equal(nl.offers[0].pricing.rules[0].ocpiDurationBands[0][0],'TIME');
assert.equal(nl.offers[0].pricing.rules[0].ocpiDurationBands[0][1],18000);

const overlay=Direct.normalizePayload({
  schemaVersion:'1.4.2',country:'FR',operatorOffers:[
    {id:'fastned-standard',provider:'Fastned direct',offerType:'operator_direct',operatorAliases:['Fastned'],kind:'DC',pricing:{type:'rules',rules:[{billing:'kwh',currency:'EUR',pricePerKwh:0.61}]},source:'data-lab/fastned_official_france.json'}
  ],subscriptions:[
    {id:'fastned-gold',provider:'Fastned Gold',offerType:'subscription',operatorAliases:['Fastned'],kind:'DC',pricePerKwh:0.43,currency:'EUR',monthlyFeeEur:5.99,defaultSelected:false,source:'data-lab/fastned_official_france.json'}
  ]
});
assert.equal(overlay.offerRules.length,2);
assert.equal(overlay.offerRules[0].kind,'direct');
assert.equal(overlay.offerRules[0].pricing.type,'rules');
assert.deepEqual(overlay.offerRules[0].operatorIds,['fastned']);
assert.equal(overlay.offerRules[1].kind,'subscription');
assert.equal(overlay.offerRules[1].subscriptionId,'fastned-gold');
assert.equal(overlay.offerRules[1].pricing.pricePerKwh,0.43);
assert.equal(overlay.offerRules[1].metadata.monthlyFeeEur,5.99);
assert.equal(overlay.offerRules[1].metadata.defaultSelected,false);

const registry=JSON.parse(fs.readFileSync('data/v9/source-registry.json','utf8'));
const frSources=registry.sources.filter(s=>Array.isArray(s.countries)&&s.countries.includes('FR')&&s.active!==false);
const nonTeslaInventory=frSources.filter(s=>s.id!=='tesla-global'&&s.capabilities.includes('inventory'));
assert.deepEqual(nonTeslaInventory.map(s=>s.id),['france-national']);
for(const id of ['ionity-direct-france','atlante-direct-france','powerdot-direct-france']){
  const source=registry.sources.find(s=>s.id===id);
  assert(source,`missing ${id}`);
  assert.deepEqual(source.capabilities,['tariff']);
  assert.equal(source.priority.tariff,95);
  assert.equal(source.priority.identity,undefined);
  assert.equal(source.priority.connectors,undefined);
}

console.log(JSON.stringify({
  ok:true,
  adapters:{tesla:true,franceCompactV1:true,netherlandsCompactV3:true,directOfferOverlay:true},
  franceInventoryContract:{nonTeslaPhysicalBaseline:'france-national',legacyDirectSourcesTariffOnly:true},
  retainedFeatures:['Tesla global identity','national fallback offers','OCPI duration bands','NL access/parking restrictions','V8 direct tariff rule migration','subscription opt-in metadata']
},null,2));
