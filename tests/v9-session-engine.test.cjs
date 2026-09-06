const assert=require('node:assert/strict');
const Session=require('../assets/v9/session-engine.js');

const station={
  id:'station-a',countryCode:'FR',
  offers:[
    {id:'direct',provider:'Powerdot',kind:'direct',countries:['FR'],currency:'EUR',pricing:{pricePerKwh:0.49},priority:95},
    {id:'roaming',provider:'Electroverse',kind:'roaming',countries:['FR'],currency:'EUR',pricing:{pricePerKwh:0.52},priority:80},
    {id:'sub',provider:'Atlante',kind:'subscription',subscriptionId:'atlante-plus',countries:['FR','ES','IT'],currency:'EUR',ratesByCountry:{FR:{pricePerKwh:0.39},ES:{pricePerKwh:0.40},IT:{pricePerKwh:0.42}},priority:95},
    {id:'fallback',provider:'IRVE',kind:'national_fallback',countries:['FR'],currency:'EUR',pricing:{pricePerKwh:0.60},priority:30}
  ]
};

const baseSession={energyKwh:30,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR'};

const publicResult=Session.evaluateStation(station,baseSession);
assert.equal(publicResult.best.offerId,'direct');
assert.equal(publicResult.best.total,14.7);
assert.equal(publicResult.best.costPerRecoveredKm,0.0735);
assert.equal(publicResult.eligibleOfferCount,2,'fallback must disappear when richer public offers exist and unselected subscription must remain excluded');

const subscribed=Session.evaluateStation(station,{...baseSession,selectedSubscriptions:['atlante-plus']});
assert.equal(subscribed.best.offerId,'sub');
assert.equal(subscribed.best.total,11.7);
assert.equal(subscribed.best.costPerRecoveredKm,0.0585);
assert.equal(subscribed.eligibleOfferCount,3);

const eurStation={id:'eur',countryCode:'FR',offers:[{id:'eur-offer',provider:'A',kind:'direct',countries:['FR'],currency:'EUR',pricing:{pricePerKwh:0.50},priority:90}]};
const madStation={id:'mad',countryCode:'MA',offers:[{id:'mad-offer',provider:'B',kind:'direct',countries:['MA'],currency:'MAD',pricing:{pricePerKwh:4.0},priority:90}]};
const area=Session.evaluateArea([eurStation,madStation],{energyKwh:20,consumptionKwhPer100Km:20,targetCurrency:'EUR',fxRates:{MAD_EUR:0.092}},{sortBy:'costPerRecoveredKm'});
assert.equal(area[0].station.id,'mad','FX-normalized cheapest station should sort first');
assert.equal(area[0].evaluation.best.total,7.36);

const noFx=Session.evaluateStation(madStation,{energyKwh:20,targetCurrency:'EUR'});
assert.equal(noFx.best,null);
assert.equal(noFx.incomplete.length,1,'offer with unknown FX must remain visible but not comparable');

assert.equal(Session.recoveredKm({energyKwh:30,consumptionKwhPer100Km:15}),200);
assert.equal(Session.fxRate('MAD','EUR',{MAD_EUR:0.092}),0.092);

console.log(JSON.stringify({
  ok:true,module:'tcc-v9-session-engine',
  invariants:['best-total-session-cost','selected-subscription-only','national-fallback-policy','cost-per-recovered-km','fx-normalized-ranking','unknown-fx-not-compared']
},null,2));