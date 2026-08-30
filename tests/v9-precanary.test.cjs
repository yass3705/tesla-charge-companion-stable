const assert=require('node:assert/strict');
const Identity=require('../assets/v9/canary-identity.js');
const Telemetry=require('../assets/v9/canary-telemetry.js');
class MemoryStorage{constructor(){this.m=new Map()}getItem(k){return this.m.has(k)?this.m.get(k):null}setItem(k,v){this.m.set(k,String(v))}removeItem(k){this.m.delete(k)}}
const s=new MemoryStorage();
const id1=Identity.get(s),id2=Identity.get(s);assert.equal(id1,id2,'identity must remain stable');assert.ok(id1.length>8);
for(let i=0;i<10;i++)Telemetry.record('query',{ok:true,durationMs:1000,stationCount:5},s);
let m=Telemetry.summary(s);assert.equal(m.runs,10);assert.equal(m.queryFailures,0);assert.equal(Telemetry.rollbackAssessment(m).decision,'HOLD');
Telemetry.clear(s);for(let i=0;i<9;i++)Telemetry.record('query',{ok:true,durationMs:1000},s);Telemetry.record('query',{ok:false,durationMs:1000,message:'boom'},s);m=Telemetry.summary(s);let a=Telemetry.rollbackAssessment(m,{maxErrorRate:.05});assert.equal(a.decision,'ROLLBACK');assert(a.reasons.includes('query_error_rate'));
Telemetry.clear(s);for(let i=0;i<10;i++)Telemetry.record('query',{ok:true,durationMs:15000},s);a=Telemetry.rollbackAssessment(Telemetry.summary(s));assert.equal(a.decision,'ROLLBACK');assert(a.reasons.includes('latency'));
console.log(JSON.stringify({ok:true,module:'tcc-v9-precanary',checks:['stable-identity','local-metrics','rollback-error-rate','rollback-latency']},null,2));
