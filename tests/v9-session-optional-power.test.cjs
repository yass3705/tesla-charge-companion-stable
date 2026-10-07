const assert = require('node:assert/strict');

for (const root of ['v9-production-runtime', 'v9-test']) {
  const session = require(`../${root}/assets/v9/session-engine.js`);
  const offer = {provider:'Electra',kind:'emsp',minPowerKw:null,maxPowerKw:null};
  assert.equal(session.offerMatchesChargingKind(offer,'AC',22),true,`${root}: null power bounds must not exclude Electra`);
  assert.equal(session.offerMatchesChargingKind({...offer,maxPowerKw:50},'DC',150),false,`${root}: explicit maximum still applies`);
  assert.equal(session.offerMatchesChargingKind({...offer,minPowerKw:50},'AC',22),false,`${root}: explicit minimum still applies`);
}
console.log('V9 optional offer power bounds OK');
