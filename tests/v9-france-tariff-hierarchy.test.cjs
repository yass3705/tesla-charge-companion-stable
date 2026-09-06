const assert=require('node:assert/strict');
const fs=require('node:fs');
const Engine=require('../assets/v9/data-engine.js');
const OfferEngine=require('../assets/v9/offer-engine.js');
const Pricing=require('../assets/v9/pricing-engine.js');

const directData=JSON.parse(fs.readFileSync('data/v9/france-freshmile-offers.json','utf8'));
const direct=directData.directOffers.find(x=>x.id==='freshmile-sde82-montauban-mandoune-xqvp1');
assert.ok(direct,'real Montauban Freshmile direct offer must exist');

const pdc='FRS82EXQVP1';
const station={
  id:'FR:national:FRS82PMMQAZA',countryCode:'FR',name:'Montauban, Mandoune',
  physicalOperator:{id:'sde82',name:'SDE82'},networkBrand:'Freshmile',
  provenance:[{sourceId:'france-national',sourceStationId:'FRS82PMMQAZA'}],
  evses:[{id:pdc,pdcIds:[pdc],connectors:[{id:`${pdc}:type2`,kind:'AC',powerKw:22}]}],
  offers:[{
    id:'france-national:FRS82PMMQAZA:fallback',provider:'IRVE national',kind:'national_fallback',countries:['FR'],currency:'EUR',
    connectorKinds:['AC'],evseIds:[pdc],priority:30,sourceId:'france-national',pricing:{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:.60}]}
  }]
};

const electroverse={
  id:'electroverse-real-pdc-regression',provider:'Electroverse',offerKind:'roaming',countries:['FR'],currency:'EUR',evseIds:[pdc],connectorKinds:['AC'],minPowerKw:22,maxPowerKw:22,priority:80,
  pricing:{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:.49}]},
  metadata:{identityMode:'exact_irve_pdc',fixturePurpose:'hierarchy-regression'}
};
const wrongElectra={
  id:'electra-wrong-pdc-regression',provider:'Electra',offerKind:'roaming',countries:['FR'],currency:'EUR',evseIds:['FRS82EOTHER'],connectorKinds:['AC'],priority:80,
  pricing:{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:.20}]},metadata:{identityMode:'exact_irve_pdc'}
};

assert.equal(Engine.ruleMatchesStation(direct,station),true,'real direct Freshmile offer must match canonical station identity + exact PDC');
assert.equal(Engine.ruleMatchesStation(electroverse,station),true,'roaming offer must match the same exact PDC');
assert.equal(Engine.ruleMatchesStation(wrongElectra,station),false,'a cheaper roaming tariff on another PDC must never leak');

const sources={
  direct:{id:'france-freshmile-offers',priority:{tariff:130}},
  emsp:{id:'france-emsp-offers',priority:{tariff:80}}
};
const [applied]=Engine.applyOfferRules([station],[{source:sources.direct,rule:direct},{source:sources.emsp,rule:electroverse},{source:sources.emsp,rule:wrongElectra}]);
const merged=OfferEngine.mergeStationOffers(applied,[],{countryCode:'FR'});
assert.equal(merged.offers.filter(o=>o.kind==='direct').length,1,'direct CPO tariff must coexist');
assert.equal(merged.offers.filter(o=>o.kind==='roaming').length,1,'roaming tariff must coexist');
assert.equal(merged.offers.filter(o=>o.kind==='national_fallback').length,1,'fallback may remain stored for provenance');
assert.equal(merged.offers.some(o=>o.provider==='Electra'),false,'wrong-PDC Electra offer must be absent');

const eligible=OfferEngine.eligibleOffers(merged,[]);
assert.deepEqual(eligible.map(o=>o.kind).sort(),['direct','roaming'],'usable offers must suppress IRVE fallback once richer public tariffs exist');
assert.equal(eligible.some(o=>o.kind==='national_fallback'),false);

const directOffer=eligible.find(o=>o.kind==='direct');
const roamingOffer=eligible.find(o=>o.kind==='roaming');
const session={energyKwh:10.01,durationMinutes:200,startAt:'2026-08-29T10:00:00Z'};
const directQuote=Pricing.evaluateOffer(directOffer,session);
const roamingQuote=Pricing.evaluateOffer(roamingOffer,session);
assert.equal(directQuote.complete,true);
assert.equal(directQuote.totalEur,5.85,'real Freshmile pricing semantics must stay intact');
assert.equal(roamingQuote.complete,true);
assert.equal(roamingQuote.totalEur,4.9049,'roaming quote must remain independently calculable');

console.log(JSON.stringify({
  ok:true,station:station.name,pdc,
  storedOfferKinds:merged.offers.map(o=>o.kind).sort(),
  eligibleOfferKinds:eligible.map(o=>o.kind).sort(),
  directQuoteEur:directQuote.totalEur,roamingQuoteEur:roamingQuote.totalEur,
  invariants:['real-direct-pdc','canonical-station-provenance','direct-and-roaming-coexist','irve-fallback-only','no-cross-pdc-leakage']
},null,2));
