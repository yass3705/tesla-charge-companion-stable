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
const repower=offers.directOffers.filter(offer=>offer.sourceId==='repower-italy-recharge-around-direct');

const physical=new Map();
for(const row of rows)for(const evse of row[8]||[]){
  const id=String(evse?.[0]||'');
  if(id)physical.set(id,{row,stationId:String(row[0]||''),operator:String(row[5]||''),status:String(row[10]||'')});
}
const physicalRepowerIds=new Set([...physical].filter(([,item])=>item.operator==='Repower Vendita Italia SpA').map(([id])=>id));
const publishedIds=new Set(repower.flatMap(offer=>offer.evseIds||[]));
const unpublished=[...physicalRepowerIds].filter(id=>!publishedIds.has(id));

function distribution(layer,key){
  const out={};
  for(const offer of layer){const value=String(key(offer));out[value]=(out[value]||0)+1;}
  return out;
}

assert.equal(physicalRepowerIds.size,1155);
assert.equal(repower.length,661);
assert.equal(publishedIds.size,661);
assert.equal(unpublished.length,494);
assert.equal(new Set(repower.map(offer=>offer.id)).size,661);
assert.ok([...publishedIds].every(id=>physicalRepowerIds.has(id)));
assert.deepEqual(distribution(repower,offer=>offer.metadata?.matchMethod),{
  connector_uuid:302,external_id:349,station_address_connector:10
});
assert.deepEqual(distribution(repower,offer=>offer.pricing?.pricePerKwh),{
  '0':1,'0.48':3,'0.5856':657
});

assert.ok(repower.every(offer=>{
  const id=offer.evseIds[0];
  const station=National.normalizeRow(physical.get(id).row,{countryCode:'IT',sourceId:'italy-pun'});
  return Data.ruleMatchesStation(Direct.directRule(offer,'IT'),station);
}),'all Repower direct offers must attach by exact current PUN EVSE identity');

const strictSite=repower.filter(offer=>offer.metadata?.matchMethod==='station_address_connector');
assert.equal(strictSite.length,10);
assert.ok(strictSite.every(offer=>offer.metadata?.matchDistanceMeters<=25));
assert.ok(strictSite.every(offer=>offer.metadata?.matchEvidence?.addressExact===true));
assert.ok(strictSite.every(offer=>offer.metadata?.matchEvidence?.punStationCandidateCount===1));
assert.ok(strictSite.every(offer=>offer.metadata?.matchEvidence?.punEvseCandidateCount===1));
assert.ok(strictSite.every(offer=>offer.metadata?.matchEvidence?.targetHadExactIdentity===false));

for(const offer of repower){
  assert.equal(offer.provider,'Repower');
  assert.equal(offer.directOperatorOnly,true);
  assert.equal(offer.verifiedScope,'exact_evse');
  assert.equal(offer.source,'https://www.repower.com/it/e-mobility/recharge-around');
  assert.equal(offer.pricing?.type,'kwh');
  assert.equal(offer.pricing?.postChargeFeeUnknown,true);
  assert.equal(offer.metadata?.channel,'operator_direct_one_shot');
  assert.equal(offer.metadata?.paymentMethod,'one_shot');
  assert.equal(offer.metadata?.operator,'Repower Vendita Italia SpA');
  assert.equal(offer.metadata?.timeZone,'Europe/Rome');
  assert.equal(offer.metadata?.unknownPostChargeFeeFailClosed,true);
  assert.equal(offer.metadata?.authorizationHoldExcludedFromSessionCost,true);
  assert.equal(offer.metadata?.stationId,physical.get(offer.evseIds[0]).stationId);
  assert.ok(!JSON.stringify(offer.pricing).toLowerCase().includes('preauth'));
  assert.ok(!JSON.stringify(offer.pricing).toLowerCase().includes('authorizationhold'));
}

const paid=repower.filter(offer=>offer.pricing?.pricePerKwh>0);
const free=repower.filter(offer=>offer.pricing?.pricePerKwh===0);
assert.equal(paid.length,660);
assert.equal(free.length,1);
assert.ok(paid.every(offer=>offer.validFrom==='2024-03-20'));
assert.ok(paid.every(offer=>offer.validityBasis==='session_start_local_date'));
assert.ok(paid.every(offer=>offer.metadata?.officialTariffValidFrom==='2024-03-20T00:00:00.00000+01:00'));
assert.equal(free[0].validFrom,undefined);
assert.equal(free[0].metadata?.officialFreeCharge,true);
assert.equal(free[0].metadata?.officialPriceComponentModel,'official_free_flag_without_price_components');
assert.ok(paid.every(offer=>offer.metadata?.officialPriceComponentModel==='single_energy_eur_per_kwh_component'));

assert.equal(offers.policy?.repowerRechargeAroundDirectExactEvseOnly,true);
assert.equal(offers.policy?.repowerOfficialConnectorPricesOnly,true);
assert.equal(offers.policy?.repowerUnsupportedPriceComponentsFailClosed,true);
assert.equal(offers.policy?.repowerAmbiguousMatchesFailClosed,true);
assert.equal(offers.policy?.repowerFreeChargeOfficialFlagOnly,true);
assert.equal(offers.policy?.repowerUnknownPostChargeFeesFailClosed,true);

function stationFor(raw){
  const normalized=Direct.normalizePayload({country:'IT',directOffers:[raw]}).offerRules[0];
  return{id:`IT:repower:${raw.evseIds[0]}`,countryCode:'IT',offers:[normalized]};
}
function session(startAt,extra={}){
  return{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt,postChargeMinutes:0,...extra};
}

const standard=repower.find(offer=>offer.pricing?.pricePerKwh===0.5856);
const reduced=repower.find(offer=>offer.pricing?.pricePerKwh===0.48);
assert.ok(standard&&reduced&&free[0]);

let evaluated=Session.evaluateStation(stationFor(standard),session('2026-09-01T10:00:00Z'));
assert.equal(evaluated.comparableOfferCount,1);
assert.equal(evaluated.best.total,11.712);
evaluated=Session.evaluateStation(stationFor(reduced),session('2026-09-01T10:00:00Z'));
assert.equal(evaluated.best.total,9.6);
evaluated=Session.evaluateStation(stationFor(free[0]),session('2026-09-01T10:00:00Z'));
assert.equal(evaluated.comparableOfferCount,1);
assert.equal(evaluated.best.total,0);

evaluated=Session.evaluateStation(stationFor(standard),session('2024-03-19T22:59:00Z'));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'offer_outside_validity_window');
evaluated=Session.evaluateStation(stationFor(standard),session('2024-03-19T23:00:00Z'));
assert.equal(evaluated.comparableOfferCount,1,'valid-from must activate at midnight Europe/Rome');

evaluated=Session.evaluateStation(stationFor(standard),session('2026-09-01T10:00:00Z',{postChargeMinutes:1}));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'post_charge_fee_unknown_for_station');
evaluated=Session.evaluateStation(stationFor(free[0]),session('2026-09-01T10:00:00Z',{postChargeMinutes:1}));
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'post_charge_fee_unknown_for_station');

console.log(JSON.stringify({
  ok:true,
  physicalRepower:physicalRepowerIds.size,
  published:repower.length,
  failClosedUnpublished:unpublished.length,
  exactIdentity:651,
  strictSite:strictSite.length,
  standardRate:0.5856,
  reducedRate:0.48,
  officialFree:free.length,
  postChargePolicy:'fail_closed'
},null,2));
