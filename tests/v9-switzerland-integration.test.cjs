const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const adapter=require('../v9-production-runtime/assets/v9/adapters/national-compact.js');
const data=require('../v9-production-runtime/assets/v9/data-engine.js');
const direct=require('../v9-production-runtime/assets/v9/adapters/direct-offers.js');
const registry=require('../v9-production-runtime/data/v9/source-registry.json');

const nat=registry.sources.find(s=>s.id==='switzerland-national');
const off=registry.sources.find(s=>s.id==='switzerland-verified-offers');
assert.ok(nat&&nat.active&&nat.countries.includes('CH'));
assert.ok(off&&off.active&&off.countries.includes('CH'));
const swissCoverage=new Map((registry.subscriptionCoverage||[]).filter(x=>(x.countries||[]).includes('CH')).map(x=>[x.subscriptionId,x]));
assert.ok(swissCoverage.has('fastned-gold'),'French Fastned Gold selection must carry into Switzerland');
assert.ok((swissCoverage.get('fastned-gold').countries||[]).includes('FR'));
assert.ok((swissCoverage.get('fastned-gold').evidenceSources||[]).includes('switzerland-verified-offers'));
for(const id of ['lidl-plus-ch','emoti-member-ch','move-mobility:Move comfort','socar-/-move-charging-backend:Move comfort']){
  assert.ok(swissCoverage.has(id),`Swiss selectable subscription missing from registry: ${id}`);
  assert.ok((swissCoverage.get(id).evidenceSources||[]).includes('switzerland-verified-offers'));
}

const allDays=Array.from({length:7},(_,d)=>[d,'00:00','24:00']);
const row=['CH*TEST:ST1','Swiss test','Addr',47.0,8.0,'Test CPO',2,allDays,
 [
  ['CH*TEST*E1','Test · E1','AC',22,1,[],['CH*TEST*E1']],
  ['CH*TEST*E2','Test · E2','DC',150,1,[],['CH*TEST*E2']]
 ],
 '2026-09-28T00:00:00Z','OCCUPIED','Test network'];
const st=adapter.normalizeRow(row,{countryCode:'CH',sourceId:'switzerland-national',schemaVersion:4,queryDate:'2026-09-28'});
assert.equal(st.countryCode,'CH');
assert.equal(st.networkBrand,'Test network');
assert.equal(st.status.state,'available');
assert.equal(st.evses.length,2);

const payload={schemaVersion:1,country:'CH',directOffers:[{
 id:'ch:test:e1:direct',provider:'Test CPO',countries:['CH'],currency:'EUR',
 evseIds:['CH*TEST*E1'],verifiedScope:'exact_evse_power',
 connectorKinds:['AC'],minPowerKw:21.99,maxPowerKw:22.01,
 pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.5}]},priority:130
}]};
const rule=direct.normalizePayload(payload).offerRules[0];
assert.equal(data.ruleMatchesStation(rule,st),true);
const unmatched=adapter.normalizeRow(['CH*OTHER:ST2','Other','Addr2',47.1,8.1,'Test CPO',1,allDays,
 [['CH*OTHER*E9','Other · E9','DC',150,1,[],['CH*OTHER*E9']]],
 '2026-09-28T00:00:00Z','OFFLINE','Other'],{countryCode:'CH',sourceId:'switzerland-national',schemaVersion:4});
assert.equal(unmatched.status.state,'out_of_service');
assert.equal(data.ruleMatchesStation(rule,unmatched),false);
const applied=data.applyOfferRules([st,unmatched],[{rule,source:{id:'switzerland-verified-offers',priority:{tariff:130}}}]);
assert.equal(applied.length,2,'unpriced Swiss station must remain visible');
assert.equal(applied[0].offers.length,1);
assert.equal(applied[1].offers.length,0);

const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../v9-production-runtime/data/v9/switzerland-static/manifest.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(__dirname,'../v9-production-runtime/data/v9/switzerland-build-report.json'),'utf8'));
const offers=JSON.parse(fs.readFileSync(path.join(__dirname,'../v9-production-runtime/data/v9/switzerland-offers.json'),'utf8'));
assert.ok(manifest.evseCount>18000);
assert.ok(report.national.excludedTeslaEvseCount>0,'Swiss national Tesla EVSEs must be excluded from CH baseline to avoid Tesla-global duplicates');
assert.equal(manifest.evseCount,report.national.publishedNonTeslaEvses);
assert.ok(report.offers.uniqueDirectEvse>10000);
assert.ok(offers.directOffers.every(o=>Array.isArray(o.evseIds)&&o.evseIds.length===1));
assert.ok(offers.directOffers.every(o=>o.verifiedScope==='exact_evse_power'));
assert.ok(offers.directOffers.every(o=>Array.isArray(o.connectorKinds)&&o.connectorKinds.length===1));
const swissSubscriptionIds=new Set((offers.subscriptionOffers||[]).map(o=>o.selectionId));
for(const id of ['fastned-gold','lidl-plus-ch','emoti-member-ch','move-mobility:Move comfort','move-mobility-/-mynet:Move comfort','socar-/-move-charging-backend:Move comfort']){
  assert.ok(swissSubscriptionIds.has(id),`Swiss subscription offer missing from build: ${id}`);
}
for(const id of swissSubscriptionIds){
  assert.ok(swissCoverage.has(id),`Generated Swiss subscription is not exposed by the selector registry: ${id}`);
}
const gated={offers:[
  {id:'direct',provider:'Direct',subscriptionId:null},
  {id:'gold',provider:'Fastned Gold',subscriptionId:'fastned-gold'},
  {id:'lidl',provider:'Lidl Plus',subscriptionId:'lidl-plus-ch'}
]};
assert.deepEqual(data.eligibleOffers(gated,[]).map(o=>o.id),['direct']);
assert.deepEqual(data.eligibleOffers(gated,['fastned-gold']).map(o=>o.id),['direct','gold']);

// Real generated Swiss Fastned regression: French/global Fastned Gold selection
// must unlock the verified Swiss Gold price while preserving the direct offer.
const realFastnedGold=(offers.subscriptionOffers||[]).find(o=>o.selectionId==='fastned-gold');
assert.ok(realFastnedGold,'Fastned Gold Swiss offer missing');
const realFastnedEvse=realFastnedGold.evseIds?.[0];
assert.ok(realFastnedEvse,'Fastned Gold Swiss EVSE missing');
const realFastnedDirect=(offers.directOffers||[]).find(o=>(o.evseIds||[]).includes(realFastnedEvse)&&o.provider==='Fastned');
assert.ok(realFastnedDirect,'Fastned Swiss direct offer missing for Gold EVSE');
assert.equal(realFastnedDirect.metadata?.originalPricePerKwh,0.75);
assert.equal(realFastnedGold.metadata?.originalPricePerKwh,0.53);
const realFastnedStation={countryCode:'CH',offers:[
  {...realFastnedDirect,subscriptionId:null},
  {...realFastnedGold,subscriptionId:'fastned-gold'}
]};
assert.deepEqual(data.eligibleOffers(realFastnedStation,[]).map(o=>o.id),[realFastnedDirect.id]);
assert.deepEqual(new Set(data.eligibleOffers(realFastnedStation,['fastned-gold']).map(o=>o.id)),new Set([realFastnedDirect.id,realFastnedGold.id]));
console.log('Switzerland V9 integration test OK',report.national,report.offers.uniqueDirectEvse);
