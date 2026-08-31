'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const path=require('node:path');
const National=require('../assets/v9/adapters/national-compact.js');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const Session=require('../assets/v9/session-engine.js');
const root=path.join(__dirname,'..');
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const readGz=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,p))).toString('utf8'));
const manifest=readJson('data/v9/italy-static/manifest.json');
const rows=readGz('data/v9/italy-static/all.json.gz');
const offers=readJson('data/v9/italy-offers.json');
const report=readJson('data/v9/italy-build-report.json');
const normalized=Direct.normalizePayload(offers);
assert.equal(manifest.country,'IT'); assert.equal(rows.length,29696);
assert.equal(offers.directOffers.length,report.directOffers);
assert.equal(offers.subscriptionOffers.length,report.subscriptionOffers);
assert.equal(offers.emspOffers.length,report.emspOffers);
assert.equal(normalized.offerRules.length,report.directOffers+report.subscriptionOffers+report.emspOffers);
const stationByEvse=new Map();
for(const row of rows)for(const cfg of row[8]||[]){const eid=String(cfg?.[0]||'');if(eid)stationByEvse.set(eid,row)}
assert.ok(stationByEvse.size>70000);
for(const [name,layer] of [['direct',offers.directOffers],['subscription',offers.subscriptionOffers],['emsp',offers.emspOffers]]){
  assert.ok(layer.length);
  for(const raw of [layer[0],layer[Math.floor(layer.length/2)],layer[layer.length-1]]){
    const eid=String(raw.evseIds?.[0]||''); assert.ok(eid&&stationByEvse.has(eid),`${name} identity missing ${eid}`);
    const station=National.normalizeRow(stationByEvse.get(eid),{countryCode:'IT',sourceId:'italy-pun'}); assert.ok(station.evses.some(e=>e.id===eid));
  }
}
const duferco=offers.directOffers.filter(o=>o.provider==='Duferco Mobility'); assert.equal(duferco.length,1648);
const enel=offers.directOffers.filter(o=>o.provider==='Enel X Way'); assert.equal(enel.length,22783); assert.ok(enel.every(o=>o.pricing?.priceSelectionBasis==='session_start_local_time'));
const superOffers=offers.subscriptionOffers.filter(o=>o.selectionId==='enel_plug_and_go_super');
const explorerOffers=offers.subscriptionOffers.filter(o=>o.selectionId==='enel_plug_and_go_explorer');
const ewivaN=report.ewivaEnelEmspOffers||0; assert.ok(ewivaN>1700);
assert.equal(superOffers.length,22783+ewivaN); assert.equal(explorerOffers.length,22783+ewivaN);
const ewivaEmsp=offers.emspOffers.filter(o=>o.provider==='Enel On Your Way'&&o.metadata?.network==='Ewiva');
const ewivaSuper=superOffers.filter(o=>o.metadata?.network==='Ewiva'); const ewivaExplorer=explorerOffers.filter(o=>o.metadata?.network==='Ewiva');
assert.equal(ewivaEmsp.length,ewivaN); assert.equal(ewivaSuper.length,ewivaN); assert.equal(ewivaExplorer.length,ewivaN);
assert.ok(ewivaEmsp.every(o=>o.metadata?.rankableAsCpoDirect===false)); assert.ok(!offers.directOffers.some(o=>o.provider==='Ewiva'));
const ac=enel.find(o=>o.metadata?.tariffClass==='AC'); assert.ok(ac); const eid=ac.evseIds[0]; const exp=explorerOffers.find(o=>o.evseIds?.[0]===eid&&o.metadata?.network==='Enel X Way'); assert.ok(exp);
const station={id:'IT:enel:smoke',countryCode:'IT',offers:Direct.normalizePayload({country:'IT',directOffers:[ac],subscriptionOffers:[exp]}).offerRules};
let r=Session.evaluateStation(station,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-31T18:50:00Z'},{selectedSubscriptions:[]}); assert.equal(r.best.total,13.4); assert.equal(r.best.result.segmented,false);
r=Session.evaluateStation(station,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-31T19:05:00Z'},{selectedSubscriptions:['enel_plug_and_go_explorer']}); assert.equal(r.best.subscriptionId,'enel_plug_and_go_explorer'); assert.equal(r.best.total,9.6);
assert.ok(normalized.offerRules.some(o=>o.kind==='emsp'&&o.provider==='NextCharge'));
assert.ok(normalized.offerRules.some(o=>o.kind==='emsp'&&o.provider==='Enel On Your Way'));
const states=new Set(rows.map(r=>String(r[10]||''))); assert.ok(states.has('OPERATIONAL'));
console.log(JSON.stringify({ok:true,stations:rows.length,direct:report.directOffers,subscriptions:report.subscriptionOffers,emsp:report.emspOffers,ewiva:ewivaN},null,2));
