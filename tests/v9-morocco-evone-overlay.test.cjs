const assert=require('node:assert/strict');
const A=require('../assets/v9/adapters/morocco-evone-overlay.js');

for(const s of ['Available','Occupied','Charging'])assert.equal(A.productionEligibleStatus(s),true,s);
for(const s of ['Faulted','Offline','Unknown','Unavailable','Other',''])assert.equal(A.productionEligibleStatus(s),false,s);

const fastvolt=A.normalizeOverlay({stationId:'fv-1',cpo_operator:'FastVolt / Afrimobility',site_brand:'Afriquia',status:'Available'});
assert.equal(fastvolt.physicalOperator.name,'FastVolt / Afrimobility');
assert.equal(fastvolt.access.siteBrand,'Afriquia');
assert.equal(fastvolt.access.accessNetwork,'EVPlug');
assert.equal(fastvolt.status.state,'available');
assert.equal(fastvolt.status.statusSource,'EVOne / EVPlug roaming status');
assert.equal(fastvolt.overlayPolicy.evoneVisibilityNeverDefinesCpo,true);

const bad=A.normalizeOverlay({stationId:'x',cpo_operator:'Kilowatt',status:'Offline'});
assert.equal(bad.status,null,'excluded EVOne statuses must not become production status');
assert.equal(bad.overlayPolicy.diagnosticStatusClass,'diagnostic_only');

assert.equal(A.normalizeOverlay({stationId:'unknown-cpo',status:'Available'}),null,'EVOne visibility alone must never create a CPO attribution');
assert.deepEqual(A.productionRows([{status:'Available'},{status:'Offline'},{status:'Charging'},{status:'Unknown'}]).map(x=>x.status),['Available','Charging']);
console.log(JSON.stringify({ok:true,allowed:A.allowedStatuses,excluded:A.excludedStatuses},null,2));
