const assert=require('node:assert/strict');
const Parity=require('../assets/v9/parity-engine.js');

const v8={
  stations:[{id:'legacy-a',name:'Station A',operator:'Example'}],
  sessionByStationId:{'legacy-a':{finalCost:10,arrivalSoc:20,reachedSoc:80,targetReached:true,totalTimeMinutes:35,chargingMinutes:20,chargeCompleteAt:'2026-08-30T12:30:00.000Z',costPerRecoveredKm:.05,deliveredEnergyKwh:30}}
};
function area(overrides={}){
  const score={finalCost:10,arrivalSoc:20,endSoc:80,targetReached:true,totalTimeMinutes:35,chargingMinutes:20,chargeCompleteAt:'2026-08-30T12:30:00.000Z',costPerRecoveredKm:.05,deliveredEnergyKwh:30,...overrides};
  return{stations:[{id:'v9-a',aliases:['legacy-a'],name:'Station A',physicalOperator:{name:'Example'}}],sessionPlans:{'v9-a':{arrivalSoc:score.arrivalSoc,actualTargetSoc:score.endSoc,targetReached:score.targetReached,deliveredEnergyKwh:score.deliveredEnergyKwh,postChargeStartAt:score.chargeCompleteAt}},sessionEvaluations:{'v9-a':{best:{total:score.finalCost,costPerRecoveredKm:score.costPerRecoveredKm},recoveredKm:200,billedEnergyKwh:30}},stationScores:{'v9-a':score}};
}
let r=Parity.compareAreas(v8,area(),{compareOffers:false});
assert.equal(r.gates.pass,true);
r=Parity.compareAreas(v8,area({arrivalSoc:17}),{compareOffers:false});
assert(r.changed[0].sessionDifferences.some(d=>d.field==='arrivalSoc'&&d.severity==='warning'));
assert.equal(r.gates.pass,true);
r=Parity.compareAreas(v8,area({chargingMinutes:25,chargeCompleteAt:'2026-08-30T12:35:00.000Z'}),{compareOffers:false});
assert(r.changed[0].sessionDifferences.some(d=>d.field==='chargingMinutes'&&d.severity==='warning'));
assert(r.changed[0].sessionDifferences.some(d=>d.field==='chargeCompleteAt'&&d.severity==='warning'));
assert.equal(r.gates.pass,true);
r=Parity.compareAreas(v8,area({chargingMinutes:35,chargeCompleteAt:'2026-08-30T12:45:00.000Z'}),{compareOffers:false});
assert(r.changed[0].sessionDifferences.some(d=>d.field==='chargingMinutes'&&d.severity==='error'));
assert(r.changed[0].sessionDifferences.some(d=>d.field==='chargeCompleteAt'&&d.severity==='error'));
assert.equal(r.gates.pass,false);
console.log(JSON.stringify({ok:true,module:'tcc-v9-shadow-session-timing-parity'},null,2));
