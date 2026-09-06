const assert=require('assert');
const Self=require('../assets/v9/self-enrollment-engine.js');
(async()=>{
  const token='synthetic-high-entropy-token';
  const hash=await Self.digestToken(token);
  const now='2026-08-31T09:00:00Z';
  const base={enabled:true,requireReadiness:true,readinessApproved:true,tokenSha256:hash,tokenVersion:'v1',expiresAt:'2026-08-31T12:00:00Z',maxGrantMinutes:60};
  assert.equal((await Self.issue({token:'wrong',identity:'DEV-1',config:base,now})).reason,'invalid_token');
  assert.equal((await Self.issue({token,identity:'DEV-1',config:{...base,readinessApproved:false},now})).reason,'readiness_not_approved');
  const issued=await Self.issue({token,identity:'DEV-1',config:base,now});
  assert.equal(issued.ok,true);assert.equal(issued.grant.identity,'dev-1');assert.equal(issued.grant.expiresAt,'2026-08-31T10:00:00.000Z');
  assert.equal(Self.evaluate({grant:issued.grant,identity:'DEV-1',config:base,now:'2026-08-31T09:30:00Z'}).active,true);
  assert.equal(Self.evaluate({grant:issued.grant,identity:'DEV-2',config:base,now:'2026-08-31T09:30:00Z'}).reason,'identity_mismatch');
  assert.equal(Self.evaluate({grant:issued.grant,identity:'DEV-1',config:base,killSwitch:true,now:'2026-08-31T09:30:00Z'}).reason,'kill_switch');
  assert.equal(Self.evaluate({grant:issued.grant,identity:'DEV-1',config:base,now:'2026-08-31T10:01:00Z'}).reason,'grant_expired');
  assert.equal(Self.evaluate({grant:issued.grant,identity:'DEV-1',config:{...base,tokenVersion:'v2'},now:'2026-08-31T09:30:00Z'}).reason,'token_version_changed');
  const disabled=await Self.issue({token,identity:'DEV-1',config:{...base,enabled:false},now});assert.equal(disabled.reason,'self_enroll_disabled');
  console.log(JSON.stringify({ok:true,module:'tcc-v9-self-enrollment',checks:['invalid-token','readiness','issue','identity-binding','kill-switch','expiry','token-rotation','disabled-default']},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
