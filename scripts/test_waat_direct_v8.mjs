import fs from 'node:fs';
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

const dataPath=new URL('../data/waat_direct_tariffs_tcc_france.json',import.meta.url);
const catalog=JSON.parse(fs.readFileSync(dataPath,'utf8'));
W.validateCatalog(catalog);
assert.equal(catalog.counts.franceStations,571);
assert.equal(catalog.counts.rankableStations,452);
assert.equal(catalog.counts.rankableConfigs,507);
assert.equal(catalog.counts.unresolvedStations,119);
assert.equal(catalog.stations.length,571);

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

// The ambiguous Monta group 811653 must never exist in the consolidated rankable file.
const allConfigs=catalog.stations.flatMap(s=>s.configs||[]);
assert.equal(allConfigs.length,507);
assert.ok(allConfigs.every(c=>!(c.groupIds||[]).map(Number).includes(811653)),'ambiguous WAAT group leaked into consolidated rankable dataset');
for(const c of allConfigs){
  assert.ok(['AC','DC'].includes(c.kind));
  assert.ok(Number(c.powerKw)>0);assert.ok(Number(c.directEurPerKwh)>0);
  assert.ok(Array.isArray(c.groupIds)&&c.groupIds.length>0);
}

console.log('WAAT V8 direct runtime tests: OK');