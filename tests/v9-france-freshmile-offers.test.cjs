const assert=require('node:assert/strict');
const fs=require('node:fs');
const Engine=require('../assets/v9/data-engine.js');
const Pricing=require('../assets/v9/pricing-engine.js');
const data=JSON.parse(fs.readFileSync('data/v9/france-freshmile-offers.json','utf8'));
const rule=data.directOffers[0];
const source={id:'france-freshmile-offers',priority:{tariff:130}};

const exact={id:'FRS82PMMQAZA',countryCode:'FR',name:'Montauban, Mandoune',physicalOperator:{id:'sde82',name:'SDE82'},networkBrand:'Freshmile',evses:[{id:'FRS82EXQVP1',pdcIds:['FRS82EXQVP1'],connectors:[{id:'type2',kind:'AC',powerKw:22}]}],offers:[]};
const wrongStation={id:'FRS82POTHER',countryCode:'FR',name:'Other Freshmile 22kW',physicalOperator:{id:'sde82',name:'SDE82'},networkBrand:'Freshmile',evses:[{id:'FRS82EOTHER',pdcIds:['FRS82EOTHER'],connectors:[{id:'type2',kind:'AC',powerKw:22}]}],offers:[]};
const rightStationWrongEvse={...exact,evses:[{id:'FRS82EOTHER',pdcIds:['FRS82EOTHER'],connectors:[{id:'type2',kind:'AC',powerKw:22}]}]};

assert.equal(Engine.ruleMatchesStation(rule,exact),true,'exact station+PDC must match');
assert.equal(Engine.ruleMatchesStation(rule,wrongStation),false,'same network/power must never receive station tariff');
assert.equal(Engine.ruleMatchesStation(rule,rightStationWrongEvse),false,'station match alone is insufficient when exact PDC is required');
const applied=Engine.applyOfferRules([exact,wrongStation], [{source,rule}]);
assert.equal(applied[0].offers.length,1);assert.equal(applied[1].offers.length,0);
const offer=applied[0].offers[0];
let quote=Pricing.evaluateOffer(offer,{energyKwh:10.01,durationMinutes:200,startAt:'2026-08-29T10:00:00Z'});
assert.equal(quote.complete,true);assert.equal(quote.totalEur,5.85);assert.equal(quote.components.energyBilling.billedKwh,11);assert.equal(quote.components.connectedTimeAfterFree.costEur,0.9);
quote=Pricing.evaluateOffer(offer,{energyKwh:2,durationMinutes:30,startAt:'2026-08-29T19:45:00Z'});
assert.equal(quote.complete,false);assert.equal(quote.reason,'tariff_window_crossing_requires_segmentation');
assert.equal(data.deferred.some(x=>x.station.includes('Saint-Flour')),true,'unresolved Saint-Flour must stay deferred');
console.log(JSON.stringify({ok:true,offer:rule.id,invariants:['exact-station-and-pdc','no-network-leakage','started-kwh','180m-grace','time-window-fail-closed','unresolved-deferred']},null,2));
