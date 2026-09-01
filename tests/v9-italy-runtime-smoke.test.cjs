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
const readGzJson=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,p))).toString('utf8'));

const manifest=readJson('data/v9/italy-static/manifest.json');
const rows=readGzJson('data/v9/italy-static/all.json.gz');
const offers=readJson('data/v9/italy-offers.json');
const normalized=Direct.normalizePayload(offers);

assert.equal(manifest.country,'IT');
assert.equal(rows.length,29696);
assert.equal(offers.directOffers.length,54383);
assert.equal(offers.subscriptionOffers.length,53134);
assert.equal(offers.emspOffers.length,1678);
assert.equal(normalized.offerRules.length,offers.directOffers.length+offers.subscriptionOffers.length+offers.emspOffers.length);

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

const goElectric=offers.directOffers.filter(o=>o.provider==='Go Electric Stations SRLS');
const goElectricEnergy=goElectric.filter(o=>o.pricing?.type==='kwh');
const goElectricSession=goElectric.filter(o=>o.pricing?.type==='rules');
assert.ok(goElectric.length>0,'Go Electric direct layer empty');
assert.ok(goElectricEnergy.length>0,'Go Electric kWh layer empty');
assert.ok(goElectricSession.length>0,'Go Electric session-fee layer empty');
assert.equal(goElectricEnergy.length+goElectricSession.length,goElectric.length,'unexpected Go Electric pricing type');
assert.ok(goElectricEnergy.every(o=>Number.isFinite(Number(o.pricing?.pricePerKwh))));
assert.ok(goElectricSession.every(o=>Array.isArray(o.pricing?.rules)&&o.pricing.rules.length===1));
assert.ok(goElectricSession.every(o=>Number.isFinite(Number(o.pricing.rules[0]?.pricePerKwh))&&Number.isFinite(Number(o.pricing.rules[0]?.sessionFeeEur))));
assert.ok(goElectricSession.every(o=>o.pricing.rules[0]?.connectedTimePerMinuteEur===undefined));
assert.ok(goElectric.every(o=>!JSON.stringify(o).toLowerCase().includes('preauth')));

const freeToX=offers.directOffers.filter(o=>o.provider==='Free To X');
assert.equal(freeToX.length,291);
assert.equal(freeToX.filter(o=>o.metadata?.tariffClass==='AC').length,105);
assert.equal(freeToX.filter(o=>o.metadata?.tariffClass==='DC_PROMO_LE64').length,186);
assert.ok(freeToX.every(o=>o.pricing?.pricePerKwh===0.5&&o.pricing?.postChargeFeeUnknown===true));
assert.ok(freeToX.every(o=>!JSON.stringify(o).toLowerCase().includes('preauth')));

const repower=offers.directOffers.filter(o=>o.sourceId==='repower-italy-recharge-around-direct');
assert.equal(repower.length,661);
assert.equal(repower.filter(o=>o.pricing?.pricePerKwh===0.5856).length,657);
assert.equal(repower.filter(o=>o.pricing?.pricePerKwh===0.48).length,3);
assert.equal(repower.filter(o=>o.pricing?.pricePerKwh===0).length,1);
assert.equal(repower.filter(o=>o.metadata?.matchMethod==='station_address_connector').length,10);
assert.ok(repower.every(o=>o.provider==='Repower'&&o.pricing?.postChargeFeeUnknown===true));

