const assert=require('node:assert/strict');
const W=require('../assets/v9/whitelist-engine.js');

const base={enabled:true,requireReadiness:true,identities:['device-a'],candidatePath:'v9-app/',fallbackPath:'./'};
let d=W.decide({identity:'device-b',config:base,readiness:{verdict:'READY'}});
assert.equal(d.engine,'v8');assert.equal(d.reason,'identity_not_whitelisted');

d=W.decide({identity:'device-a',config:base,readiness:null});
assert.equal(d.engine,'v8');assert.equal(d.reason,'readiness_missing');

d=W.decide({identity:'device-a',config:base,readiness:{verdict:'BLOCKED'}});
assert.equal(d.engine,'v8');assert.equal(d.reason,'readiness_blocked');

d=W.decide({identity:'device-a',config:base,readiness:{verdict:'READY'}});
assert.equal(d.engine,'v9');assert.equal(d.path,'v9-app/');assert.equal(d.reason,'whitelist_allowed');

d=W.decide({identity:'device-a',config:base,readiness:{verdict:'READY'},killSwitch:true});
assert.equal(d.engine,'v8');assert.equal(d.reason,'kill_switch');

d=W.decide({identity:'device-a',config:{...base,enabled:false},readiness:{verdict:'READY'}});
assert.equal(d.engine,'v8');assert.equal(d.reason,'whitelist_disabled');

assert.equal(W.isAllowed('DEVICE-A',base),true,'identity matching must be normalized');
console.log(JSON.stringify({ok:true,module:'tcc-v9-whitelist-engine',checks:['disabled-by-default','explicit-identity','readiness-required','kill-switch','candidate-path']},null,2));
