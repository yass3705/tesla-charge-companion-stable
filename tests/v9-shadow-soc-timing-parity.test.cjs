const assert=require('node:assert/strict');
const Parity=require('../assets/v9/parity-engine.js');

function compare(left,right,options={}){return Parity.compareSessionMetrics(left,right,{arrivalSocTolerancePoints:1,socTolerancePoints:1,chargingTimeToleranceMinutes:2,criticalChargingTimeToleranceMinutes:10,chargeCompleteToleranceMinutes:2,criticalChargeCompleteToleranceMinutes:10,...options});}

let diffs=compare({arrivalSoc:70,reachedSoc:80,targetReached:true,chargingMinutes:20,chargeCompleteAt:'2026-08-30T18:30:00Z'},{arrivalSoc:69.5,reachedSoc:80.5,targetReached:true,chargingMinutes:21.5,chargeCompleteAt:'2026-08-30T18:31:00Z'});
assert.equal(diffs.length,0,'small SOC/time drifts should remain inside tolerance');

diffs=compare({arrivalSoc:70,reachedSoc:80,targetReached:true,chargingMinutes:20,chargeCompleteAt:'2026-08-30T18:30:00Z'},{arrivalSoc:67,reachedSoc:80,targetReached:true,chargingMinutes:20,chargeCompleteAt:'2026-08-30T18:30:00Z'});
assert(diffs.some(d=>d.field==='arrivalSoc'&&d.severity==='warning'));
assert(!diffs.some(d=>d.field==='arrivalSoc'&&d.severity==='error'));

diffs=compare({reachedSoc:80,targetReached:true,chargingMinutes:20,chargeCompleteAt:'2026-08-30T18:30:00Z'},{reachedSoc:80,targetReached:true,chargingMinutes:25,chargeCompleteAt:'2026-08-30T18:35:00Z'});
assert(diffs.some(d=>d.field==='chargingMinutes'&&d.severity==='warning'));
assert(diffs.some(d=>d.field==='chargeCompleteAt'&&d.severity==='warning'));

diffs=compare({reachedSoc:80,targetReached:true,chargingMinutes:20,chargeCompleteAt:'2026-08-30T18:30:00Z'},{reachedSoc:80,targetReached:true,chargingMinutes:35,chargeCompleteAt:'2026-08-30T18:45:00Z'});
assert(diffs.some(d=>d.field==='chargingMinutes'&&d.severity==='error'));
assert(diffs.some(d=>d.field==='chargeCompleteAt'&&d.severity==='error'));

diffs=compare({reachedSoc:80,targetReached:true,chargingMinutes:20},{reachedSoc:75,targetReached:false,chargingMinutes:20});
assert(diffs.some(d=>d.field==='targetReached'&&d.severity==='error'));
assert(diffs.some(d=>d.field==='reachedSoc'&&d.severity==='error'));

console.log(JSON.stringify({ok:true,module:'tcc-v9-shadow-soc-timing-parity',checks:['arrival-soc-warning','reached-soc-blocker','target-reached-blocker','charging-time-warning-and-blocker','charge-complete-warning-and-blocker']},null,2));
