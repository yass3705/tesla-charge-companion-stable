const assert=require('node:assert/strict');
const Parity=require('../assets/v9/parity-engine.js');
const V8=require('../assets/v9/v8-shadow-adapter.js');

const station={id:'legacy-a',name:'Station A',operator:'Example',latitude:48.8,longitude:2.1,powerKw:150};
const normalized=V8.normalizeLegacyRows([
  {station:{...station,id:'legacy-a::dc150',baseStationId:'legacy-a',configurationLabel:'DC 150'},baseStation:station,route:{durationMin:10},result:{total:10,allowed:20,deliveredBatt:30,deliveredBilled:31,reached:80,truncated:false,pricingDetails:{occupiedMinutes:25}}},
  {station:{...station,id:'legacy-a::ac22',baseStationId:'legacy-a',configurationLabel:'AC 22'},baseStation:station,route:{durationMin:10},result:{total:12,allowed:60,deliveredBatt:30,deliveredBilled:33,reached:80,truncated:false,pricingDetails:{occupiedMinutes:60}}}
],{consumptionKwhPer100Km:15});
assert.equal(normalized.stations.length,1);
assert.equal(normalized.sessionByStationId['legacy-a'].finalCost,10);
assert.equal(normalized.sessionByStationId['legacy-a'].totalTimeMinutes,35);
assert.equal(normalized.sessionByStationId['legacy-a'].costPerRecoveredKm,0.05);
assert.equal(normalized.sessionByStationId['legacy-a'].configurationId,'legacy-a::dc150');

function area({cost=10,soc=80,time=35,costKm=.05,energy=30,targetReached=true}={}){
  return{
    stations:[{id:'v9-a',aliases:['legacy-a'],name:'Station A',physicalOperator:{name:'Example'},latitude:48.8,longitude:2.1,evses:[{connectors:[{powerKw:150}]}]}],
    sessionPlans:{'v9-a':{actualTargetSoc:soc,targetReached,deliveredEnergyKwh:energy}},
    sessionEvaluations:{'v9-a':{best:{total:cost,costPerRecoveredKm:costKm},recoveredKm:200,billedEnergyKwh:31}},
    stationScores:{'v9-a':{finalCost:cost,totalTimeMinutes:time,costPerRecoveredKm:costKm,driveMinutes:10,chargingMinutes:20}}
  };
}

let report=Parity.compareAreas(normalized,area(),{compareOffers:false});
assert.equal(report.summary.sessionComparedCount,1);
assert.equal(report.summary.sessionErrorCount,0);
assert.equal(report.gates.pass,true);

report=Parity.compareAreas(normalized,area({cost:10.04,soc:80.8,time:36.5,costKm:.0508,energy:30.4}),{compareOffers:false});
assert.equal(report.summary.sessionErrorCount,0,'differences inside tolerance must not fail');
assert.equal(report.gates.pass,true);

report=Parity.compareAreas(normalized,area({cost:11}),{compareOffers:false});
assert(report.changed[0].sessionDifferences.some(d=>d.field==='finalCost'&&d.severity==='error'));
assert.equal(report.gates.pass,false);

report=Parity.compareAreas(normalized,area({soc:75,targetReached:false}),{compareOffers:false});
assert(report.changed[0].sessionDifferences.some(d=>d.field==='targetReached'&&d.severity==='error'));
assert(report.changed[0].sessionDifferences.some(d=>d.field==='reachedSoc'&&d.severity==='error'));
assert.equal(report.gates.sessionParity,false);

report=Parity.compareAreas(normalized,area({time:40}),{compareOffers:false});
assert(report.changed[0].sessionDifferences.some(d=>d.field==='totalTimeMinutes'&&d.severity==='warning'));
assert.equal(report.gates.pass,true,'moderate time drift is diagnostic only');

report=Parity.compareAreas(normalized,area({time:50}),{compareOffers:false});
assert(report.changed[0].sessionDifferences.some(d=>d.field==='totalTimeMinutes'&&d.severity==='error'));
assert.equal(report.gates.pass,false,'large time drift is critical');

const loss=Parity.compareAreas({...normalized,stations:[...normalized.stations,{id:'legacy-b',name:'Missing',operator:'Example'}]},area(),{compareOffers:false});
assert.equal(loss.gates.noV8Loss,false);
assert.equal(loss.gates.pass,false);

console.log(JSON.stringify({ok:true,module:'tcc-v9-shadow-session-parity',checks:['live-v8-normalization','cost','reached-soc','target-reached','total-time','cost-per-km','energy','v8-loss']},null,2));
