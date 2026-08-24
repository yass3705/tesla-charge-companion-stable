import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

function assert(condition,message){if(!condition)throw new Error(message);}
const catalogCode=fs.readFileSync('assets/france-catalog-v8.js','utf8');
const pricingCode=fs.readFileSync('assets/v8-belib-pricing.js','utf8');
const belibPath=process.argv[2]||'data/belib_station_tariffs_v1.json.gz';
const belib=JSON.parse(zlib.gunzipSync(fs.readFileSync(belibPath)).toString('utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/non_tesla_france/all.json.gz')).toString('utf8'));
const sandbox={
  console,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},
  fetch:async()=>{throw new Error('fetch interdit dans le test unitaire');},
  document:{getElementById:()=>null},localStorage:{getItem:()=>null},
  candidateStations:async()=>({stations:[]}),resolveOrigin:async()=>({lat:48.86,lon:2.35,label:'Paris'}),stations:[],window:null
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(catalogCode,sandbox);
const api=sandbox.TCCFranceCatalogV8;
assert(api,'API catalogue Belib V8 absente');

const catalog=rows.map(row=>api.stationFromRow(row,1));
const records=belib.stations.slice(0,3);
const evseIds=record=>[...new Set((record.configurations||[]).flatMap(config=>config.evseIds||[]))];
const live={fetchedAt:'2026-08-24T12:00:00Z',evses:{}};
for(const id of evseIds(records[0]))live.evses[id]={status:'Disponible',last_updated:live.fetchedAt};
for(const id of evseIds(records[1]))live.evses[id]={status:'En maintenance',last_updated:live.fetchedAt};
for(const id of evseIds(records[2]))live.evses[id]={status:'Occupé',last_updated:live.fetchedAt};

const nonBelibBefore=catalog.filter(station=>!api.isBelibOperator(station)).length;
const merged=api.mergeBelibCatalog(catalog,belib,live,{lat:0,lon:0},0);
const strict=merged.filter(station=>station.belibStrictOperator===true);
const stats=sandbox.TCC_BELIB_MERGE_STATS;

assert(strict.length===belib.stats.stationCount,`Stations Belib intégrées : ${strict.length}`);
assert(new Set(strict.map(station=>station.belibStationId)).size===belib.stats.stationCount,'Identifiants Belib dupliqués');
assert(merged.filter(station=>!api.isBelibOperator(station)).length===nonBelibBefore,'Une station hors Belib a été modifiée ou supprimée');
assert(merged.filter(station=>api.isBelibOperator(station)&&!station.belibStrictOperator).length===0,'Une station Belib hors inventaire officiel subsiste');
assert(stats.matched+stats.added===belib.stats.stationCount,'Une station Belib n’a été ni rapprochée ni ajoutée');
assert(stats.matched/belib.stats.stationCount>=.98,`Couverture de rapprochement externe insuffisante : ${stats.matched}/${belib.stats.stationCount}`);
assert(stats.sourceBelibStations===catalog.length-nonBelibBefore,'Décompte des stations Belib source incohérent');

const profiles=new Set(),directConfigs=[];
for(const station of strict){
  assert(station.operator==='Belib’ (TotalEnergies)',`Libellé opérateur invalide : ${station.belibStationId}`);
  assert(station.belibParkingExcluded===true,`Garde-fou parking absent : ${station.belibStationId}`);
  assert(station.chargingConfigurations.some(config=>config.belibDirect),`Offre directe absente : ${station.belibStationId}`);
  for(const config of station.chargingConfigurations||[]){
    for(const rule of config.pricing?.rules||[]){
      assert(!(Number(rule.parkingPerMinute||0)>0),'Un frais de parking subsiste dans une configuration Belib');
      assert(!('parkingFee' in rule)&&!('parkingCost' in rule),'Un champ monétaire de parking subsiste');
    }
    if(config.belibDirect){directConfigs.push(config);profiles.add(config.belibPricingProfileId);}
  }
}
assert(profiles.size===belib.stats.profileCount,`Profils directs présents : ${profiles.size}`);
assert(directConfigs.every(config=>config.offerType==='operator_direct'&&config.belibParkingExcluded===true),'Métadonnées directes Belib invalides');

const byId=new Map(strict.map(station=>[station.belibStationId,station]));
assert(byId.get(records[0].stationId)?.operationalStatus==='available','Statut Disponible non agrégé');
assert(byId.get(records[1].stationId)?.operationalStatus==='out_of_service','Statut maintenance non agrégé');
assert(byId.get(records[2].stationId)?.operationalStatus==='unknown','Une borne occupée ne doit pas produire un faux statut disponible');

const pricingSandbox={
  console,window:null,setInterval:()=>1,clearInterval:()=>{},
  priceWithRules:(pricing,startMinute,chargeMinutes,billedEnergy)=>({total:billedEnergy*.33,connection:0,chargeCost:billedEnergy*.33,idleCost:0,durationSurcharge:0,occupiedMinutes:chargeMinutes,currencies:['EUR']})
};
pricingSandbox.window=pricingSandbox;
vm.createContext(pricingSandbox);
vm.runInContext(pricingCode,pricingSandbox);
assert(pricingSandbox.TCCV8BelibPricing?.installPricing(),'Extension tarifaire Belib non installée');
const visitorFlex=belib.profiles['belib-visitor-flex'];
const priced=pricingSandbox.priceWithRules({type:'rules',rules:visitorFlex.rules},600,60,10,null,'10:00',[]);
assert(Math.abs(priced.connectedTimeCost-2.28)<1e-6,`Temps de branchement Flex : ${priced.connectedTimeCost}`);
assert(Math.abs(priced.total-5.58)<1e-6,`Total visiteur Flex : ${priced.total}`);
assert(priced.belibParkingExcluded===true&&!('parkingCost' in priced),'Le calcul Belib ne doit pas créer de frais de parking');

console.log(JSON.stringify({
  catalogBefore:catalog.length,catalogAfter:merged.length,strictStations:strict.length,matched:stats.matched,added:stats.added,
  excludedStaleSourceStations:stats.excludedSourceStations,directConfigurations:directConfigs.length,profiles:profiles.size,
  liveStatuses:{available:records[0].stationId,outOfService:records[1].stationId,occupiedUnknown:records[2].stationId},visitorFlexOneHour:priced.total
},null,2));
