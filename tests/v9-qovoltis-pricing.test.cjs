'use strict';
const assert=require('node:assert/strict');
const pricing=require('../assets/v9/pricing-engine.js');

const low={
  id:'qovoltis-low',currency:'EUR',metadata:{timeZone:'Europe/Paris'},
  pricing:{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',pricePerKwh:0.35}],postChargeFee:{graceMinutes:30,blockMinutes:60,blockEur:4,rounding:'started_block',trigger:'once_vehicle_is_charged',exemptLocalWindows:[{start:'22:00',end:'07:00'}]}}
};
const high={
  id:'qovoltis-high',currency:'EUR',metadata:{timeZone:'Europe/Paris'},
  pricing:{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',pricePerKwh:0.50}],postChargeFee:{graceMinutes:60,blockMinutes:60,blockEur:4,rounding:'started_block',trigger:'once_vehicle_is_charged'}}
};

// Daytime <=50 kW: 30 min grace then any started hour costs 4 EUR.
let r=pricing.evaluateOffer(low,{energyKwh:10,durationMinutes:20,startAt:'2026-08-30T10:00:00+02:00',postChargeStartAt:'2026-08-30T10:20:00+02:00',postChargeMinutes:31});
assert.equal(r.complete,true);assert.equal(r.totalEur,7.5);assert.equal(r.components.postCharge.billableMinutes,1);assert.equal(r.components.postCharge.blocks,1);

// Night <=50 kW: after grace, 22:00-07:00 occupancy is exempt.
r=pricing.evaluateOffer(low,{energyKwh:10,durationMinutes:20,startAt:'2026-08-30T21:00:00+02:00',postChargeStartAt:'2026-08-30T21:20:00+02:00',postChargeMinutes:120});
assert.equal(r.complete,true);assert.equal(r.totalEur,3.5);assert.equal(r.components.postCharge.billableMinutes,10);assert.equal(r.components.postCharge.exemptMinutes,80);assert.equal(r.components.postCharge.blocks,1);

// Entire billable period in the night exemption: no post-charge fee.
r=pricing.evaluateOffer(low,{energyKwh:10,durationMinutes:20,startAt:'2026-08-30T22:00:00+02:00',postChargeStartAt:'2026-08-30T22:10:00+02:00',postChargeMinutes:90});
assert.equal(r.complete,true);assert.equal(r.totalEur,3.5);assert.equal(r.components.postCharge.billableMinutes,0);assert.equal(r.components.postCharge.exemptMinutes,60);

// Crossing 07:00 resumes billing after the exempt window.
r=pricing.evaluateOffer(low,{energyKwh:10,durationMinutes:20,startAt:'2026-08-31T05:00:00+02:00',postChargeStartAt:'2026-08-31T05:30:00+02:00',postChargeMinutes:150});
assert.equal(r.complete,true);assert.equal(r.totalEur,7.5);assert.equal(r.components.postCharge.billableMinutes,30);assert.equal(r.components.postCharge.exemptMinutes,90);assert.equal(r.components.postCharge.blocks,1);

// Fail closed when an exemption exists but post-charge start time is unavailable.
r=pricing.evaluateOffer(low,{energyKwh:10,durationMinutes:20,startAt:'2026-08-30T10:00:00+02:00',postChargeMinutes:90});
assert.equal(r.complete,false);assert.equal(r.reason,'post_charge_exemption_requires_start_time');

// >50 kW has no night exemption; 60 min grace and started-hour billing remain unchanged.
r=pricing.evaluateOffer(high,{energyKwh:10,durationMinutes:20,startAt:'2026-08-30T23:00:00+02:00',postChargeStartAt:'2026-08-30T23:20:00+02:00',postChargeMinutes:61});
assert.equal(r.complete,true);assert.equal(r.totalEur,9);assert.equal(r.components.postCharge.billableMinutes,1);assert.equal(r.components.postCharge.blocks,1);

console.log('v9 Qovoltis pricing tests passed');
