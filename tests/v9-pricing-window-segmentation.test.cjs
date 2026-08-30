const assert=require('node:assert/strict');
const Pricing=require('../assets/v9/pricing-engine.js');

const offer={
  id:'segmented-demo',currency:'EUR',pricing:{type:'rules',rules:[
    {scope:'timeWindow',start:'12:00',end:'13:00',pricePerKwh:0.30,connectedTimePerMinuteEur:0.01},
    {scope:'timeWindow',start:'13:00',end:'14:00',pricePerKwh:0.50,connectedTimePerMinuteEur:0.02}
  ],postChargeFee:{eurPerMinute:0.10,graceMinutes:0,exemptLocalWindows:[{start:'13:00',end:'14:00'}]}}
};

const session={
  startAt:'2026-08-30T12:50:00Z',timeZone:'UTC',durationMinutes:30,chargingMinutes:20,energyKwh:20,
  postChargeMinutes:10,postChargeStartAt:'2026-08-30T13:10:00Z'
};
const result=Pricing.evaluateOffer(offer,session);
assert.equal(result.complete,true);
assert.equal(result.segmented,true);
assert.equal(result.components.segmentedPricing.segments.length,2);
const [first,second]=result.components.segmentedPricing.segments;
assert.equal(first.durationMinutes,10);
assert.equal(first.chargingMinutes,10);
assert.equal(first.energyKwh,10);
assert.equal(first.totalEur,3.1);
assert.equal(second.durationMinutes,20);
assert.equal(second.chargingMinutes,10);
assert.equal(second.energyKwh,10);
assert.equal(second.totalEur,5.4);
assert.equal(result.components.postCharge.billableMinutes,0);
assert.equal(result.components.postCharge.exemptMinutes,10);
assert.equal(result.totalEur,8.5);

const post=Pricing.evaluateOffer(offer,{...session,durationMinutes:5,chargingMinutes:5,energyKwh:5,postChargeMinutes:20,postChargeStartAt:'2026-08-30T12:55:00Z'});
assert.equal(post.complete,true);
assert.equal(post.components.postCharge.billableMinutes,5);
assert.equal(post.components.postCharge.exemptMinutes,15);
assert.equal(post.components.postCharge.costEur,0.5);

const ambiguous={id:'ambiguous',currency:'EUR',pricing:{type:'rules',rules:[
  {scope:'timeWindow',start:'12:00',end:'13:00',pricePerKwh:0.30,energyRounding:'started_kwh'},
  {scope:'timeWindow',start:'13:00',end:'14:00',pricePerKwh:0.50,energyRounding:'started_kwh'}
]}};
const refused=Pricing.evaluateOffer(ambiguous,{startAt:'2026-08-30T12:50:00Z',timeZone:'UTC',durationMinutes:20,chargingMinutes:20,energyKwh:10});
assert.equal(refused.complete,false);
assert.equal(refused.reason,'tariff_window_crossing_unsupported_components');

console.log(JSON.stringify({ok:true,module:'tcc-v9-pricing-window-segmentation',segmentedTotal:result.totalEur,postChargeBoundaryCost:post.components.postCharge.costEur,failClosedReason:refused.reason},null,2));
