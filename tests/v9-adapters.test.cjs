const assert=require('node:assert/strict');
const Tesla=require('../assets/v9/adapters/tesla-json.js');
const National=require('../assets/v9/adapters/national-compact.js');

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

console.log(JSON.stringify({
  ok:true,
  adapters:{tesla:true,franceCompactV1:true,netherlandsCompactV3:true},
  retainedFeatures:['Tesla global identity','national fallback offers','OCPI duration bands','NL access/parking restrictions']
},null,2));
