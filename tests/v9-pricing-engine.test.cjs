const assert=require('node:assert/strict');
const Pricing=require('../assets/v9/pricing-engine.js');

const moto={id:'belib-visitor-moto',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.33,connectedTimeBlockMinutes:15,connectedTimeBlockEur:0.22,connectedTimeBlockRounding:'started_block'}]}};
let r=Pricing.evaluateOffer(moto,{energyKwh:5,durationMinutes:16,startAt:'2026-08-29T12:00:00Z'});
assert.equal(r.complete,true);
assert.equal(r.components.energy,1.65);
assert.equal(r.components.connectedTimeBlocks.blocks,2);
assert.equal(r.components.connectedTimeBlocks.costEur,0.44);
assert.equal(r.totalEur,2.09);

const boostPlus={id:'belib-visitor-boostPlus',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',connectedTimePerMinuteEur:0.42}]}};
r=Pricing.evaluateOffer(boostPlus,{durationMinutes:7.5,startAt:'2026-08-29T12:00:00Z'});
assert.equal(r.complete,true);
assert.equal(r.totalEur,3.15);

const residentFlex={id:'belib-resident-flex',currency:'EUR',metadata:{timeZone:'Europe/Paris'},pricing:{type:'rules',rules:[
  {scope:'timeWindow',start:'08:00',end:'20:00',pricePerKwh:0.33,connectedTimeBlockMinutes:15,connectedTimeBlockEur:0.37,connectedTimeBlockRounding:'started_block'},
  {scope:'timeWindow',start:'20:00',end:'23:00',pricePerKwh:0.33,connectedTimeComponentEur:0},
  {scope:'timeWindow',start:'23:00',end:'08:00',pricePerKwh:0.25,connectedTimeComponentEur:0}
]}};
// 21:15 UTC = 23:15 in Paris on 29 Aug 2026 (CEST).
r=Pricing.evaluateOffer(residentFlex,{energyKwh:7,durationMinutes:30,startAt:'2026-08-29T21:15:00Z'});
assert.equal(r.complete,true);
assert.equal(r.totalEur,1.75);
assert.equal(r.matchedRule.pricePerKwh,0.25);
assert.equal(r.timeZone,'Europe/Paris');

// 20:45 UTC = 22:45 Paris; a 30-minute session crosses the 23:00 tariff boundary.
r=Pricing.evaluateOffer(residentFlex,{energyKwh:7,durationMinutes:30,startAt:'2026-08-29T20:45:00Z'});
assert.equal(r.complete,false);
assert.equal(r.reason,'tariff_window_crossing_requires_segmentation');
assert.equal(r.boundaryMinutes,15);

const longSession={id:'belib-long',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.33}],longConnectionFee:{thresholdMinutes:840,eurPerHourAfterThreshold:10,basis:'connection_time'}}};
r=Pricing.evaluateOffer(longSession,{energyKwh:20,durationMinutes:900,startAt:'2026-08-29T08:00:00Z'});
assert.equal(r.complete,false,'unknown published hourly rounding must never be silently guessed');
assert.equal(r.longConnection.reason,'hourly_rounding_unspecified');

assert.equal(Pricing.minuteOfDay('2026-01-15T22:15:00Z','Europe/Paris'),23*60+15,'winter timezone conversion must use CET');
assert.equal(Pricing.minuteOfDay('2026-08-29T21:15:00Z','Europe/Paris'),23*60+15,'summer timezone conversion must use CEST');

console.log(JSON.stringify({ok:true,invariants:['started-15m-blocks','per-minute-pricing','station-local-timezone','dst-aware-timezone','overnight-window','window-crossing-fail-safe','unknown-hourly-rounding-fail-safe']},null,2));
