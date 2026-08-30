const assert=require('assert');
const p=require('../assets/v9/pricing-engine.js');

{
  const r=p.evaluateRule({scope:'allDay',pricePerKwh:0.59,sessionFeeEur:0.5},{energyKwh:10,durationMinutes:20});
  assert.equal(r.totalEur,6.4);
  assert.equal(r.components.energy,5.9);
  assert.equal(r.components.sessionFee,0.5);
}
{
  const r=p.evaluateRule({scope:'allDay',pricePerKwh:0.2,minimumSessionEur:1},{energyKwh:2,durationMinutes:10});
  assert.equal(r.totalEur,1);
  assert.equal(r.components.minimumSession.preMinimumTotalEur,0.4);
  assert.equal(r.components.minimumSession.topUpEur,0.6);
}
{
  const r=p.evaluateRule({scope:'allDay',pricePerKwh:0.4,connectedTimePerMinuteEur:0.02,sessionFeeEur:0.3,minimumSessionEur:1},{energyKwh:5,durationMinutes:30});
  assert.equal(r.totalEur,2.9);
}
{
  const offer={id:'bump-occupancy',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.4}],postChargeFee:{graceMinutes:180,eurPerMinute:0.12},minimumTotalEur:0.5}};
  const r=p.evaluateOffer(offer,{energyKwh:0.25,durationMinutes:10,postChargeMinutes:190});
  assert.equal(r.complete,true);
  assert.equal(r.components.energy,0.1);
  assert.equal(r.components.postCharge.costEur,1.2);
  assert.equal(r.totalEur,1.3);
  assert.equal(r.components.minimumTotal,undefined);
}
{
  const offer={id:'bump-minimum',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.4}],postChargeFee:{graceMinutes:180,eurPerMinute:0.12},minimumTotalEur:0.5}};
  const r=p.evaluateOffer(offer,{energyKwh:0.25,durationMinutes:10,postChargeMinutes:180});
  assert.equal(r.complete,true);
  assert.equal(r.totalEur,0.5);
  assert.equal(r.components.minimumTotal.preMinimumTotalEur,0.1);
  assert.equal(r.components.minimumTotal.topUpEur,0.4);
}
const conditionalOffer={id:'bump-energy-threshold',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.55}],conditionalSessionFees:[{amountEur:1.2,conditions:[{kind:'energy_above_kwh',value:0.5}]}],minimumTotalEur:0.5}};
{
  const r=p.evaluateOffer(conditionalOffer,{energyKwh:0.49,durationMinutes:10});
  assert.equal(r.complete,true);
  assert.equal(r.totalEur,0.5);
  assert.equal(r.components.conditionalSessionFees.costEur,0);
  assert.equal(r.components.conditionalSessionFees.fees[0].applied,false);
}
{
  const r=p.evaluateOffer(conditionalOffer,{energyKwh:0.5,durationMinutes:10});
  assert.equal(r.complete,true);
  assert.equal(r.totalEur,0.5);
  assert.equal(r.components.conditionalSessionFees.costEur,0);
  assert.equal(r.components.conditionalSessionFees.fees[0].conditions[0].matched,false);
}
{
  const r=p.evaluateOffer(conditionalOffer,{energyKwh:0.5001,durationMinutes:10});
  assert.equal(r.complete,true);
  assert.equal(r.totalEur,1.475055);
  assert.equal(r.components.conditionalSessionFees.costEur,1.2);
  assert.equal(r.components.conditionalSessionFees.fees[0].conditions[0].matched,true);
  assert.equal(r.components.minimumTotal,undefined);
}
{
  const invalid={id:'bump-unsupported-condition',currency:'EUR',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.55}],conditionalSessionFees:[{amountEur:1.2,conditions:[{kind:'session_duration_after_minutes',value:1}]}]}};
  const r=p.evaluateOffer(invalid,{energyKwh:10,durationMinutes:10});
  assert.equal(r.complete,false);
  assert.equal(r.reason,'unsupported_conditional_fee_condition');
  assert.equal(r.conditionKind,'session_duration_after_minutes');
}
console.log('v9 Bump pricing component regressions: ok');
