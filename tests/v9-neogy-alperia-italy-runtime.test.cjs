'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const Session=require('../assets/v9/session-engine.js');

const root=path.join(__dirname,'..');
const offers=JSON.parse(fs.readFileSync(path.join(root,'data/v9/italy-offers.json'),'utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'data/v9/italy-static/all.json.gz'))).toString('utf8'));
const neogyDirect=offers.directOffers.filter(offer=>offer.sourceId==='neogy-italy-qr-direct');
const easyCharge=offers.subscriptionOffers.filter(offer=>offer.sourceId==='alperia-easycharge-neogy-italy');
const light=easyCharge.filter(offer=>offer.selectionId==='alperia_easycharge_light');
const plus=easyCharge.filter(offer=>offer.selectionId==='alperia_easycharge_plus');

const physical=new Map();
for(const row of rows)for(const evse of row[8]||[]){
  const id=String(evse?.[0]||'');
  if(id)physical.set(id,{stationId:String(row[0]||''),operator:String(row[5]||''),status:String(row[10]||''),kind:String(evse?.[2]||''),powerKw:Number(evse?.[3])});
}
const neogyPhysicalIds=new Set([...physical].filter(([,item])=>item.operator==='NEOGY SRL').map(([id])=>id));
const directIds=new Set(neogyDirect.flatMap(offer=>offer.evseIds||[]));
const lightIds=new Set(light.flatMap(offer=>offer.evseIds||[]));
const plusIds=new Set(plus.flatMap(offer=>offer.evseIds||[]));
const ac43Ids=new Set(light.filter(offer=>offer.metadata?.tariffClass==='AC_43_UNRESOLVED').flatMap(offer=>offer.evseIds||[]));

assert.equal(neogyPhysicalIds.size,1563);
assert.equal(neogyDirect.length,1537);
assert.equal(directIds.size,1537);
assert.equal(light.length,1563);
assert.equal(plus.length,1563);
assert.deepEqual(lightIds,neogyPhysicalIds);
assert.deepEqual(plusIds,neogyPhysicalIds);
assert.equal(ac43Ids.size,26);
assert.ok([...ac43Ids].every(id=>!directIds.has(id)),'unresolved AC43 EVSE must not receive a direct price');
assert.ok([...directIds].every(id=>neogyPhysicalIds.has(id)));
assert.ok([...neogyPhysicalIds].every(id=>physical.get(id).status==='OPERATIONAL'));

function distribution(layer,key){
  const out={};
  for(const offer of layer){const value=String(key(offer));out[value]=(out[value]||0)+1;}
  return out;
}
assert.deepEqual(distribution(neogyDirect,offer=>offer.metadata?.tariffClass),{
  OTHER_ITALY_QUICK:789,OTHER_ITALY_FAST:85,OTHER_ITALY_HYPER:20,SOUTH_TYROL_QUICK:402,SOUTH_TYROL_DC:241
});
assert.deepEqual(distribution(neogyDirect,offer=>offer.pricing?.pricePerKwh),{'0.45':402,'0.55':241,'0.67':789,'0.79':85,'0.98':20});
assert.deepEqual(distribution(light,offer=>offer.pricing?.pricePerKwh),{'0.45':421,'0.55':241,'0.79':901});
assert.deepEqual(distribution(plus,offer=>offer.pricing?.pricePerKwh),{'0.35':1563});

const compactKindDisagreements=light.filter(offer=>{
  const item=physical.get(offer.evseIds[0]);
  return item.kind!==offer.metadata?.connectorKind;
});
assert.equal(compactKindDisagreements.length,973,'known compact power fallback must stay contained and audited');
assert.ok(compactKindDisagreements.every(offer=>offer.metadata?.connectorKind==='AC'&&offer.metadata?.maxPowerKw>22&&physical.get(offer.evseIds[0]).kind==='DC'));

for(const offer of neogyDirect){
  assert.equal(offer.provider,'Neogy');
  assert.equal(offer.directOperatorOnly,true);
  assert.equal(offer.verifiedScope,'exact_evse');
  assert.equal(offer.metadata?.paymentMethod,'qr_credit_card');
  assert.equal(offer.metadata?.timeZone,'Europe/Rome');
  assert.equal(offer.pricing?.type,'kwh');
  assert.equal(offer.pricing?.postChargeFee?.graceMinutes,60);
  assert.ok([0.08,0.15].includes(offer.pricing?.postChargeFee?.eurPerMinute));
}
for(const offer of easyCharge){
  assert.equal(offer.provider,'Alperia Charge');
  assert.equal(offer.verifiedScope,'exact_evse');
  assert.equal(offer.metadata?.channel,'subscription');
  assert.equal(offer.metadata?.activationFeeEur,25);
  assert.equal(offer.metadata?.activationFeeExcludedFromSessionCost,true);
  assert.equal(offer.metadata?.partnerRoamingScopeUnresolvedFailClosed,true);
  assert.ok(!Object.hasOwn(offer.pricing,'activationFeeEur'));
}
assert.ok(plus.every(offer=>offer.validFrom==='2025-03-01'&&offer.validThrough==='2027-02-28'&&offer.validityBasis==='session_start_local_date'));
assert.ok(plus.every(offer=>offer.metadata?.requiresAlperiaCronEnergyOrBenElectricityCustomer===true));
assert.ok(light.every(offer=>offer.metadata?.forNonAlperiaElectricityCustomers===true));

function stationFor(directOffers=[],subscriptionOffers=[]){
  return{id:'IT:neogy:test',countryCode:'IT',offers:Direct.normalizePayload({country:'IT',directOffers,subscriptionOffers}).offerRules};
}
const baseSession={energyKwh:10,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-09-01T08:00:00Z',postChargeMinutes:0};
const outsideQuick=neogyDirect.find(offer=>offer.metadata?.tariffClass==='OTHER_ITALY_QUICK');
const outsideFast=neogyDirect.find(offer=>offer.metadata?.tariffClass==='OTHER_ITALY_FAST');
const plusForQuick=plus.find(offer=>offer.evseIds[0]===outsideQuick.evseIds[0]);
assert.ok(outsideQuick&&outsideFast&&plusForQuick);

let evaluated=Session.evaluateStation(stationFor([outsideQuick]),baseSession,{selectedSubscriptions:[]});
assert.equal(evaluated.comparableOfferCount,1);
assert.equal(evaluated.best.total,6.7);

evaluated=Session.evaluateStation(stationFor([outsideQuick]),{
  ...baseSession,postChargeMinutes:61,postChargeStartAt:'2026-09-01T08:30:00Z'
},{selectedSubscriptions:[]});
assert.equal(evaluated.best.total,6.78,'Quick daytime post-charge minute must cost EUR 0.08 after grace');
assert.equal(evaluated.best.result.components.postCharge.billableMinutes,1);

evaluated=Session.evaluateStation(stationFor([outsideQuick]),{
  ...baseSession,postChargeMinutes:61,postChargeStartAt:'2026-09-01T20:00:00Z'
},{selectedSubscriptions:[]});
assert.equal(evaluated.best.total,6.7,'Quick post-charge time after 23:00 Rome must be exempt');
assert.equal(evaluated.best.result.components.postCharge.exemptMinutes,1);

evaluated=Session.evaluateStation(stationFor([outsideQuick]),{...baseSession,postChargeMinutes:61},{selectedSubscriptions:[]});
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'post_charge_exemption_requires_start_time');

evaluated=Session.evaluateStation(stationFor([outsideFast]),{...baseSession,postChargeMinutes:61},{selectedSubscriptions:[]});
assert.equal(evaluated.best.total,8.05,'DC post-charge minute must cost EUR 0.15 after grace');

const quickStation=stationFor([outsideQuick],[plusForQuick]);
evaluated=Session.evaluateStation(quickStation,baseSession,{selectedSubscriptions:[]});
assert.equal(evaluated.best.offerId,outsideQuick.id,'EasyCharge must remain opt-in');
evaluated=Session.evaluateStation(quickStation,baseSession,{selectedSubscriptions:['alperia_easycharge_plus']});
assert.equal(evaluated.best.subscriptionId,'alperia_easycharge_plus');
assert.equal(evaluated.best.total,3.5,'the EUR 25 activation fee must not enter session cost');
evaluated=Session.evaluateStation(quickStation,{...baseSession,startAt:'2027-03-01T10:00:00Z'},{selectedSubscriptions:['alperia_easycharge_plus']});
assert.equal(evaluated.best.offerId,outsideQuick.id,'expired EasyCharge Plus must not displace direct pricing');
assert.ok(evaluated.incomplete.some(item=>item.result.reason==='offer_outside_validity_window'));

const ac43Light=light.find(offer=>offer.metadata?.tariffClass==='AC_43_UNRESOLVED'&&offer.metadata?.geography==='south_tyrol');
assert.ok(ac43Light);
evaluated=Session.evaluateStation(stationFor([],[ac43Light]),{...baseSession,postChargeMinutes:61},{selectedSubscriptions:['alperia_easycharge_light']});
assert.equal(evaluated.comparableOfferCount,1);
assert.equal(evaluated.best.subscriptionId,'alperia_easycharge_light');
assert.equal(evaluated.best.total,4.65,'EasyCharge Light may price AC43 while direct remains fail-closed');

assert.equal(offers.policy?.neogyDirectExactEvseOnly,true);
assert.equal(offers.policy?.neogyAc43DirectFailClosed,true);
assert.equal(offers.policy?.neogyPostChargeFeesIncluded,true);
assert.equal(offers.policy?.alperiaEasyChargeSubscriptionsOptIn,true);
assert.equal(offers.policy?.alperiaEasyChargeExactNeogyEvseOnly,true);
assert.equal(offers.policy?.alperiaEasyChargePartnerRoamingFailClosed,true);

console.log(JSON.stringify({
  ok:true,
  physicalNeogy:neogyPhysicalIds.size,
  direct:neogyDirect.length,
  directFailClosedAc43:ac43Ids.size,
  easyChargeLight:light.length,
  easyChargePlus:plus.length,
  compactKindFallbackAudited:compactKindDisagreements.length,
  activationFeeExcludedFromSessionCost:true,
  postChargeGraceMinutes:60
},null,2));
