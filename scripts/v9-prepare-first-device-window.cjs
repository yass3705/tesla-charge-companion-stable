const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
function read(rel){return JSON.parse(fs.readFileSync(path.join(process.cwd(),rel),'utf8'));}
function clone(v){return JSON.parse(JSON.stringify(v));}
function iso(d){return new Date(d).toISOString();}
const minutes=Math.max(1,Math.min(60,Number(process.argv[2]||30)));
const rollout=read('data/v9/rollout-config.json');
const self=read('data/v9/self-enrollment-config.json');
const access=read('data/v9/access-readiness.json');
const policy=read('data/v9/device-test-policy.json');
const closed=rollout.stage==='preview'&&Number(rollout.canaryPercent)===0&&rollout.killSwitch!==true&&self.enabled===false&&!String(self.tokenSha256||'').trim()&&self.readinessApproved===false&&access.verdict==='BLOCKED'&&access.ready===false&&policy.enabled===false;
if(!closed){console.error('BLOCKED: repository is not in the required closed pre-test state');process.exit(1);}
const token=crypto.randomBytes(32).toString('base64url');
const hash=crypto.createHash('sha256').update(token).digest('hex');
const now=new Date();const expires=new Date(now.getTime()+minutes*60000);const version=`device-test-${now.toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`;const closedVersion=`${version}-closed`;
const openSelf={...clone(self),enabled:true,requireReadiness:true,readinessApproved:true,tokenSha256:hash,tokenVersion:version,expiresAt:iso(expires),maxGrantMinutes:minutes,notes:'Temporary first-device test window. Clear token is never stored in the repository.'};
const openAccess={schemaVersion:1,verdict:'READY',ready:true,updatedAt:iso(now),reason:`Temporary first-device test window until ${iso(expires)}. Random canary remains 0%.`};
const openPolicy={...clone(policy),enabled:true,maxWindowMinutes:minutes};
const closeSelf={...clone(self),enabled:false,readinessApproved:false,tokenSha256:'',tokenVersion:closedVersion,expiresAt:null,maxGrantMinutes:Math.min(Number(self.maxGrantMinutes)||60,60),notes:'Closed after first-device test. No active token hash is retained and token version is rotated.'};
const closeAccess={schemaVersion:1,verdict:'BLOCKED',ready:false,updatedAt:iso(expires),reason:'First-device test window closed. V8 fallback restored.'};
const closePolicy={...clone(policy),enabled:false};
const output={schemaVersion:1,type:'tcc-v9-first-device-window-plan',createdAt:iso(now),expiresAt:iso(expires),minutes,tokenVersion:version,clearToken:token,open:{'data/v9/self-enrollment-config.json':openSelf,'data/v9/access-readiness.json':openAccess,'data/v9/device-test-policy.json':openPolicy},close:{'data/v9/self-enrollment-config.json':closeSelf,'data/v9/access-readiness.json':closeAccess,'data/v9/device-test-policy.json':closePolicy}};
const serializedOperational=JSON.stringify({open:output.open,close:output.close});
if(serializedOperational.includes(token)){console.error('BLOCKED: clear token leaked into OPEN/CLOSE plan');process.exit(1);}
console.log(JSON.stringify(output,null,2));
console.error('\nSECURITY: clearToken above is for the test device only. Do not commit it or paste it into GitHub. Commit only the OPEN JSON objects, then always apply CLOSE after PASS or ROLLBACK.');
