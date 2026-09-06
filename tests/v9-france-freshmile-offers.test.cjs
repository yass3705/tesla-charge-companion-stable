const assert=require('node:assert/strict');
const fs=require('node:fs');
const Engine=require('../assets/v9/data-engine.js');
const Pricing=require('../assets/v9/pricing-engine.js');
const data=JSON.parse(fs.readFileSync('data/v9/france-freshmile-offers.json','utf8'));
const montauban=data.directOffers.find(x=>x.id==='freshmile-sde82-montauban-mandoune-xqvp1');
const saintFlour=data.directOffers.find(x=>x.id==='freshmile-sdec15-saint-flour-georges-pompidou');
const source={id:'france-freshmile-offers',priority:{tariff:130}};

const exact={id:'FRS82PMMQAZA',countryCode:'FR',name:'Montauban, Mandoune',physicalOperator:{id:'sde82',name:'SDE82'},networkBrand:'Freshmile',evses:[{id:'FRS82EXQVP1',pdcIds:['FRS82EXQVP1'],connectors:[{id:'type2',kind:'AC',powerKw:22}]}],offers:[]};
const wrongStation={id:'FRS82POTHER',countryCode:'FR',name:'Other Freshmile 22kW',physicalOperator:{id:'sde82',name:'SDE82'},networkBrand:'Freshmile',evses:[{id:'FRS82EOTHER',pdcIds:['FRS82EOTHER'],connectors:[{id:'type2',kind:'AC',powerKw:22}]}],offers:[]};
const rightStationWrongEvse={...exact,evses:[{id:'FRS82EOTHER',pdcIds:['FRS82EOTHER'],connectors:[{id:'type2',kind:'AC',powerKw:22}]}]};
assert.equal(Engine.ruleMatchesStation(montauban,exact),true,'exact station+PDC must match');
assert.equal(Engine.ruleMatchesStation(montauban,wrongStation),false,'same network/power must never receive station tariff');
assert.equal(Engine.ruleMatchesStation(montauban,rightStationWrongEvse),false,'station match alone is insufficient when exact PDC is required');
const applied=Engine.applyOfferRules([exact,wrongStation], [{source,rule:montauban}]);
assert.equal(applied[0].offers.length,1);assert.equal(applied[1].offers.length,0);
let quote=Pricing.evaluateOffer(applied[0].offers[0],{energyKwh:10.01,durationMinutes:200,startAt:'2026-08-29T10:00:00Z'});
assert.equal(quote.complete,true);assert.equal(quote.totalEur,5.85);assert.equal(quote.components.energyBilling.billedKwh,11);assert.equal(quote.components.connectedTimeAfterFree.costEur,0.9);
quote=Pricing.evaluateOffer(applied[0].offers[0],{energyKwh:2,durationMinutes:30,startAt:'2026-08-29T19:45:00Z'});
assert.equal(quote.complete,false);assert.equal(quote.reason,'tariff_window_crossing_unsupported_components');

assert.ok(saintFlour,'Saint-Flour exact offer must exist');
assert.equal(saintFlour.stationIds,undefined,'conflicting copied station IDs must not be used');
assert.deepEqual(saintFlour.evseIds.sort(),['FRFR1EQAHS1','FRFR1EUSWB1','FRFR1EYKHW1'].sort());
const sfExact={id:'station:any',countryCode:'FR',name:'Freshmile France/LLIEE5ICH2C4QK',physicalOperator:{id:'freshmile',name:'Freshmile'},networkBrand:'Freshmile France',evses:[
  {id:'FRFR1EQAHS1',pdcIds:['FRFR1EQAHS1'],connectors:[{id:'t2',kind:'AC',powerKw:22}]},
  {id:'FRFR1EUSWB1',pdcIds:['FRFR1EUSWB1'],connectors:[{id:'ccs1',kind:'DC',powerKw:50}]},
  {id:'FRFR1EYKHW1',pdcIds:['FRFR1EYKHW1'],connectors:[{id:'ccs2',kind:'DC',powerKw:50}]}
],offers:[]};
const sfWrong={...sfExact,evses:[{id:'FRFR1EOTHER',pdcIds:['FRFR1EOTHER'],connectors:[{id:'t2',kind:'AC',powerKw:22}]}]};
assert.equal(Engine.ruleMatchesStation(saintFlour,sfExact),true,'one of the exact Saint-Flour PDCs must match');
assert.equal(Engine.ruleMatchesStation(saintFlour,sfWrong),false,'same Freshmile network and power without exact PDC must not match');
const sfApplied=Engine.applyOfferRules([sfExact,sfWrong],[{source,rule:saintFlour}]);
assert.equal(sfApplied[0].offers.length,1);assert.equal(sfApplied[1].offers.length,0);
quote=Pricing.evaluateOffer(sfApplied[0].offers[0],{durationMinutes:15,startAt:'2026-08-29T12:00:00Z'});
assert.equal(quote.complete,true);assert.equal(quote.totalEur,6);
quote=Pricing.evaluateOffer(sfApplied[0].offers[0],{durationMinutes:25,startAt:'2026-08-29T12:00:00Z'});
assert.equal(quote.complete,true);assert.equal(quote.totalEur,7.5);assert.equal(quote.components.connectedTimeInitialTier.excessMinutes,10);
assert.equal(data.deferred.length,0,'Saint-Flour resolution should clear Freshmile deferred list');
console.log(JSON.stringify({ok:true,offers:data.directOffers.map(x=>x.id),invariants:['exact-station-and-pdc','no-network-leakage','started-kwh','180m-grace','time-window-fail-closed','saint-flour-exact-pdcs','saint-flour-initial-tier']},null,2));
