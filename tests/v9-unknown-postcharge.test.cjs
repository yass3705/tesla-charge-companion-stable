'use strict';
const assert=require('node:assert/strict');
const Session=require('../assets/v9/session-engine.js');

const station={
  id:'IT:duferco:test',
  countryCode:'IT',
  offers:[{
    id:'duferco-test',provider:'Duferco Mobility',kind:'direct',offerKind:'direct',currency:'EUR',priority:130,
    pricing:{type:'rules',holidayCalendar:'IT',postChargeFeeUnknown:true,rules:[{scope:'allDay',pricePerKwh:0.52}]},
    metadata:{timeZone:'Europe/Rome'}
  }]
};

let r=Session.evaluateStation(station,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-30T12:00:00Z',postChargeMinutes:0});
assert.equal(r.comparableOfferCount,1);
assert.equal(r.best.total,10.4);

r=Session.evaluateStation(station,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-30T12:00:00Z',postChargeMinutes:1});
assert.equal(r.comparableOfferCount,0);
assert.equal(r.best,null);
assert.equal(r.incomplete.length,1);
assert.equal(r.incomplete[0].result.reason,'post_charge_fee_unknown_for_station');

console.log(JSON.stringify({ok:true,noPostChargeComparable:true,postChargeFailsClosed:true},null,2));
