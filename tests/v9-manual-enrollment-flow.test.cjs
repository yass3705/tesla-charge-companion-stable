const assert=require('assert');
const Enrollment=require('../assets/v9/enrollment-engine.js');
const Whitelist=require('../assets/v9/whitelist-engine.js');
const Telemetry=require('../assets/v9/canary-telemetry.js');

class MemoryStorage{constructor(){this.m=new Map()}getItem(k){return this.m.has(k)?this.m.get(k):null}setItem(k,v){this.m.set(k,String(v))}removeItem(k){this.m.delete(k)}}

const identity='ABC-DEVICE-123';
const base={schemaVersion:1,enabled:true,requireReadiness:true,identities:[],candidatePath:'v9-app/',fallbackPath:'./'};

let decision=Whitelist.decide({identity,config:base,readiness:{verdict:'READY'}});
assert.equal(decision.engine,'v8');
assert.equal(decision.reason,'identity_not_whitelisted');

const bundle=Enrollment.enrollmentBundle(identity,{label:'test-device'});
assert.equal(bundle.identity,'abc-device-123');
assert.deepEqual(bundle.whitelistSnippet.identities,['abc-device-123']);

const patched=Enrollment.whitelistPatch(identity,base,{label:'test-device'});
assert.deepEqual(patched.identities,['abc-device-123']);
decision=Whitelist.decide({identity,config:patched,readiness:{verdict:'READY'}});
assert.equal(decision.engine,'v9');
assert.equal(decision.path,'v9-app/');

assert.equal(Whitelist.decide({identity,config:patched,readiness:{verdict:'BLOCKED'}}).engine,'v8');
assert.equal(Whitelist.decide({identity,config:patched,readiness:{verdict:'READY'},killSwitch:true}).reason,'kill_switch');

const storage=new MemoryStorage();
for(let i=0;i<10;i++)Telemetry.record('query',{ok:true,durationMs:1000,stationCount:5,routingErrorCount:0,sourceErrorCount:0},storage);
let metrics=Telemetry.summary(storage),assessment=Telemetry.rollbackAssessment(metrics);
assert.equal(metrics.runs,10);
assert.equal(assessment.decision,'HOLD');
assert.equal(assessment.rollback,false);
Telemetry.record('query',{ok:false,durationMs:1000,sourceErrorCount:1},storage);
metrics=Telemetry.summary(storage);assessment=Telemetry.rollbackAssessment(metrics);
assert.equal(assessment.decision,'ROLLBACK');
assert.equal(assessment.rollback,true);

console.log(JSON.stringify({ok:true,module:'tcc-v9-manual-enrollment-flow',checks:['blocked-before-whitelist','bundle','explicit-whitelist','readiness','kill-switch','telemetry-hold','telemetry-rollback']},null,2));
