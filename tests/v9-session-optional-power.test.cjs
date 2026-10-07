const assert = require('node:assert/strict');

for (const root of ['v9-production-runtime', 'v9-test']) {
  const session = require(`../${root}/assets/v9/session-engine.js`);
  const pricing = require(`../${root}/assets/v9/pricing-engine.js`);
  const rule=pricing.matchingRule({rules:[{scope:'allDay',pricePerKwh:0},{scope:'timeWindow',start:'07:00',end:'23:00',chargePerMinute:0.084}]},'2026-10-07T21:00:00Z');
  assert.equal(rule?.chargePerMinute,0.084,`${root}: applicable timed tariff must take priority over an all-day fallback`);
  const offer = {provider:'Electra',kind:'emsp',minPowerKw:null,maxPowerKw:null};
  assert.equal(session.offerMatchesChargingKind(offer,'AC',22),true,`${root}: null power bounds must not exclude Electra`);
  assert.equal(session.offerMatchesChargingKind({...offer,maxPowerKw:50},'DC',150),false,`${root}: explicit maximum still applies`);
  assert.equal(session.offerMatchesChargingKind({...offer,minPowerKw:50},'AC',22),false,`${root}: explicit minimum still applies`);
}
console.log('V9 optional offer power bounds OK');
