const assert=require('node:assert/strict');
const Charge=require('../assets/v9/charge-model-engine.js');
const Planner=require('../assets/v9/session-planner-engine.js');
const Session=require('../assets/v9/session-engine.js');

const offer={id:'timeline-offer',provider:'demo',kind:'direct',currency:'EUR',metadata:{timeZone:'UTC'},pricing:{type:'rules',rules:[
  {scope:'timeWindow',start:'21:00',end:'22:00',pricePerKwh:0.60},
  {scope:'timeWindow',start:'22:00',end:'23:00',pricePerKwh:0.20}
]}};
const station={id:'dc-timeline',countryCode:'FR',evses:[{connectors:[{kind:'CCS',powerKw:250}]}],offers:[offer]};

const manualSession={
  startAt:'2026-08-30T21:50:00Z',durationMinutes:20,chargingMinutes:20,energyKwh:20,
  consumptionKwhPer100Km:20,targetCurrency:'EUR',includeRouteEnergyInCharge:false,
  chargeTimeline:[
    {offsetMinutes:0,durationMinutes:10,energyKwh:15,startSoc:40,endSoc:55,powerKw:90},
    {offsetMinutes:10,durationMinutes:10,energyKwh:5,startSoc:55,endSoc:60,powerKw:30}
  ]
};
const evaluated=Session.evaluateStation(station,manualSession,{});
assert.equal(evaluated.best.result.complete,true);
assert.equal(evaluated.best.result.energyTimelineApplied,true);
assert.equal(evaluated.best.total,10); // 15*0.60 + 5*0.20
assert.notEqual(evaluated.best.total,8); // old uniform 10/10 kWh split
assert.equal(evaluated.best.result.components.energyTimeline.segments.length,2);

const modeled=Charge.estimate(station,{batteryCapacityKwh:80,arrivalSoc:40,targetSoc:80,vehicleMaxDcKw:250,chargeEfficiency:1,chargeCurve:[
  {soc:0,powerKw:200},{soc:60,powerKw:200},{soc:80,powerKw:50},{soc:100,powerKw:30}
],socStepPercent:2});
assert.ok(Array.isArray(modeled.timeline)&&modeled.timeline.length>1);
const timelineEnergy=modeled.timeline.reduce((s,x)=>s+x.energyKwh,0);
const timelineMinutes=modeled.timeline.reduce((s,x)=>s+x.durationMinutes,0);
assert.ok(Math.abs(timelineEnergy-modeled.energyKwh)<0.0001);
assert.ok(Math.abs(timelineMinutes-modeled.minutes)<0.0001);
assert.ok(modeled.timeline[0].powerKw>modeled.timeline.at(-1).powerKw);

const planned=Planner.planStation(station,{batteryCapacityKwh:80,startSoc:40,targetSoc:80,startAt:'2026-08-30T21:50:00Z',vehicleMaxDcKw:250,chargeEfficiency:1,chargeCurve:[
  {soc:0,powerKw:200},{soc:60,powerKw:200},{soc:80,powerKw:50},{soc:100,powerKw:30}
],socStepPercent:2,consumptionKwhPer100Km:20},{route:{}});
assert.ok(planned.effectiveSession.chargeTimeline.length>1);
assert.equal(planned.effectiveSession.chargeTimeline.length,planned.chargeModel.timeline.length);
assert.equal(planned.deliveredEnergyKwh,planned.chargeModel.energyKwh);

console.log(JSON.stringify({ok:true,module:'tcc-v9-energy-timeline-pricing',timelinePrice:evaluated.best.total,uniformPriceWouldBe:8,modeledSteps:modeled.timeline.length},null,2));
