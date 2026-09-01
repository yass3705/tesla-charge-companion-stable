'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const National=require('../assets/v9/adapters/national-compact.js');
const Data=require('../assets/v9/data-engine.js');
const Session=require('../assets/v9/session-engine.js');

const root=path.join(__dirname,'..');
const offers=JSON.parse(fs.readFileSync(path.join(root,'data/v9/italy-offers.json'),'utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'data/v9/italy-static/all.json.gz'))).toString('utf8'));
const ewivaDirect=offers.directOffers.filter(offer=>offer.sourceId==='ewiva-italy-pos-direct');
const ewivaEmsp=offers.emspOffers.filter(offer=>String(offer.id||'').startsWith('it:emsp:enel-on-your-way-ewiva:'));
const ewivaSuper=offers.subscriptionOffers.filter(offer=>offer.selectionId==='enel_plug_and_go_super'&&offer.metadata?.network==='Ewiva');

const physical=new Map();
for(const row of rows)for(const evse of row[8]||[]){
  const id=String(evse?.[0]||'');
  if(id)physical.set(id,{row,operator:String(row[5]||'')});
}
const physicalEwivaParty=[...physical.keys()].filter(id=>id.startsWith('IT*EWI*E'));
const publishedIds=new Set(ewivaDirect.flatMap(offer=>offer.evseIds||[]));
const emspIds=new Set(ewivaEmsp.flatMap(offer=>offer.evseIds||[]));
const directEmspOverlap=[...publishedIds].filter(id=>emspIds.has(id));
const directOnly=[...publishedIds].filter(id=>!emspIds.has(id));
const directOnlyOperatorCounts=directOnly.reduce((counts,id)=>{
  const operator=physical.get(id).operator;
  counts[operator]=(counts[operator]||0)+1;
  return counts;
},{});

assert.equal(physicalEwivaParty.length,1753);
assert.equal(ewivaDirect.length,1271);
assert.equal(publishedIds.size,1271);
assert.equal(physicalEwivaParty.filter(id=>!publishedIds.has(id)).length,482);
assert.equal(ewivaEmsp.length,1678);
assert.equal(ewivaSuper.length,1678);
assert.equal(directEmspOverlap.length,1210);
assert.equal(directOnly.length,61);
assert.ok([...publishedIds].every(id=>physical.has(id)));
assert.deepEqual(directOnlyOperatorCounts,{EWI:59,'EWIVA SRL':2});
assert.ok(ewivaDirect.every(offer=>{
  const id=offer.evseIds[0];
  const station=National.normalizeRow(physical.get(id).row,{countryCode:'IT',sourceId:'italy-pun'});
  return Data.ruleMatchesStation(Direct.directRule(offer,'IT'),station);
}),'all Ewiva direct offers must attach by exact current EVSE identity');

for(const offer of ewivaDirect){
  assert.equal(offer.provider,'Ewiva');
  assert.equal(offer.directOperatorOnly,true);
  assert.equal(offer.verifiedScope,'exact_evse');
  assert.equal(offer.validFrom,'2026-08-01');
  assert.equal(offer.validityBasis,'session_start_local_date');
  assert.equal(offer.pricing?.type,'kwh');
  assert.equal(offer.pricing?.pricePerKwh,0.8);
  assert.equal(offer.pricing?.postChargeFeeUnknown,true);
  assert.equal(offer.metadata?.paymentMethod,'contactless_pos');
  assert.equal(offer.metadata?.timeZone,'Europe/Rome');
  assert.equal(offer.metadata?.authorizationHoldExcludedFromSessionCost,true);
  assert.ok(offer.metadata?.matchDistanceMeters<=25);
  assert.equal(offer.metadata?.matchEvidence?.region,true);
  assert.ok(offer.metadata?.matchEvidence?.city||offer.metadata?.matchEvidence?.street);
  assert.ok(!JSON.stringify(offer.pricing).toLowerCase().includes('authorizationhold'));
}
assert.equal(offers.policy?.offerValidityDatesEnforced,true);
assert.equal(offers.policy?.ewivaPosDirectExactEvseOnly,true);
assert.equal(offers.policy?.ewivaPosEligibilityFromOfficialMap,true);
assert.equal(offers.policy?.ewivaPosUnmatchedAndAmbiguousFailClosed,true);
assert.equal(offers.policy?.ewivaDirectAndEnelEmspCommercialSeparation,true);

function stationFor(raw){
  const normalized=Direct.normalizePayload({country:'IT',directOffers:[raw]}).offerRules[0];
  return{id:`IT:ewiva:${raw.evseIds[0]}`,countryCode:'IT',offers:[normalized]};
}
function session(startAt,extra={}){
  return{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt,postChargeMinutes:0,...extra};
}

const raw=ewivaDirect[0];
let evaluated=Session.evaluateStation(stationFor(raw),session('2026-09-01T10:00:00Z'));
assert.equal(evaluated.comparableOfferCount,1);
assert.equal(evaluated.best.total,16,'the EUR 100 card hold must never be added to session cost');
evaluated=Session.evaluateStation(stationFor(raw),session('2026-07-31T21:59:00Z'));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'offer_outside_validity_window');
evaluated=Session.evaluateStation(stationFor(raw),session('2026-07-31T22:00:00Z'));
assert.equal(evaluated.comparableOfferCount,1,'2026-08-01 local Europe/Rome must activate the tariff');
evaluated=Session.evaluateStation(stationFor(raw),session('2026-09-01T10:00:00Z',{postChargeMinutes:1}));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'post_charge_fee_unknown_for_station');

console.log(JSON.stringify({
  ok:true,
  physicalEwivaParty:physicalEwivaParty.length,
  publishedDirect:ewivaDirect.length,
  failClosedUnpublished:physicalEwivaParty.length-publishedIds.size,
  directEmspOverlap:directEmspOverlap.length,
  directOnlyEwiLabel:directOnly.length,
  directOnlyOperatorCounts,
  priceEurPerKwh:0.8,
  validFrom:'2026-08-01',
  postChargePolicy:'fail_closed'
},null,2));
