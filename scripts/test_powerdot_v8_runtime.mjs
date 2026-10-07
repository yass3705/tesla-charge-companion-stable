import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
function assert(condition,message){if(!condition)throw new Error(message);}
const code=fs.readFileSync('assets/france-catalog-v8.js','utf8');
const powerdot=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/powerdot_direct_france.json.gz')).toString('utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/non_tesla_france/all.json.gz')).toString('utf8'));
const sandbox={console,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},fetch:async()=>{throw new Error('fetch interdit dans le test unitaire');},document:{getElementById:()=>null},localStorage:{getItem:()=>null},candidateStations:async()=>({stations:[]}),resolveOrigin:async()=>({lat:48.81,lon:2.07,label:'test'}),stations:[],window:null};
sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(code,sandbox);
const api=sandbox.TCCFranceCatalogV8;assert(api,'API catalogue France V8 absente');
assert(powerdot.source?.sourceType==='direct_cpo_public_adhoc_api','Source Powerdot inattendue');
assert(powerdot.source?.roaming===false&&String(powerdot.source?.emspCode??'')===''&&powerdot.source?.operator==='Power Dot France','Contexte CPO Powerdot invalide');
const recognizedTypes=new Set(['ENERGY','FLAT','PARKING_TIME','TIME']);
const expectedMappableConnectors=(powerdot.chargers||[]).reduce((sum,entry)=>{
  const location=entry.location||{},validLocation=location.countryCode==='FR'&&Number.isFinite(Number(location.latitude))&&Number.isFinite(Number(location.longitude));
  if(!validLocation)return sum;
  return sum+(entry.charger?.connectors||[]).filter(connector=>Number(connector.maxPowerKw)>0&&(connector.tariff?.elements||[]).some(element=>(element.priceComponents||[]).some(component=>recognizedTypes.has(component.type)&&Number(component.pricePerUnit)>0))).length;
},0);
const excludedUnmappableConnectors=Number(powerdot.counts.pricedConnectors||0)-expectedMappableConnectors;
assert(expectedMappableConnectors>=7050,`Couverture Powerdot mappable insuffisante : ${expectedMappableConnectors}`);
assert(excludedUnmappableConnectors>=0&&excludedUnmappableConnectors<=5,`Trop de connecteurs Powerdot non mappables : ${excludedUnmappableConnectors}`);
const locations=api.powerdotLocations(powerdot).filter(location=>api.powerdotDirectConfigurations(location).length>0);
const catalog=rows.map(row=>api.stationFromRow(row,1));
const nonPowerdotBefore=catalog.filter(station=>!api.isPowerdotOperator(station)).length;
const merged=api.mergePowerdotCatalog(catalog,powerdot,{lat:0,lon:0},0);
const strict=merged.filter(station=>station.powerdotStrictCpo===true),stats=sandbox.TCC_POWERDOT_MERGE_STATS;
assert(strict.length===locations.length,`Stations Powerdot directes intégrées : ${strict.length}/${locations.length}`);
assert(new Set(strict.map(station=>station.powerdotLocationId)).size===strict.length,'Location Powerdot dupliquée');
assert(strict.every(station=>station.operator==='Powerdot'&&station.powerdotDirectPricingContext==='adhoc_emsp_empty'),'Station hors périmètre Powerdot direct');
assert(merged.filter(station=>!api.isPowerdotOperator(station)).length===nonPowerdotBefore,'Une station non-Powerdot a été modifiée ou supprimée');
let directConnectors=0;
for(const station of strict){const direct=(station.chargingConfigurations||[]).filter(config=>config.powerdotDirect);assert(direct.length>0,`Tarif Powerdot direct absent : ${station.name}`);assert(direct.every(config=>config.powerdotVerified&&config.offerType==='operator_direct'),'Offre Powerdot directe non vérifiée');assert(!direct.some(config=>/electroverse|chargemap|miio|leasing social/i.test(`${config.offerProvider} ${config.label}`)),'Tarif itinérance/conditionnel injecté');directConnectors+=direct.reduce((sum,config)=>sum+Number(config.stalls||0),0);}
assert(directConnectors===expectedMappableConnectors,`Connecteurs directs mappables : ${directConnectors}/${expectedMappableConnectors}`);
assert(stats.directConnectors===expectedMappableConnectors,'Stats connecteurs Powerdot incohérentes');
function tariffSignatures(namePattern,station){
  const source=(powerdot.chargers||[]).filter(entry=>namePattern.test(String(entry.location?.name||'')));
  assert(source.length>0,`Source Powerdot absente : ${station.name}`);
  const expected=new Set();
  for(const entry of source)for(const connector of entry.charger?.connectors||[]){
    const components=(connector.tariff?.elements||[]).flatMap(element=>(element.priceComponents||[]).map(component=>({component,restriction:element.restrictions||{}})));
    const energy=components.find(x=>x.component.type==='ENERGY');
    const time=components.find(x=>x.component.type==='TIME'&&Number(x.restriction.minDurationSec)>0);
    if(!energy||!Number(connector.maxPowerKw))continue;
    expected.add([Number(connector.maxPowerKw),Number(energy.component.pricePerUnit),Number(time?.component.pricePerUnit||0),Number(time?.restriction.minDurationSec||0)/60].join('|'));
  }
  const actual=new Set((station.chargingConfigurations||[]).filter(config=>config.powerdotDirect).map(config=>{
    const rule=config.pricing?.rules?.[0]||{};
    return [Number(config.powerKw),Number(rule.pricePerKwh),Number(rule.afterMinutesRate||0),Number(rule.afterMinutesThreshold||0)].join('|');
  }));
  assert(expected.size>0,`Aucun tarif Powerdot source : ${station.name}`);
  assert([...expected].every(signature=>actual.has(signature)),`Tarif compilé différent de la source Powerdot : ${station.name}; attendu ${[...expected]}; obtenu ${[...actual]}`);
}
const champniers=strict.find(station=>/mr\. bricolage - champniers/i.test(station.name));assert(champniers,'Champniers absent');
tariffSignatures(/mr\. bricolage - champniers/i,champniers);
const firstGrill=strict.find(station=>/first grill 45/i.test(station.name));assert(firstGrill,'First Grill 45 absent');
tariffSignatures(/first grill 45/i,firstGrill);
console.log(JSON.stringify({strictLocations:strict.length,matched:stats.matched,added:stats.added,directConnectors,sourcePricedConnectors:powerdot.counts.pricedConnectors,excludedUnmappableConnectors,unresolvedIrveStations:stats.unresolvedIrveStations},null,2));
