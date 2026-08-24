import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

function assert(condition,message){if(!condition)throw new Error(message);}
const code=fs.readFileSync('assets/france-catalog-v8.js','utf8');
const atlante=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/atlante_direct_stations_france.json.gz')).toString('utf8'));
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
const nonAtlanteBefore=catalog.filter(station=>!api.isAtlanteOperator(station)).length;
const merged=api.mergeAtlanteCatalog(catalog,atlante,{lat:0,lon:0},0);
const strict=merged.filter(station=>station.atlanteStrictCpo===true);
const stats=sandbox.TCC_ATLANTE_MERGE_STATS;

assert(strict.length===atlante.counts.franceLocationCount,`Stations Atlante intégrées : ${strict.length}`);
assert(new Set(strict.map(station=>station.atlanteLocationUuid)).size===strict.length,'UUID Atlante dupliqué');
assert(strict.every(station=>station.operator==='Atlante'&&station.atlanteCpo==='FRATL'&&station.atlantePartyId==='ATL'),'Station partenaire présente dans le périmètre direct Atlante');
assert(merged.filter(station=>!api.isAtlanteOperator(station)).length===nonAtlanteBefore,'Une station non-Atlante a été modifiée ou supprimée');

let directConnectors=0;
for(const station of strict){
  const direct=(station.chargingConfigurations||[]).filter(config=>config.atlanteDirect);
  assert(direct.length>0,`Tarif direct absent : ${station.name}`);
  assert(direct.every(config=>config.atlanteVerified&&config.offerType==='operator_direct'),'Offre Atlante directe non vérifiée');
  assert(!direct.some(config=>/powerdot|electra|fastned|ionity|go|subscription/i.test(`${config.offerProvider} ${config.label}`)),'Tarif partenaire ou abonnement injecté dans le direct Atlante');
  directConnectors+=direct.reduce((sum,config)=>sum+Number(config.stalls||0),0);
}
assert(directConnectors===atlante.counts.franceConnectorCount,`Connecteurs directs intégrés : ${directConnectors}`);

function stationNamed(fragment){return strict.find(station=>station.name.toLowerCase().includes(fragment.toLowerCase()));}
function directPrices(station,power){return (station?.chargingConfigurations||[]).filter(config=>config.atlanteDirect&&Number(config.powerKw)===power).map(config=>Number(config.pricing?.rules?.[0]?.pricePerKwh));}
assert(directPrices(stationNamed('Coulommiers'),22).includes(.36),'Coulommiers AC 22 kW != 0,36 EUR/kWh');
assert(directPrices(stationNamed('Coulommiers'),150).includes(.54),'Coulommiers DC 150 kW != 0,54 EUR/kWh');
assert(directPrices(stationNamed('Nanteuil-lès-Meaux'),22).includes(.54),'Nanteuil-lès-Meaux AC 22 kW != 0,54 EUR/kWh');
assert(new Set(atlante.locations.flatMap(location=>location.connectors.map(connector=>connector.pricePerKwhEur))).size===6,'La grille directe Atlante attendue doit conserver six prix');

console.log(JSON.stringify({strictStations:strict.length,matched:stats.matched,added:stats.added,collapsed:stats.collapsedSourceDuplicates,directConnectors,priceCounts:atlante.counts.priceCounts},null,2));
