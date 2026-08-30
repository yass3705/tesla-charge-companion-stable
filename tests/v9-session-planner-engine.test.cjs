const assert=require('node:assert/strict');
const Planner=require('../assets/v9/session-planner-engine.js');
const Session=require('../assets/v9/session-engine.js');

const station={id:'dc-100',countryCode:'FR',evses:[{connectors:[{kind:'CCS',powerKw:100}]}],offers:[{id:'direct',provider:'demo',kind:'direct',currency:'EUR',pricing:{pricePerKwh:0.5,postChargeFee:{eurPerMinute:0.1,graceMinutes:0}}}]};
const route={byStationId:{'dc-100':{driveMinutes:10,approachEnergyKwh:10,distanceKm:50}}};
const base={batteryCapacityKwh:100,consumptionKwhPer100Km:20,startSoc:50,targetSoc:80,startAt:'2026-08-30T12:00:00Z',chargeEfficiency:1,vehicleMaxDcKw:100,vehicleMaxChargeKw:100,disableSocCurve:true,targetCurrency:'EUR'};

const short=Planner.planStation(station,{...base,disconnectAt:'2026-08-30T12:30:00Z'},{route});
assert.equal(short.arrivalSoc,40);
assert.equal(short.requestedTargetSoc,80);
assert.equal(short.targetReached,false);
assert.equal(short.chargeStartAt,'2026-08-30T12:10:00.000Z');
assert.equal(short.chargingMinutes,20);
assert.equal(short.postChargeMinutes,0);
assert.ok(Math.abs(short.actualTargetSoc-73.333333)<0.00001);
assert.ok(Math.abs(short.deliveredEnergyKwh-33.333333)<0.00001);
const shortEval=Session.evaluateStation(station,short.effectiveSession,{});
assert.ok(Math.abs(shortEval.best.total-16.666667)<0.00001);
assert.ok(Math.abs(shortEval.recoveredKm-166.666665)<0.001);

const long=Planner.planStation(station,{...base,disconnectAt:'2026-08-30T13:00:00Z'},{route});
assert.equal(long.targetReached,true);
assert.equal(long.arrivalSoc,40);
assert.equal(long.actualTargetSoc,80);
assert.equal(long.deliveredEnergyKwh,40);
assert.equal(long.chargingMinutes,24);
assert.equal(long.postChargeMinutes,26);
assert.equal(long.connectedMinutes,50);
assert.equal(long.postChargeStartAt,'2026-08-30T12:34:00.000Z');
const longEval=Session.evaluateStation(station,long.effectiveSession,{});
assert.equal(longEval.best.total,22.6); // 40 kWh * 0.50 + 26 min * 0.10
assert.equal(longEval.best.result.components.postCharge.billableMinutes,26);

const noDeadline=Planner.planStation(station,{...base},{route});
assert.equal(noDeadline.targetReached,true);
assert.equal(noDeadline.deliveredEnergyKwh,40);
assert.equal(noDeadline.postChargeMinutes,0);

console.log(JSON.stringify({ok:true,module:'tcc-v9-session-planner',cases:['deadline-before-target','post-charge-after-target','no-deadline']},null,2));