'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const A=require('../v9-production-runtime/assets/v9/adapters/uk-pcpr.js');
const P=require('../v9-production-runtime/assets/v9/pricing-engine.js');
const S=require('../v9-production-runtime/assets/v9/session-engine.js');

const base='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/';
async function get(url){
  const r=await fetch(url,{headers:{'user-agent':'TeslaChargeCompanion-V9-smoke'}});
  assert.equal(r.status,200,url+': HTTP '+r.status);
  return r;
}
async function main(){
  const [dataRes,auditRes]=await Promise.all([
    get(base+'data/national/uk_allego_uk_pcpr_v9.json.gz'),
    get(base+'reports/uk/allego_uk-pcpr-validation-latest.json')]);
  const doc=JSON.parse(zlib.gunzipSync(Buffer.from(await dataRes.arrayBuffer())).toString('utf8'));
  const audit=await auditRes.json();
  const lengths={},power={},reason={},all=doc.sources[0].locations.flatMap(l=>l.evses.flatMap(e=>e.connectors.map(c=>({c,l}))));
  for(const {c} of all){const n=(c.tariff_ids||[]).length;lengths[n]=(lengths[n]||0)+1;const kw=String(c.max_electric_power??'MISSING');power[kw]=(power[kw]||0)+1;}
  const powerEnvelopes={};for(const {c} of all){const k=[c.power_type,c.max_voltage,c.max_amperage].join('|');powerEnvelopes[k]=(powerEnvelopes[k]||0)+1;}
  const sample=all[0];const tariff=doc.sources[0].tariffs[0];
  console.log('PRE-VALIDATION',JSON.stringify({connectorTariffIdsHistogram:lengths,connectorPowerWatts:power,powerEnvelopes,
    firstConnector:sample.c,firstEvse:doc.sources[0].locations[0].evses[0],firstStation:{id:doc.sources[0].locations[0].id,name:doc.sources[0].locations[0].name,address:doc.sources[0].locations[0].address,city:doc.sources[0].locations[0].city,party_id:doc.sources[0].locations[0].party_id},
    firstTariff:{id:tariff.id,party_id:tariff.party_id,priceBasis:tariff.tccPriceBasis,parsedPricing:A.pricingFromTariff(tariff)}},null,2));
  const parsed=A.normalizePayload(doc,audit,{id:'allego-uk-pcpr-direct',priority:{tariff:130}});
  const stations=parsed.stations,offers=stations.flatMap(st=>st.offers);
  const connectors=stations.flatMap(st=>st.evses).flatMap(e=>e.connectors);
  assert.equal(stations.length,77);
  assert.equal(connectors.length,240);
  assert.equal(offers.length,240,'Every exact connector must receive a calculable first-party offer');
  assert.equal(new Set(offers.map(o=>o.id)).size,240);
  assert.equal(new Set(offers.map(o=>o.metadata.sourceTariffId)).size,39);
  assert(offers.some(o=>o.connectorKinds.includes('AC')));
  assert(offers.some(o=>o.connectorKinds.includes('DC')));
  assert(offers.some(o=>o.pricing.rules[0].ocpiDurationBands?.length),'45-minute parking rule missing');
  assert(offers.every(o=>o.currency==='GBP'&&o.directOperatorOnly===true&&o.metadata.pcprExactConnector===true));
  assert(offers.every(o=>o.evseIds.length===1&&o.connectorIds.length===1));
  const restricted=offers.find(o=>o.pricing.rules[0].ocpiDurationBands?.length);
  const start='2026-10-10T13:00:00.000Z',session={startAt:start,energyKwh:10,durationMinutes:90,chargingMinutes:60,arrivalSoc:20,targetSoc:80};
  const on=P.evaluateOffer(restricted,session),off=P.evaluateOffer(restricted,{...session,includeCongestionFees:false});
  assert(on.complete&&off.complete);
  assert(on.totalEur>off.totalEur,'PCPR congestion parking fee not being applied');
  const station=stations.find(st=>st.offers.length>1);
  assert(station,'No multi-connector Allego station found');
  const map=Object.fromEntries(station.evses.flatMap(e=>e.connectors.filter(c=>c.kind!=='OTHER').map(c=>[c.id,{...session,chargingMinutes:45,durationMinutes:70,postChargeMinutes:25}])));
  const result=S.evaluateStation(station,session,{selectedSubscriptions:[],targetCurrency:'GBP',pcprConnectorSessions:map});
  assert(result.comparableOfferCount>1,'Same-station EVSE tariffs were incorrectly collapsed to one connector');
  assert(result.best?.connectorId&&map[result.best.connectorId],'Best selected incorrect connector id');
  const unplanned=S.evaluateStation(station,session,{targetCurrency:'GBP'});
  assert.equal(unplanned.comparableOfferCount,0,'Exact connector offer was priced without individual charging plan');
  const registry=JSON.parse(fs.readFileSync('v9-production-runtime/data/v9/source-registry.json','utf8'));
  const registered=registry.sources.find(s=>s.id==='allego-uk-pcpr-direct');
  assert(registered?.active===true&&registered.adapter==='uk-pcpr-v1');
  assert(!registry.sources.some(s=>/source.ev.*pcpr/.test(s.id)), 'Unauthorized Source EV activation');
  const config=JSON.parse(fs.readFileSync('v9-production-shell/shell-config.json','utf8'));
  assert(config.engineScopeCountries.includes('GB'));
  assert(fs.readFileSync('v9-production-shell/index.html','utf8').includes('adapters/uk-pcpr.js'));
  console.log(JSON.stringify({result:'PASS',stations:stations.length,connectors:connectors.length,
    exactDirectOffers:offers.length,uniqueTariffs:39,parkingOffers:offers.filter(o=>o.pricing.rules[0].ocpiDurationBands?.length).length,
    withParkingOn:on.totalEur,withParkingOff:off.totalEur,stationOfferCount:result.comparableOfferCount,scope:'Allego UK only'},null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
