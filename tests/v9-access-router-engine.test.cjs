const assert=require('assert');
const Access=require('../assets/v9/access-router-engine.js');
const Self=require('../assets/v9/self-enrollment-engine.js');
const White=require('../assets/v9/whitelist-engine.js');
const Roll=require('../assets/v9/rollout-engine.js');

const engines={selfEnrollment:Self,whitelist:White,rollout:Roll};
const identity='device-abc';
const rollout={stage:'preview',canaryPercent:0,killSwitch:false,requireReadiness:true,salt:'test',v8Path:'./',previewPath:'v9-preview/',productionPath:'v9-app/'};
const whitelist={enabled:false,requireReadiness:true,identities:[],candidatePath:'v9-app/',fallbackPath:'./'};
const selfConfig={enabled:true,requireReadiness:true,readinessApproved:true,tokenVersion:'v1',expiresAt:'2030-01-01T00:00:00.000Z',maxGrantMinutes:60};
const grant={schemaVersion:1,type:'tcc-v9-self-enroll-grant',identity,issuedAt:'2026-08-31T09:00:00.000Z',expiresAt:'2026-08-31T10:00:00.000Z',tokenVersion:'v1'};
const now=new Date('2026-08-31T09:30:00.000Z');

let d=Access.route({identity,grant,selfConfig,whitelistConfig:whitelist,rolloutConfig:rollout,readiness:{verdict:'READY'},now,engines});
assert.equal(d.engine,'v9');assert.equal(d.source,'self_enroll');assert.equal(d.path,'v9-app/');

d=Access.route({identity,grant,selfConfig,whitelistConfig:whitelist,rolloutConfig:rollout,readiness:{verdict:'BLOCKED'},now,engines});
assert.equal(d.engine,'v8');assert.equal(d.reason,'readiness_blocked');

d=Access.route({identity,grant:selfConfig?{...grant,expiresAt:'2026-08-31T09:00:00.000Z'}:null,selfConfig,whitelistConfig:whitelist,rolloutConfig:rollout,readiness:{verdict:'READY'},now,engines});
assert.equal(d.engine,'v8');

d=Access.route({identity,grant,selfConfig,whitelistConfig:{...whitelist,enabled:true,identities:[identity]},rolloutConfig:rollout,readiness:{verdict:'READY'},now:new Date('2026-08-31T11:00:00.000Z'),engines});
assert.equal(d.engine,'v9');assert.equal(d.source,'whitelist');

d=Access.route({identity,grant,selfConfig,whitelistConfig:whitelist,rolloutConfig:{...rollout,stage:'canary',canaryPercent:100},readiness:{verdict:'READY'},now:new Date('2026-08-31T11:00:00.000Z'),engines});
assert.equal(d.engine,'v9');assert.equal(d.source,'rollout');

d=Access.route({identity,grant,selfConfig,whitelistConfig:{...whitelist,enabled:true,identities:[identity]},rolloutConfig:{...rollout,stage:'canary',canaryPercent:100,killSwitch:true},readiness:{verdict:'READY'},now,engines});
assert.equal(d.engine,'v8');assert.equal(d.reason,'kill_switch');

d=Access.route({identity,grant:null,selfConfig:{...selfConfig,enabled:false},whitelistConfig:whitelist,rolloutConfig:rollout,readiness:{verdict:'READY'},now,engines});
assert.equal(d.engine,'v8');assert.equal(d.path,'./');

console.log(JSON.stringify({ok:true,module:'tcc-v9-access-router',checks:['self-enroll-v9','readiness-fallback','expired-fallback','whitelist-v9','canary-v9','kill-switch','zero-percent-control']},null,2));