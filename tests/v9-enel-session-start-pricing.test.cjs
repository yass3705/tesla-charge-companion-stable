const assert=require('assert');
const SessionEngine=require('../assets/v9/session-engine.js');

function offer(prices){
  return {
    id:'enel-test',currency:'EUR',metadata:{timeZone:'Europe/Rome'},
    pricing:{
      type:'rules',priceSelectionBasis:'session_start_local_time',
      rules:[
        {scope:'timeWindow',start:'07:00',end:'21:00',pricePerKwh:prices.day},
        {scope:'timeWindow',start:'21:00',end:'07:00',pricePerKwh:prices.night},
      ]
    }
  };
}

// 20:50 Rome on Aug 31 2026. The 30-minute session crosses 21:00,
// but Enel fixes the tariff at session start, so the full 20 kWh use day price.
let r=SessionEngine.evaluateSessionStartLockedOffer(offer({day:0.67,night:0.58}),{
  startAt:'2026-08-31T18:50:00Z',durationMinutes:30,energyKwh:20
});
assert.equal(r.complete,true);
assert.equal(r.segmented,false);
assert.equal(r.priceSelectionBasis,'session_start_local_time');
assert.equal(r.totalEur,13.4);
assert.equal(r.matchedRule.pricePerKwh,0.67);

// 21:05 Rome: night tariff applies for the whole session.
r=SessionEngine.evaluateSessionStartLockedOffer(offer({day:0.67,night:0.58}),{
  startAt:'2026-08-31T19:05:00Z',durationMinutes:30,energyKwh:20
});
assert.equal(r.complete,true);
assert.equal(r.totalEur,11.6);
assert.equal(r.matchedRule.pricePerKwh,0.58);

// DC and HPC representative prices.
r=SessionEngine.evaluateSessionStartLockedOffer(offer({day:0.75,night:0.64}),{
  startAt:'2026-08-31T19:05:00Z',durationMinutes:20,energyKwh:20
});
assert.equal(r.totalEur,12.8);
r=SessionEngine.evaluateSessionStartLockedOffer(offer({day:0.82,night:0.82}),{
  startAt:'2026-08-31T18:50:00Z',durationMinutes:20,energyKwh:20
});
assert.equal(r.totalEur,16.4);

console.log('Enel session-start pricing tests passed');
