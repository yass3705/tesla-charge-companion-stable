const assert=require('assert');
const {ruleMatchesStation,applyOfferRules}=require('../assets/v9/data-engine.js');
const directOffers=require('../assets/v9/adapters/direct-offers.js');

const payload={
  country:'FR',
  directOffers:[{
    id:'bump-direct-exact-scope-test',
    provider:'Bump direct',
    countries:['FR'],
    evseIds:['FRBMPE1234'],
    currency:'EUR',
    priority:125,
    directOperatorOnly:true,
    verifiedScope:'exact_evse',
    pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.42}]}
  }]
};

const rule=directOffers.normalizePayload(payload).offerRules[0];
const source={id:'france-bump-offers',priority:{tariff:125}};
const base={
  countryCode:'FR',
  physicalOperator:{id:'bump',name:'Bump'},
  networkBrand:'Bump',
  offers:[]
};
const matching={
  ...base,
  id:'station-bump-matching',
  evses:[{id:'FRBMPE1234',connectors:[{kind:'CCS',powerKw:150}]}]
};
const wrongPdc={
  ...base,
  id:'station-bump-other',
  evses:[{id:'FRBMPE9999',connectors:[{kind:'CCS',powerKw:150}]}]
};

assert.strictEqual(ruleMatchesStation(rule,matching),true,'exact Bump PDC must match');
assert.strictEqual(ruleMatchesStation(rule,wrongPdc),false,'another Bump PDC must not inherit the tariff');

const applied=applyOfferRules([matching,wrongPdc],[{rule,source}]);
assert.strictEqual(applied[0].offers.length,1,'exact PDC should receive one Bump offer');
assert.strictEqual(applied[0].offers[0].id,'bump-direct-exact-scope-test');
assert.strictEqual(applied[1].offers.length,0,'non-matching PDC must receive no Bump offer');

console.log('Bump exact PDC scope tests passed');
