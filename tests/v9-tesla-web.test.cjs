const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Tesla=require('../assets/v9/adapters/tesla-json.js');
const Session=require('../assets/v9/session-engine.js');
const root=path.resolve(__dirname,'..');
const raw=JSON.parse(fs.readFileSync(path.join(root,'data/v9/tesla-web/tesla_stations.json')));
const meta=JSON.parse(fs.readFileSync(path.join(root,'data/v9/tesla-web/metadata.json')));
const normalized=Tesla.normalizePayload(raw);
assert.equal(raw.length,meta.exportStationCount);
assert.equal(new Set(normalized.map(s=>s.canonicalId)).size,raw.length);
assert.equal(raw.filter(s=>s.countryCode==='NL').length,meta.byCountry.NL);
const evses=normalized.flatMap(s=>s.evses.map(e=>e.id));
assert.equal(new Set(evses).size,evses.length,'EVSE ids must be unique across Tesla sites');
for(const [i,s] of normalized.entries()){
  assert.equal(s.status.state,'unknown','web snapshot is not live availability');
  assert.equal(s.updatedAt,raw[i].sourceObservedAt);
  for(const offer of s.offers){
    assert.equal(offer.metadata.sourceProvider,'SuC Tracker');
    assert.equal(offer.metadata.timeZone,raw[i].timezone);
    assert.equal(offer.currency,offer.pricing.rules[0].currency);
    assert.equal(offer.pricing.postChargeFeeUnknown,true);
  }
  if(raw[i].sucTracker.accessSource==='unknown'||!raw[i].pricing.rules.length)assert.equal(s.offers.length,0);
}
const eindhoven=normalized.find(s=>s.canonicalId==='tesla-eindhoven-netherlands');
assert.ok(eindhoven?.offers.length);
const session={energyKwh:20,durationMinutes:30,startAt:'2026-09-19T10:00:00Z',targetCurrency:'EUR'};
const priced=Session.evaluateStation(eindhoven,session);
assert.ok(priced.best,'Tesla Eindhoven must be charge-price comparable');
const parked=Session.evaluateStation(eindhoven,{...session,postChargeMinutes:15});
assert.equal(parked.best,null,'unknown idle fee must not become free parking');
assert.equal(parked.incomplete[0].result.reason,'post_charge_fee_unknown_for_station');
const stale=structuredClone(raw.find(s=>s.id===eindhoven.canonicalId));
stale.sucTracker.staleSince='2026-09-18';
assert.equal(Tesla.normalizeStation(stale).offers.length,0);
const foreign=normalized.find(s=>s.offers.some(o=>o.currency==='GBP'));
assert.ok(foreign,'native GBP must survive normalization');
assert.equal(Session.evaluateStation(foreign,session).best,null,'missing FX must not silently become EUR');
(async()=>{
  const primary=raw[0],legacy={...raw[1],id:'legacy-only',sucTracker:undefined};
  const loader=Tesla.createLoader({url:'web',supplementUrl:'legacy',fetchImpl:async url=>({ok:true,json:async()=>url==='web'?[primary]:[primary,legacy]})});
  const all=await loader();
  assert.deepEqual(all.map(s=>s.canonicalId),[primary.id,'legacy-only']);
  const broken=Tesla.createLoader({url:'web',supplementUrl:'legacy',fetchImpl:async url=>({ok:url!=='web',status:503,json:async()=>[legacy]})});
  await assert.rejects(broken,/Tesla catalogue unavailable/);
  console.log(JSON.stringify({ok:true,webStations:raw.length,nlTesla:meta.byCountry.NL,sourceGeneratedAt:meta.sourceGeneratedAt,eindhovenChargeEstimate:priced.best.total,unknownAccess:meta.accessHoursUnknown}));
})().catch(e=>{console.error(e);process.exit(1);});
