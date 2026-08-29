const assert=require('node:assert/strict');
const Pricing=require('../assets/v9/pricing-engine.js');

const moto={id:'belib-visitor-moto',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.33,connectedTimeBlockMinutes:15,connectedTimeBlockEur:0.22,connectedTimeBlockRounding:'started_block'}]}};
let r=Pricing.evaluateOffer(moto,{energyKwh:5,durationMinutes:16,startAt:'2026-08-29T12:00:00'});
assert.equal(r.complete,true);
assert.equal(r.components.energy,1.65);
assert.equal(r.components.connectedTimeBlocks.blocks,2);
assert.equal(r.components.connectedTimeBlocks.costEur,0.44);
assert.equal(r.totalEur,2.09);

const boostPlus={id:'belib-visitor-boostPlus',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',connectedTimePerMinuteEur:0.42}]}};
r=Pricing.evaluateOffer(boostPlus,{durationMinutes:7.5,startAt:'2026-08-29T12:00:00'});
assert.equal(r.complete,true);
assert.equal(r.totalEur,3.15);

const residentFlex={id:'belib-resident-flex',currency:'EUR',pricing:{type:'rules',rules:[
  {scope:'timeWindow',start:'08:00',end:'20:00',pricePerKwh:0.33,connectedTimeBlockMinutes:15,connectedTimeBlockEur:0.37,connectedTimeBlockRounding:'started_block'},
  {scope:'timeWindow',start:'20:00',end:'23:00',pricePerKwh:0.33,connectedTimeComponentEur:0},
  {scope:'timeWindow',start:'23:00',end:'08:00',pricePerKwh:0.25,connectedTimeComponentEur:0}
]}};
r=Pricing.evaluateOffer(residentFlex,{energyKwh:7,durationMinutes:30,startAt:'2026-08-29T23:15:00'});
assert.equal(r.complete,true);
assert.equal(r.totalEur,1.75);
assert.equal(r.matchedRule.pricePerKwh,0.25);

r=Pricing.evaluateOffer(residentFlex,{energyKwh:7,durationMinutes:30,startAt:'2026-08-29T22:45:00'});
assert.equal(r.complete,false);
assert.equal(r.reason,'tariff_window_crossing_requires_segmentation');
assert.equal(r.boundaryMinutes,15);

const longSession={id:'belib-long',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.33}],longConnectionFee:{thresholdMinutes:840,eurPerHourAfterThreshold:10,basis:'connection_time'}}};
r=Pricing.evaluateOffer(longSession,{energyKwh:20,durationMinutes:900,startAt:'2026-08-29T08:00:00'});
assert.equal(r.complete,false,'unknown published hourly rounding must never be silently guessed');
assert.equal(r.longConnection.reason,'hourly_rounding_unspecified');

console.log(JSON.stringify({ok:true,invariants:['started-15m-blocks','per-minute-pricing','overnight-window','window-crossing-fail-safe','unknown-hourly-rounding-fail-safe']},null,2));
