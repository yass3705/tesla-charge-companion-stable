const assert=require('node:assert/strict');
const Score=require('../assets/v9/station-score-engine.js');

const station={id:'dc',evses:[{connectors:[{powerKw:250}]}]};
const evaluation={recoveredKm:200,best:{total:12}};
const session={batteryCapacityKwh:75,startSoc:50,targetSoc:80,energyKwh:22.5,vehicleMaxChargeKw:250,chargeEfficiency:1};

const withoutRoute=Score.scoreStation(station,evaluation,session,{route:{byStationId:{dc:{distanceKm:0,driveMinutes:0,approachEnergyKwh:0}}}});
const withRoute=Score.scoreStation(station,evaluation,session,{route:{byStationId:{dc:{distanceKm:10,driveMinutes:15,approachEnergyKwh:1.5}}}});
assert.equal(withoutRoute.chargeModel.startSoc,50);
assert.equal(withRoute.chargeModel.startSoc,48);
assert.equal(withRoute.chargeModel.targetSoc,80);
assert.ok(withRoute.chargingMinutes>withoutRoute.chargingMinutes,'route energy must lower arrival SOC and increase recharge time to the same target');
assert.equal(withRoute.route.energyToStationKwh,1.5);
assert.ok(withRoute.totalTimeMinutes>withoutRoute.totalTimeMinutes+15,'total time must include both route and extra charging time');

console.log(JSON.stringify({ok:true,module:'tcc-v9-charge-score-integration',withoutRouteMinutes:withoutRoute.chargingMinutes,withRouteMinutes:withRoute.chargingMinutes},null,2));
