import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

function assert(condition,message){if(!condition)throw new Error(message);}
const code=fs.readFileSync('assets/france-catalog-v8.js','utf8');
const ionity=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/ionity_direct_stations_france.json.gz')).toString('utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/non_tesla_france/all.json.gz')).toString('utf8'));
const sandbox={
  console,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},
  fetch:async()=>{throw new Error('fetch interdit dans le test unitaire');},
  document:{getElementById:()=>null},localStorage:{getItem:()=>null},
  candidateStations:async()=>({stations:[]}),resolveOrigin:async()=>({lat:48.81,lon:2.07,label:'test'}),stations:[],window:null
};
sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(code,sandbox);
const api=sandbox.TCCFranceCatalogV8;assert(api,'API catalogue France V8 absente');

const catalog=rows.map(row=>api.stationFromRow(row,1));
const nonIonityBefore=catalog.filter(station=>!api.isIonityOperator(station)).length;
const merged=api.mergeIonityCatalog(catalog,ionity,{lat:0,lon:0},0);
const strict=merged.filter(station=>station.ionityStrictCpo===true);
const stats=sandbox.TCC_IONITY_MERGE_STATS;

assert(strict.length===ionity.counts.franceLocationCount,`Stations IONITY intégrées : ${strict.length}`);
assert(new Set(strict.map(station=>station.ionityLocationUuid)).size===strict.length,'UUID IONITY dupliqué');
assert(strict.every(station=>station.operator==='IONITY'&&station.ionityCpoIdentifier==='IONITY_CPO'),'Station hors périmètre IONITY_CPO');
assert(stats.matched/strict.length>=.90,`Couverture de rapprochement externe insuffisante : ${stats.matched}/${strict.length}`);
assert(merged.filter(station=>!api.isIonityOperator(station)).length===nonIonityBefore,'Une station non-IONITY a été modifiée ou supprimée');

let directConnectors=0;
for(const station of strict){
  const direct=(station.chargingConfigurations||[]).filter(config=>config.ionityDirect);
  assert(direct.length>0,`Tarif Direct absent : ${station.name}`);
  assert(direct.every(config=>config.ionityVerified&&config.offerType==='operator_direct'),'Offre IONITY Direct non vérifiée');
  assert(!direct.some(config=>/motion|power|go|subscription/i.test(`${config.offerProvider} ${config.label}`)),'Abonnement IONITY injecté');
  directConnectors+=direct.reduce((sum,config)=>sum+Number(config.stalls||0),0);
}
assert(directConnectors===ionity.counts.franceConnectorCount,`Connecteurs directs intégrés : ${directConnectors}`);

function stationNamed(fragment){return strict.find(station=>station.name.toLowerCase().includes(fragment.toLowerCase()));}
function directPrices(station,power){return (station?.chargingConfigurations||[]).filter(config=>config.ionityDirect&&Number(config.powerKw)===power).map(config=>Number(config.pricing?.rules?.[0]?.pricePerKwh));}
assert(directPrices(stationNamed('Saint-Witz'),350).includes(.55),'Saint-Witz 350 kW != 0,55 EUR/kWh');
assert(directPrices(stationNamed('Blois Villerbon'),350).includes(.62),'Blois Villerbon 350 kW != 0,62 EUR/kWh');
assert(directPrices(stationNamed('Blois Villerbon'),50).includes(.39),'Blois Villerbon 50 kW != 0,39 EUR/kWh');
assert(directPrices(stationNamed('Chartres Bois Paris'),400).includes(.55),'Chartres Bois Paris 400 kW != 0,55 EUR/kWh');

console.log(JSON.stringify({strictStations:strict.length,matched:stats.matched,added:stats.added,collapsed:stats.collapsedSourceDuplicates,directConnectors},null,2));
