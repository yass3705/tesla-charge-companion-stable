const assert=require('node:assert/strict');
const Pricing=require('../assets/v9/pricing-engine.js');

const moto={id:'belib-visitor-moto',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.33,connectedTimeBlockMinutes:15,connectedTimeBlockEur:0.22,connectedTimeBlockRounding:'started_block'}]}};
let r=Pricing.evaluateOffer(moto,{energyKwh:5,durationMinutes:16,startAt:'2026-08-29T12:00:00Z'});
assert.equal(r.complete,true);assert.equal(r.components.energy,1.65);assert.equal(r.components.connectedTimeBlocks.blocks,2);assert.equal(r.components.connectedTimeBlocks.costEur,0.44);assert.equal(r.totalEur,2.09);

const boostPlus={id:'belib-visitor-boostPlus',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',connectedTimePerMinuteEur:0.42}]}};
r=Pricing.evaluateOffer(boostPlus,{durationMinutes:7.5,startAt:'2026-08-29T12:00:00Z'});assert.equal(r.complete,true);assert.equal(r.totalEur,3.15);

const residentFlex={id:'belib-resident-flex',currency:'EUR',metadata:{timeZone:'Europe/Paris'},pricing:{type:'rules',rules:[
  {scope:'timeWindow',start:'08:00',end:'20:00',pricePerKwh:0.33,connectedTimeBlockMinutes:15,connectedTimeBlockEur:0.37,connectedTimeBlockRounding:'started_block'},
  {scope:'timeWindow',start:'20:00',end:'23:00',pricePerKwh:0.33,connectedTimeComponentEur:0},
  {scope:'timeWindow',start:'23:00',end:'08:00',pricePerKwh:0.25,connectedTimeComponentEur:0}
]}};
r=Pricing.evaluateOffer(residentFlex,{energyKwh:7,durationMinutes:30,startAt:'2026-08-29T21:15:00Z'});assert.equal(r.complete,true);assert.equal(r.totalEur,1.75);assert.equal(r.matchedRule.pricePerKwh,0.25);assert.equal(r.timeZone,'Europe/Paris');
r=Pricing.evaluateOffer(residentFlex,{energyKwh:7,durationMinutes:30,startAt:'2026-08-29T20:45:00Z'});assert.equal(r.complete,false);assert.equal(r.reason,'tariff_window_crossing_requires_segmentation');assert.equal(r.boundaryMinutes,15);

const longSession={id:'belib-long',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.33}],longConnectionFee:{thresholdMinutes:840,eurPerHourAfterThreshold:10,basis:'connection_time'}}};
r=Pricing.evaluateOffer(longSession,{energyKwh:20,durationMinutes:900,startAt:'2026-08-29T08:00:00Z'});assert.equal(r.complete,false);assert.equal(r.longConnection.reason,'hourly_rounding_unspecified');

const etotem={id:'etotem-test',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.40}],postChargeFee:{graceMinutes:10,blockMinutes:15,blockEur:1,rounding:'started_block',trigger:'once_vehicle_is_charged'}}};
r=Pricing.evaluateOffer(etotem,{energyKwh:10,durationMinutes:30,postChargeMinutes:10,startAt:'2026-08-29T12:00:00Z'});assert.equal(r.totalEur,4);assert.equal(r.components.postCharge.costEur,0);
r=Pricing.evaluateOffer(etotem,{energyKwh:10,durationMinutes:30,postChargeMinutes:11,startAt:'2026-08-29T12:00:00Z'});assert.equal(r.components.postCharge.blocks,1);assert.equal(r.components.postCharge.costEur,1);assert.equal(r.totalEur,5);
r=Pricing.evaluateOffer(etotem,{energyKwh:10,durationMinutes:30,postChargeMinutes:26,startAt:'2026-08-29T12:00:00Z'});assert.equal(r.components.postCharge.blocks,2);assert.equal(r.components.postCharge.costEur,2);assert.equal(r.totalEur,6);

const freshmile={id:'freshmile-montauban',currency:'EUR',metadata:{timeZone:'Europe/Paris'},pricing:{type:'rules',rules:[{scope:'timeWindow',start:'06:00',end:'22:00',pricePerKwh:0.45,energyRounding:'started_kwh',connectedTimeFreeMinutes:180,connectedTimePerMinuteAfterFreeEur:0.045}]}};
r=Pricing.evaluateOffer(freshmile,{energyKwh:10.01,durationMinutes:180,startAt:'2026-08-29T10:00:00Z'});assert.equal(r.complete,true);assert.equal(r.components.energy,4.95);assert.equal(r.components.energyBilling.billedKwh,11);assert.equal(r.components.connectedTimeAfterFree.costEur,0);assert.equal(r.totalEur,4.95);
r=Pricing.evaluateOffer(freshmile,{energyKwh:10.01,durationMinutes:200,startAt:'2026-08-29T10:00:00Z'});assert.equal(r.components.connectedTimeAfterFree.billableMinutes,20);assert.equal(r.components.connectedTimeAfterFree.costEur,0.9);assert.equal(r.totalEur,5.85);
r=Pricing.evaluateOffer(freshmile,{energyKwh:2,durationMinutes:30,startAt:'2026-08-29T19:45:00Z'});assert.equal(r.complete,false);assert.equal(r.reason,'tariff_window_crossing_requires_segmentation');

const initialTier={id:'freshmile-time-tier',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',connectedTimeInitialMinutes:15,connectedTimeInitialFlatEur:6,connectedTimeAfterInitialPerMinuteEur:0.15}]}};
r=Pricing.evaluateOffer(initialTier,{durationMinutes:10,startAt:'2026-08-29T12:00:00Z'});assert.equal(r.totalEur,6);
r=Pricing.evaluateOffer(initialTier,{durationMinutes:20,startAt:'2026-08-29T12:00:00Z'});assert.equal(r.totalEur,6.75);

assert.equal(Pricing.minuteOfDay('2026-01-15T22:15:00Z','Europe/Paris'),23*60+15);assert.equal(Pricing.minuteOfDay('2026-08-29T21:15:00Z','Europe/Paris'),23*60+15);
console.log(JSON.stringify({ok:true,invariants:['started-15m-blocks','per-minute-pricing','station-local-timezone','dst-aware-timezone','overnight-window','window-crossing-fail-safe','unknown-hourly-rounding-fail-safe','post-charge-grace','post-charge-started-blocks','started-kwh','connected-time-free-allowance','initial-time-tier']},null,2));
