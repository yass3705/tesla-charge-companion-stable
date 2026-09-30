'use strict';
const assert=require('node:assert/strict');
const Pricing=require('../v9-test/assets/v9/pricing-engine.js');

function close(actual,expected,label){
  assert.ok(Math.abs(Number(actual)-Number(expected))<1e-6,`${label}: expected ${expected}, got ${actual}`);
}

{
  const rule={pricePerKwh:0.30,ocpiDurationBands:[['ENERGY',1800,null,0.50]]};
  const r=Pricing.evaluateRule(rule,{energyKwh:60,durationMinutes:60,chargingMinutes:60});
  close(r.totalEur,24,'ENERGY after 30 min');
}
{
  const rule={chargePerMinute:0,ocpiDurationBands:[['TIME',1800,null,0.02]]};
  const r=Pricing.evaluateRule(rule,{durationMinutes:60,chargingMinutes:60});
  close(r.totalEur,0.6,'TIME after 30 min');
}
{
  const rule={idlePerMinute:0,ocpiDurationBands:[['PARKING_TIME',1800,null,0.08]]};
  const r=Pricing.evaluateRule(rule,{durationMinutes:40,chargingMinutes:20});
  close(r.totalEur,0.8,'PARKING_TIME after total session 30 min');
}
{
  const rule={connectionFee:0,ocpiDurationBands:[['FLAT',3600,7200,1.25]]};
  close(Pricing.evaluateRule(rule,{durationMinutes:30,chargingMinutes:30}).totalEur,0,'FLAT before band');
  close(Pricing.evaluateRule(rule,{durationMinutes:90,chargingMinutes:90}).totalEur,1.25,'FLAT in band');
  close(Pricing.evaluateRule(rule,{durationMinutes:130,chargingMinutes:130}).totalEur,0,'FLAT after band');
}
{
  const rule={
    pricePerKwh:0,chargePerMinute:0,connectionFee:0,
    ocpiDurationBands:[
      ['ENERGY',3600,7200,0.55],
      ['TIME',3600,7200,0.20],
      ['FLAT',3600,7200,1.00]
    ]
  };
  const r=Pricing.evaluateRule(rule,{energyKwh:20,durationMinutes:90,chargingMinutes:90});
  // Uniform energy allocation: 20/90 kWh/min, 30 minutes inside the band = 6.666... kWh.
  close(r.components.energy,20*(30/90)*0.55,'bounded ENERGY');
  close(r.components.chargingTime,30*0.20,'bounded TIME');
  close(r.components.connectionFee,1,'bounded FLAT');
  close(r.totalEur,20*(30/90)*0.55+30*0.20+1,'bounded combined total');
}

{
  const pricing={type:'rules',rules:[
    {scope:'timeWindow',start:'00:00',end:'00:45',chargePerMinute:0,ocpiDurationBands:[['TIME',1800,null,0.02]]},
    {scope:'timeWindow',start:'00:45',end:'24:00',chargePerMinute:0,ocpiDurationBands:[['TIME',1800,null,0.02]]}
  ]};
  const r=Pricing.evaluateSegmentedRules(pricing,{
    startAt:'2026-10-01T00:00:00Z',durationMinutes:60,chargingMinutes:60,energyKwh:0
  },'UTC');
  assert.equal(r.complete,true);
  close(r.totalEur,0.6,'duration bands keep global elapsed time across tariff windows');
}

console.log(JSON.stringify({ok:true,module:'v9-test-ocpi-duration-pricing'},null,2));
