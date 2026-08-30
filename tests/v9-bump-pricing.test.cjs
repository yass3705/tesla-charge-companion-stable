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
console.log('v9 Bump pricing component regressions: ok');
