import fs from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.document={readyState:'loading',addEventListener(){},dispatchEvent(){}};
globalThis.CustomEvent=class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}};
globalThis.fetch=async()=>({ok:false,status:404});
globalThis.setInterval=()=>0;
globalThis.clearInterval=()=>{};
const source=fs.readFileSync(new URL('../assets/v8-waat-direct.js',import.meta.url),'utf8');
vm.runInThisContext(source,{filename:'v8-waat-direct.js'});
const W=globalThis.TCCWaatDirectV8;
assert.ok(W,'WAAT runtime export missing');

const dataPath=new URL('../data/waat_monta_direct_tariffs_france.json.gz',import.meta.url);
const catalog=JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath)));
W.validateCatalog(catalog);
assert.equal(catalog.counts.inventoryStations,571);
assert.equal(catalog.counts.mapHttp200,571);
assert.equal(catalog.counts.mapErrors,0);
assert.equal(catalog.counts.rankableStations,452);
assert.equal(catalog.counts.rankablePhysicalConfigs,507);

assert.equal(W.isWaatOperator({operator:'WAAT SAS | FR*WA2'}),true);
assert.equal(W.isWaatOperator({operator:'Electroverse'}),false);

function directOffers(st){return (st.chargingConfigurations||[]).filter(c=>c.waatDirectOffer===true)}
function priceOf(c){return Number(c?.pricing?.rules?.[0]?.pricePerKwh)}

// Strasbourg PROUDREED: DC 47 kW = 0.42 EUR/kWh.
let st={countryCode:'FR',operator:'WAAT SAS | FR*WA2',catalogStationId:'FRWA2P1059184137021780127',name:'WAAT - PROUDREED/s631961',address:'10 Rue Jacobi-Netter, Strasbourg 67200 France',chargingConfigurations:[{kind:'DC',powerKw:47,stalls:2}]};
let out=W.addOffers(st,catalog),offers=directOffers(out);
assert.equal(offers.length,1);assert.equal(offers[0].kind,'DC');assert.equal(offers[0].powerKw,47);assert.ok(Math.abs(priceOf(offers[0])-.42)<1e-9);
assert.deepEqual(offers[0].waatMontaGroupIds,[631961]);

// Same station, wrong physical configuration must not inherit the DC tariff.
st={countryCode:'FR',operator:'WAAT SAS | FR*WA2',catalogStationId:'FRWA2P1059184137021780127',chargingConfigurations:[{kind:'AC',powerKw:11,stalls:1}]};
out=W.addOffers(st,catalog);assert.equal(directOffers(out).length,0);

// Le Pontet: exact AC 22 kW witness = 0.28 EUR/kWh.
st={countryCode:'FR',operator:'WAAT',catalogStationId:'FRWA2P1057939547644682686',chargingConfigurations:[{kind:'AC',powerKw:22,stalls:2}]};
out=W.addOffers(st,catalog);offers=directOffers(out);assert.equal(offers.length,1);assert.ok(Math.abs(priceOf(offers[0])-.28)<1e-9);

// Unknown WAAT station must remain fail-closed: no network-wide fallback.
st={countryCode:'FR',operator:'WAAT',catalogStationId:'FRWA2PUNKNOWN',name:'Station inconnue',address:'Adresse inconnue',chargingConfigurations:[{kind:'AC',powerKw:22,stalls:2}]};
out=W.addOffers(st,catalog);assert.equal(directOffers(out).length,0);

// Carcassonne mixed/range group 811653 must never become a WAAT Direct offer.
const carc=catalog.stations.find(s=>(s.montaGroups||[]).some(g=>g.montaGroupId===811653));
assert.ok(carc,'Carcassonne range witness missing');
const range=carc.montaGroups.find(g=>g.montaGroupId===811653);
assert.equal(range.rankable,false);assert.equal(range.blockingReason,'price_range');assert.equal(range.directEurPerKwh,null);
const fakePhysical=(carc.physicalConfigs||[]).map(c=>({kind:c.kind,powerKw:c.powerKw,stalls:1}));
st={countryCode:'FR',operator:'WAAT',catalogStationId:carc.stationIdNormalized,name:carc.stationName,address:carc.address,chargingConfigurations:fakePhysical};
out=W.addOffers(st,catalog);offers=directOffers(out);
assert.ok(offers.every(c=>!(c.waatMontaGroupIds||[]).includes(811653)),'range group leaked into rankable offer');
for(const c of offers)assert.ok(c.waatDirectEurPerKwh>0);

// Every published WAAT Direct configuration must map to exactly one positive price.
for(const station of catalog.stations){
  for(const c of station.integrationConfigs||[]){
    if(!c.rankable)continue;
    assert.ok(['AC','DC'].includes(c.kind));
    assert.ok(Number(c.powerKw)>0);assert.ok(Number(c.directEurPerKwh)>0);
    assert.ok(Array.isArray(c.groupIds)&&c.groupIds.length>0);
  }
}

console.log('WAAT V8 direct runtime tests: OK');
