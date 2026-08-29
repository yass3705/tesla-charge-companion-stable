const assert=require('node:assert/strict');
const Score=require('../assets/v9/station-score-engine.js');

const stations=[
  {id:'near-slow',evses:[{connectors:[{powerKw:50}]}]},
  {id:'far-fast',evses:[{connectors:[{powerKw:250}]}]}
];
const evaluations={
  'near-slow':{recoveredKm:200,best:{total:8}},
  'far-fast':{recoveredKm:200,best:{total:10}}
};
const route={byStationId:{
  'near-slow':{distanceKm:3,driveMinutes:8},
  'far-fast':{distanceKm:12,driveMinutes:20}
}};
const session={energyKwh:30,consumptionKwhPer100Km:15,vehicleMaxChargeKw:250,chargeEfficiency:1,startAt:'2026-08-30T18:00:00Z',disconnectAt:'2026-08-30T19:00:00Z'};

const near=Score.scoreStation(stations[0],evaluations['near-slow'],session,{route});
assert.equal(near.chargingMinutes,36);
assert.equal(near.postChargeMinutes,24);
assert.equal(near.totalTimeMinutes,68);
assert.equal(near.finalCost,8);
assert.equal(near.costPerRecoveredKm,0.04);
assert.equal(near.distanceKm,3);
assert.equal(near.complete.pricing,true);
assert.equal(near.complete.route,true);

const far=Score.scoreStation(stations[1],evaluations['far-fast'],session,{route});
assert.equal(far.chargingMinutes,7.2);
assert.equal(far.postChargeMinutes,52.8);
assert.equal(far.totalTimeMinutes,80);

assert.deepEqual(Score.scoreArea(stations,evaluations,session,{route,sortBy:'finalCost'}).map(x=>x.station.id),['near-slow','far-fast']);
assert.deepEqual(Score.scoreArea(stations,evaluations,session,{route,sortBy:'distance'}).map(x=>x.station.id),['near-slow','far-fast']);
assert.deepEqual(Score.scoreArea(stations,evaluations,session,{route,sortBy:'totalTime'}).map(x=>x.station.id),['near-slow','far-fast']);
assert.deepEqual(Score.scoreArea(stations,evaluations,session,{route,sortBy:'costPerRecoveredKm'}).map(x=>x.station.id),['near-slow','far-fast']);

console.log(JSON.stringify({ok:true,module:'tcc-v9-station-score-engine',metrics:['finalCost','costPerRecoveredKm','distanceKm','driveMinutes','chargingMinutes','postChargeMinutes','totalTimeMinutes']},null,2));
