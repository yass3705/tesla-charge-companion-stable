'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const path=require('node:path');
const National=require('../assets/v9/adapters/national-compact.js');
const Direct=require('../assets/v9/adapters/direct-offers.js');

const root=path.join(__dirname,'..');
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const readGzJson=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,p))).toString('utf8'));

const manifest=readJson('data/v9/italy-static/manifest.json');
const rows=readGzJson('data/v9/italy-static/all.json.gz');
const offers=readJson('data/v9/italy-offers.json');
const normalized=Direct.normalizePayload(offers);

assert.equal(manifest.country,'IT');
assert.equal(rows.length,29696);
assert.equal(offers.directOffers.length,23978);
assert.equal(offers.subscriptionOffers.length,2764);
assert.equal(offers.emspOffers.length,2281);
assert.equal(normalized.offerRules.length,23978+2764+2281);

const stationByEvse=new Map();
for(const row of rows){
  for(const cfg of row[8]||[]){
    const eid=String(cfg?.[0]||'');
    if(eid)stationByEvse.set(eid,row);
  }
}
assert.ok(stationByEvse.size>70000,'expected national PUN EVSE identities');

function validateLayer(layer,kind){
  assert.ok(layer.length>0,`${kind} layer empty`);
  const samples=[layer[0],layer[Math.floor(layer.length/2)],layer[layer.length-1]];
  for(const raw of samples){
    const eid=String(raw.evseIds?.[0]||'');
    assert.ok(eid,`${kind} offer missing exact EVSE`);
    const row=stationByEvse.get(eid);
    assert.ok(row,`${kind} EVSE ${eid} absent from PUN catalogue`);
    const station=National.normalizeRow(row,{countryCode:'IT',sourceId:'italy-pun'});
    assert.ok(station,'station normalization failed');
    assert.ok(station.evses.some(e=>e.id===eid),`${kind} EVSE ${eid} lost during normalization`);
  }
}

validateLayer(offers.directOffers,'direct');
validateLayer(offers.subscriptionOffers,'subscription');
validateLayer(offers.emspOffers,'emsp');

assert.ok(normalized.offerRules.some(o=>o.kind==='direct'));
assert.ok(normalized.offerRules.some(o=>o.kind==='subscription'&&o.subscriptionId==='atlante_go'));
assert.ok(normalized.offerRules.some(o=>o.kind==='emsp'&&o.provider==='NextCharge'&&o.directOperatorOnly===false));

const states=new Set(rows.map(r=>String(r[10]||'')));
assert.ok(states.has('OPERATIONAL'));
const operational=rows.find(r=>r[10]==='OPERATIONAL');
assert.equal(National.normalizeRow(operational,{countryCode:'IT',sourceId:'italy-pun'}).status.state,'available');
if(states.has('NON_OPERATIONAL')){
  const down=rows.find(r=>r[10]==='NON_OPERATIONAL');
  assert.equal(National.normalizeRow(down,{countryCode:'IT',sourceId:'italy-pun'}).status.state,'out_of_service');
}

console.log(JSON.stringify({
  ok:true,
  stations:rows.length,
  evseIdentities:stationByEvse.size,
  direct:offers.directOffers.length,
  subscriptions:offers.subscriptionOffers.length,
  emsp:offers.emspOffers.length,
  statuses:[...states].sort()
},null,2));
