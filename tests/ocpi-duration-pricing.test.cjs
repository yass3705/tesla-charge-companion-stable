const assert=require('node:assert/strict');
const api=require('../assets/ocpi-duration-pricing.js');

const helpers={
  ruleForMinute:(rules)=>rules[0]||null,
  minuteOfSession:(_start,offset)=>offset,
  fxToEur:(value)=>Number(value),
};

function close(actual,expected,label){
  assert.ok(Math.abs(actual-expected)<1e-8,`${label}: expected ${expected}, got ${actual}`);
}

function adjust({rule,charge,occupied,billed=0,baseTotal=0,baseCharge=0,baseIdle=0}){
  return api.adjust({
    total:baseTotal,
    connection:0,
    chargeCost:baseCharge,
    idleCost:baseIdle,
    durationSurcharge:0,
    occupiedMinutes:occupied,
    currencies:['EUR'],
  },{type:'rules',rules:[rule]},0,charge,billed,helpers);
}

// PARKING_TIME becomes payable once the total OCPI session reaches 30 minutes.
{
  const rule={currency:'EUR',pricePerKwh:0,chargePerMinute:0,idlePerMinute:0,
    ocpiDurationBands:[['PARKING_TIME',1800,null,0.08]]};
  const r=adjust({rule,charge:20,occupied:40});
  close(r.idleCost,0.8,'parking min_duration');
  close(r.total,0.8,'parking min_duration total');
}

// PARKING_TIME is payable only while total session duration is < 30 minutes.
{
  const rule={currency:'EUR',pricePerKwh:0,chargePerMinute:0,idlePerMinute:0.08,
    ocpiDurationBands:[['PARKING_TIME',1800,null,0]]};
  const r=adjust({rule,charge:10,occupied:40,baseTotal:2.4,baseIdle:2.4});
  close(r.idleCost,1.6,'parking max_duration');
  close(r.total,1.6,'parking max_duration total');
}

// TIME applies only to charging minutes after the session reaches 30 minutes.
{
  const rule={currency:'EUR',pricePerKwh:0,chargePerMinute:0,idlePerMinute:0,
    ocpiDurationBands:[['TIME',1800,null,0.02]]};
  const r=adjust({rule,charge:60,occupied:60});
  close(r.chargeCost,0.6,'time min_duration');
  close(r.total,0.6,'time min_duration total');
}

// ENERGY can also change with total session duration; billed energy follows the
// same minute allocation already used by TCC's base engine.
{
  const rule={currency:'EUR',pricePerKwh:0.30,chargePerMinute:0,idlePerMinute:0,
    ocpiDurationBands:[['ENERGY',1800,null,0.50]]};
  const r=adjust({rule,charge:60,occupied:60,billed:60,baseTotal:18,baseCharge:18});
  close(r.chargeCost,24,'energy min_duration');
  close(r.total,24,'energy min_duration total');
}

// Sub-minute session boundaries are integrated rather than rounded to a full minute.
{
  const rule={currency:'EUR',pricePerKwh:0,chargePerMinute:0,idlePerMinute:0,
    ocpiDurationBands:[['PARKING_TIME',1800,null,0.08]]};
  const r=adjust({rule,charge:20.5,occupied:40.25});
  close(r.idleCost,10.25*0.08,'fractional parking duration');
}

console.log('OCPI duration pricing tests: OK');
