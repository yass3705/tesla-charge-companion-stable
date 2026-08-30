const assert=require('assert');
const p=require('../assets/v9/pricing-engine.js');

{
  const r=p.evaluateRule({scope:'allDay',pricePerKwh:0.59,sessionFeeEur:0.5},{energyKwh:10,durationMinutes:20});
  assert.equal(r.totalEur,6.4);assert.equal(r.components.energy,5.9);assert.equal(r.components.sessionFee,0.5);
}
{
  const r=p.evaluateRule({scope:'allDay',pricePerKwh:0.2,minimumSessionEur:1},{energyKwh:2,durationMinutes:10});
  assert.equal(r.totalEur,1);assert.equal(r.components.minimumSession.preMinimumTotalEur,0.4);assert.equal(r.components.minimumSession.topUpEur,0.6);
}
{
  const r=p.evaluateRule({scope:'allDay',pricePerKwh:0.4,connectedTimePerMinuteEur:0.02,sessionFeeEur:0.3,minimumSessionEur:1},{energyKwh:5,durationMinutes:30});assert.equal(r.totalEur,2.9);
}
{
  const offer={id:'bump-occupancy',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.4}],postChargeFee:{graceMinutes:180,eurPerMinute:0.12},minimumTotalEur:0.5}};
  const r=p.evaluateOffer(offer,{energyKwh:0.25,durationMinutes:10,postChargeMinutes:190});assert.equal(r.complete,true);assert.equal(r.components.energy,0.1);assert.equal(r.components.postCharge.costEur,1.2);assert.equal(r.totalEur,1.3);
}
{
  const offer={id:'bump-minimum',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.4}],postChargeFee:{graceMinutes:180,eurPerMinute:0.12},minimumTotalEur:0.5}};
  const r=p.evaluateOffer(offer,{energyKwh:0.25,durationMinutes:10,postChargeMinutes:180});assert.equal(r.complete,true);assert.equal(r.totalEur,0.5);assert.equal(r.components.minimumTotal.preMinimumTotalEur,0.1);
}
const conditionalOffer={id:'bump-energy-threshold',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.55}],conditionalSessionFees:[{amountEur:1.2,conditions:[{kind:'energy_above_kwh',value:0.5}]}],minimumTotalEur:0.5}};
{
  const r=p.evaluateOffer(conditionalOffer,{energyKwh:0.5,durationMinutes:10});assert.equal(r.complete,true);assert.equal(r.totalEur,0.5);assert.equal(r.components.conditionalSessionFees.fees[0].applied,false);
}
{
  const r=p.evaluateOffer(conditionalOffer,{energyKwh:0.5001,durationMinutes:10});assert.equal(r.complete,true);assert.equal(r.totalEur,1.475055);assert.equal(r.components.conditionalSessionFees.fees[0].applied,true);
}
const combinedOffer={id:'bump-energy-duration-threshold',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.45}],conditionalSessionFees:[{amountEur:1,conditions:[{kind:'energy_above_kwh',value:1},{kind:'session_duration_after_minutes',value:1}]}],minimumTotalEur:0.5}};
{
  const r=p.evaluateOffer(combinedOffer,{energyKwh:1,durationMinutes:2});assert.equal(r.complete,true);assert.equal(r.totalEur,0.5);assert.equal(r.components.conditionalSessionFees.fees[0].applied,false);
}
{
  const r=p.evaluateOffer(combinedOffer,{energyKwh:1.1,durationMinutes:1});assert.equal(r.complete,true);assert.equal(r.totalEur,0.5);assert.equal(r.components.conditionalSessionFees.fees[0].applied,false);
}
{
  const r=p.evaluateOffer(combinedOffer,{energyKwh:1.1,durationMinutes:1.0001});assert.equal(r.complete,true);assert.equal(r.totalEur,1.495);assert.equal(r.components.conditionalSessionFees.fees[0].applied,true);assert.equal(r.components.conditionalSessionFees.fees[0].conditions[0].matched,true);assert.equal(r.components.conditionalSessionFees.fees[0].conditions[1].matched,true);
}
{
  const invalid={id:'bump-unsupported-condition',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.55}],conditionalSessionFees:[{amountEur:1.2,conditions:[{kind:'unknown_condition',value:1}]}]}};
  const r=p.evaluateOffer(invalid,{energyKwh:10,durationMinutes:10});assert.equal(r.complete,false);assert.equal(r.reason,'unsupported_conditional_fee_condition');assert.equal(r.conditionKind,'unknown_condition');
}
const energyBands={id:'bump-energy-bands',currency:'EUR',metadata:{timeZone:'Europe/Paris'},pricing:{type:'rules',rules:[{start:'10:00',end:'17:00',pricePerKwh:0.25},{start:'17:00',end:'10:00',pricePerKwh:0.395}],minimumTotalEur:0.5,requiresSegmentationOnTariffBoundary:true}};
{
  const r=p.evaluateOffer(energyBands,{energyKwh:10,durationMinutes:30,startAt:'2026-08-30T12:00:00+02:00'});assert.equal(r.complete,true);assert.equal(r.totalEur,2.5);assert.equal(r.matchedRule.pricePerKwh,0.25);
}
{
  const r=p.evaluateOffer(energyBands,{energyKwh:10,durationMinutes:30,startAt:'2026-08-30T18:00:00+02:00'});assert.equal(r.complete,true);assert.equal(r.totalEur,3.95);assert.equal(r.matchedRule.pricePerKwh,0.395);
}
{
  const r=p.evaluateOffer(energyBands,{energyKwh:10,durationMinutes:30,startAt:'2026-08-30T16:45:00+02:00'});assert.equal(r.complete,false);assert.equal(r.reason,'tariff_window_crossing_requires_segmentation');assert.equal(r.boundaryMinutes,15);
}
const occupancyBands={id:'bump-occupancy-bands',currency:'EUR',metadata:{timeZone:'Europe/Paris'},pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.45}],postChargeFee:{graceMinutes:15,eurPerMinute:0.2,exemptLocalWindows:[{start:'23:00',end:'09:00'}]},minimumTotalEur:0.5}};
{
  const r=p.evaluateOffer(occupancyBands,{energyKwh:1,durationMinutes:10,postChargeMinutes:30,postChargeStartAt:'2026-08-30T10:00:00+02:00'});assert.equal(r.complete,true);assert.equal(r.components.postCharge.billableMinutes,15);assert.equal(r.components.postCharge.costEur,3);assert.equal(r.totalEur,3.45);
}
{
  const r=p.evaluateOffer(occupancyBands,{energyKwh:1,durationMinutes:10,postChargeMinutes:120,postChargeStartAt:'2026-08-30T22:30:00+02:00'});assert.equal(r.complete,true);assert.equal(r.components.postCharge.billableMinutes,15);assert.equal(r.components.postCharge.exemptMinutes,90);assert.equal(r.components.postCharge.costEur,3);assert.equal(r.totalEur,3.45);
}
console.log('v9 Bump pricing component regressions: ok');