const geSessionSample=Direct.normalizePayload({country:'IT',directOffers:[goElectricSession[0]]}).offerRules[0];
const geSessionStation={id:'IT:go-electric:smoke',countryCode:'IT',offers:[geSessionSample]};
const geRawRule=goElectricSession[0].pricing.rules[0];
let geEvaluated=Session.evaluateStation(geSessionStation,{energyKwh:10,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-09-01T08:00:00Z',postChargeMinutes:0});
assert.equal(geEvaluated.comparableOfferCount,1);
assert.equal(geEvaluated.best.total,Math.round((10*Number(geRawRule.pricePerKwh)+Number(geRawRule.sessionFeeEur)+Number.EPSILON)*1e6)/1e6);

const duferco=offers.directOffers.filter(o=>o.provider==='Duferco Mobility');
assert.equal(duferco.length,1648);
assert.ok(duferco.every(o=>o.pricing?.type==='rules'));
assert.ok(duferco.every(o=>o.pricing?.holidayCalendar==='IT'));
assert.ok(duferco.every(o=>o.pricing?.postChargeFeeUnknown===true));
assert.ok(duferco.every(o=>Array.isArray(o.pricing?.rules)&&o.pricing.rules.length===6));
assert.ok(duferco.every(o=>o.metadata?.timeZone==='Europe/Rome'));

const dufercoSample=Direct.normalizePayload({country:'IT',directOffers:[duferco[0]]}).offerRules[0];
const dufercoStation={id:'IT:duferco:smoke',countryCode:'IT',offers:[dufercoSample]};
let evaluated=Session.evaluateStation(dufercoStation,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-31T11:00:00Z',postChargeMinutes:0});
assert.equal(evaluated.comparableOfferCount,1);
assert.ok(evaluated.best.total===10.4||evaluated.best.total===14.8,'unexpected Duferco <=100/>100 class total');
evaluated=Session.evaluateStation(dufercoStation,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-31T11:00:00Z',postChargeMinutes:1});
assert.equal(evaluated.comparableOfferCount,0);
assert.equal(evaluated.incomplete[0].result.reason,'post_charge_fee_unknown_for_station');

const enel=offers.directOffers.filter(o=>o.provider==='Enel X Way');
assert.equal(enel.length,22783);
assert.ok(enel.every(o=>o.pricing?.type==='rules'));
assert.ok(enel.every(o=>o.pricing?.priceSelectionBasis==='session_start_local_time'));
assert.ok(enel.every(o=>o.metadata?.timeZone==='Europe/Rome'));
const superOffers=offers.subscriptionOffers.filter(o=>o.selectionId==='enel_plug_and_go_super');
const explorerOffers=offers.subscriptionOffers.filter(o=>o.selectionId==='enel_plug_and_go_explorer');
assert.equal(superOffers.length,24461);
assert.equal(explorerOffers.length,22783);
assert.ok(superOffers.every(o=>o.pricing?.priceSelectionBasis==='session_start_local_time'));
assert.ok(explorerOffers.every(o=>o.pricing?.priceSelectionBasis==='session_start_local_time'));

const enelAcRaw=enel.find(o=>o.metadata?.tariffClass==='AC');
assert.ok(enelAcRaw,'expected at least one AC Enel offer');
const enelEid=enelAcRaw.evseIds[0];
const explorerRaw=explorerOffers.find(o=>o.evseIds?.[0]===enelEid);
assert.ok(explorerRaw,'selected Explorer offer missing on Enel AC EVSE');
const enelRules=Direct.normalizePayload({country:'IT',directOffers:[enelAcRaw],subscriptionOffers:[explorerRaw]}).offerRules;
const enelStation={id:'IT:enel:smoke',countryCode:'IT',offers:enelRules};

evaluated=Session.evaluateStation(enelStation,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-31T18:50:00Z'},{selectedSubscriptions:[]});
assert.equal(evaluated.best.total,13.4);
assert.equal(evaluated.best.result.segmented,false);
assert.equal(evaluated.best.result.priceSelectionBasis,'session_start_local_time');

evaluated=Session.evaluateStation(enelStation,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-31T18:50:00Z'},{selectedSubscriptions:['enel_plug_and_go_explorer']});
assert.equal(evaluated.best.subscriptionId,'enel_plug_and_go_explorer');
assert.equal(evaluated.best.total,11.4);

evaluated=Session.evaluateStation(enelStation,{energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt:'2026-08-31T19:05:00Z'},{selectedSubscriptions:['enel_plug_and_go_explorer']});
assert.equal(evaluated.best.subscriptionId,'enel_plug_and_go_explorer');
assert.equal(evaluated.best.total,9.6);

const ewivaEmsp=offers.emspOffers.filter(o=>String(o.id||'').startsWith('it:emsp:enel-on-your-way-ewiva:'));
const ewivaDirect=offers.directOffers.filter(o=>o.sourceId==='ewiva-italy-pos-direct');
const ewivaSuper=superOffers.filter(o=>o.metadata?.network==='Ewiva');
const ewivaExplorer=explorerOffers.filter(o=>o.metadata?.network==='Ewiva');
assert.equal(ewivaDirect.length,1271);
assert.equal(ewivaEmsp.length,1678);
assert.equal(ewivaSuper.length,1678);
assert.equal(ewivaExplorer.length,0);
assert.ok(ewivaEmsp.every(o=>o.metadata?.rankableAsCpoDirect===false));
assert.ok(ewivaDirect.every(o=>o.provider==='Ewiva'&&o.pricing?.pricePerKwh===0.8));
assert.ok(ewivaDirect.every(o=>o.validFrom==='2026-08-01'&&o.pricing?.postChargeFeeUnknown===true));

assert.ok(normalized.offerRules.some(o=>o.kind==='direct'));
assert.ok(normalized.offerRules.some(o=>o.kind==='direct'&&o.provider==='Go Electric Stations SRLS'));
assert.ok(normalized.offerRules.some(o=>o.kind==='subscription'&&o.subscriptionId==='atlante_go'));
assert.ok(normalized.offerRules.some(o=>o.kind==='subscription'&&o.subscriptionId==='enel_plug_and_go_super'));
assert.ok(normalized.offerRules.some(o=>o.kind==='subscription'&&o.subscriptionId==='enel_plug_and_go_explorer'));
assert.ok(normalized.offerRules.some(o=>o.kind==='subscription'&&o.subscriptionId==='alperia_easycharge_light'));
assert.ok(normalized.offerRules.some(o=>o.kind==='subscription'&&o.subscriptionId==='alperia_easycharge_plus'));
assert.ok(!normalized.offerRules.some(o=>o.kind==='emsp'&&o.provider==='NextCharge'),'legacy Go Electric NextCharge eMSP must be retired');
assert.ok(normalized.offerRules.some(o=>o.kind==='emsp'&&o.provider==='Enel On Your Way'&&o.directOperatorOnly===false));

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
  goElectric:goElectric.length,
  goElectricEnergy:goElectricEnergy.length,
  goElectricSession:goElectricSession.length,
  freeToX:freeToX.length,
  repower:repower.length,
  duferco:duferco.length,
  enel:enel.length,
  subscriptions:offers.subscriptionOffers.length,
  enelSuper:superOffers.length,
  enelExplorer:explorerOffers.length,
  ewivaDirect:ewivaDirect.length,
  ewivaEmsp:ewivaEmsp.length,
  ewivaSuper:ewivaSuper.length,
  emsp:offers.emspOffers.length,
  statuses:[...states].sort()
},null,2));
