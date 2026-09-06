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
const freeToX=offers.directOffers.filter(offer=>offer.provider==='Free To X');
const ac=freeToX.filter(offer=>offer.metadata?.tariffClass==='AC');
const promo=freeToX.filter(offer=>offer.metadata?.tariffClass==='DC_PROMO_LE64');

const physical=new Map();
for(const row of rows)for(const evse of row[8]||[]){
  const id=String(evse?.[0]||'');
  if(id)physical.set(id,{kind:String(evse?.[2]||''),powerKw:Number(evse?.[3]),row});
}
const physicalFreeToX=[...physical.keys()].filter(id=>id.startsWith('IT*F2X*E'));
const publishedIds=new Set(freeToX.flatMap(offer=>offer.evseIds||[]));
const unresolved=physicalFreeToX.filter(id=>!publishedIds.has(id));

assert.equal(physicalFreeToX.length,894);
assert.equal(freeToX.length,291);
assert.equal(ac.length,105);
assert.equal(promo.length,186);
assert.equal(unresolved.length,603);
assert.equal(new Set(freeToX.map(offer=>offer.id)).size,291);
assert.equal(publishedIds.size,291);
assert.ok([...publishedIds].every(id=>physical.has(id)));
assert.ok(unresolved.every(id=>physical.get(id).powerKw>64),'only >64 kW unresolved EVSEs may remain absent');
assert.ok(freeToX.every(offer=>{
  const id=offer.evseIds[0],station=National.normalizeRow(physical.get(id).row,{countryCode:'IT',sourceId:'italy-pun'});
  return Data.ruleMatchesStation(Direct.directRule(offer,'IT'),station);
}),'all 291 exact-EVSE offers must attach despite PUN operator-label variants');

for(const offer of freeToX){
  assert.equal(offer.directOperatorOnly,true);
  assert.equal(offer.verifiedScope,'exact_evse');
  assert.equal(offer.sourceId,'freetox-italy-card-direct');
  assert.equal(offer.pricing?.type,'kwh');
  assert.equal(offer.pricing?.pricePerKwh,0.5);
  assert.equal(offer.pricing?.postChargeFeeUnknown,true);
  assert.equal(offer.metadata?.paymentMethod,'credit_or_debit_card');
  assert.equal(offer.metadata?.timeZone,'Europe/Rome');
  assert.ok(!JSON.stringify(offer).toLowerCase().includes('preauth'));
}
assert.ok(ac.every(offer=>offer.validFrom===undefined&&offer.validThrough===undefined));
assert.ok(ac.every(offer=>offer.metadata.maxPowerKw<=22));
assert.ok(promo.every(offer=>offer.validFrom==='2026-07-15'&&offer.validThrough==='2026-09-30'));
assert.ok(promo.every(offer=>offer.validityBasis==='whole_session_local_date'));
assert.ok(promo.every(offer=>offer.metadata.maxPowerKw>22&&offer.metadata.maxPowerKw<=64));
assert.equal(offers.policy?.offerValidityDatesEnforced,true);
assert.equal(offers.policy?.freeToXCardDirectExactEvseOnly,true);
assert.equal(offers.policy?.freeToXUnresolvedHighPowerFailClosed,true);

function stationFor(raw){
  const normalized=Direct.normalizePayload({country:'IT',directOffers:[raw]}).offerRules[0];
  return{id:`IT:freetox:${raw.evseIds[0]}`,countryCode:'IT',offers:[normalized]};
}
function session(startAt,extra={}){
  return{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt,postChargeMinutes:0,...extra};
}

let evaluated=Session.evaluateStation(stationFor(ac[0]),session('2026-09-01T10:00:00Z'));
assert.equal(evaluated.comparableOfferCount,1);
assert.equal(evaluated.best.total,10);
evaluated=Session.evaluateStation(stationFor(ac[0]),session('2026-09-01T10:00:00Z',{postChargeMinutes:1}));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'post_charge_fee_unknown_for_station');

evaluated=Session.evaluateStation(stationFor(promo[0]),session('2026-09-01T10:00:00Z'));
assert.equal(evaluated.comparableOfferCount,1);
assert.equal(evaluated.best.total,10);
evaluated=Session.evaluateStation(stationFor(promo[0]),session('2026-07-14T21:59:00Z'));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'offer_outside_validity_window');
evaluated=Session.evaluateStation(stationFor(promo[0]),session('2026-09-30T22:00:00Z'));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'offer_outside_validity_window');
evaluated=Session.evaluateStation(stationFor(promo[0]),session('2026-09-30T21:45:00Z'));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'offer_session_crosses_validity_window');

console.log(JSON.stringify({ok:true,physicalFreeToX:physicalFreeToX.length,published:freeToX.length,ac:ac.length,promoDcLe64:promo.length,unresolvedGt64:unresolved.length,priceEurPerKwh:0.5,promoValidThrough:'2026-09-30',postChargePolicy:'fail_closed'},null,2));
