import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

function assert(condition,message){if(!condition)throw new Error(message);}
const code=fs.readFileSync('assets/france-catalog-v8.js','utf8');
const e55c=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/e55c_station_tariffs_v1.json.gz')).toString('utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/non_tesla_france/all.json.gz')).toString('utf8'));
const sandbox={
  console,
  setTimeout:()=>0,
  clearTimeout:()=>{},
  setInterval:()=>0,
  clearInterval:()=>{},
  fetch:async()=>{throw new Error('fetch interdit dans le test unitaire');},
  document:{getElementById:()=>null},
  localStorage:{getItem:()=>null},
  candidateStations:async()=>({stations:[]}),
  resolveOrigin:async()=>({lat:48.81,lon:2.07,label:'test'}),
  stations:[],
  window:null
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(code,sandbox);
const api=sandbox.TCCFranceCatalogV8;
assert(api,'API catalogue E55C V8 absente');

const catalog=rows.map(row=>api.stationFromRow(row,1));
const statusRecord=e55c.stations.find(record=>catalog.some(st=>api.isE55cOperator(st)&&api.geoDistanceKm(record.coordinates[0],record.coordinates[1],st.latitude,st.longitude)<=.01));
assert(statusRecord,'Aucune station E55C ne correspond au catalogue externe');
const statusCarrier=catalog.find(st=>api.isE55cOperator(st)&&api.geoDistanceKm(statusRecord.coordinates[0],statusRecord.coordinates[1],st.latitude,st.longitude)<=.01);
assert(statusCarrier,'Station de contrôle statut introuvable');
statusCarrier.operationalStatus='available';
statusCarrier.operationalStatusSource='electroverse';

const nonE55Before=catalog.filter(st=>!api.isE55cOperator(st)).length;
const merged=api.mergeE55cCatalog(catalog,e55c,{lat:0,lon:0},0);
const strict=merged.filter(st=>st.e55cStrictOperator===true);
const stats=sandbox.TCC_E55C_MERGE_STATS;

assert(strict.length===e55c.stats.stationCount,`Stations E55C intégrées : ${strict.length}`);
assert(new Set(strict.map(st=>st.e55cStationId)).size===e55c.stats.stationCount,'Identifiants E55C dupliqués');
assert(stats.matched+stats.added===e55c.stats.stationCount,'Une station E55C n’a été ni rapprochée ni ajoutée');
assert(stats.matched/e55c.stats.stationCount>=.90,`Couverture de rapprochement externe insuffisante : ${stats.matched}/${e55c.stats.stationCount}`);
assert(merged.length===catalog.length+stats.added-stats.collapsedSourceDuplicates,`Total catalogue fusionné : ${merged.length}`);
assert(merged.filter(st=>!api.isE55cOperator(st)).length===nonE55Before,'Une station non-E55C a été modifiée ou supprimée');

let resolved=0,unresolved=0;
for(const station of strict){
  assert(station.operator==='Electric 55 Charging (E55C)',`Libellé opérateur invalide : ${station.e55cStationId}`);
  for(const config of station.chargingConfigurations||[]){
    if(!config.e55cDirect)continue;
    if(config.e55cVerified)resolved+=Number(config.stalls||0);else unresolved+=Number(config.stalls||0);
  }
}
assert(resolved===e55c.stats.resolvedPointCount,`PDC directs résolus : ${resolved}`);
assert(unresolved===e55c.stats.unresolvedPointCount,`PDC directs non résolus : ${unresolved}`);

const statusMerged=strict.find(st=>st.e55cStationId===statusRecord.stationId);
assert(statusMerged?.operationalStatus==='available'&&statusMerged?.operationalStatusSource==='electroverse','Le statut Electroverse n’a pas été conservé');
assert(statusMerged.e55cStatusJoinedExternally===true,'Marqueur de jointure externe absent');

const cessy=strict.find(st=>st.e55cStationId==='FR55CP01170CESP3PRDSD');
assert(cessy,'Station E55C Cessy absente');
const cessyPowers=new Set(cessy.chargingConfigurations.filter(c=>c.kind==='AC').map(c=>Number(c.powerKw).toFixed(2)));
assert(cessyPowers.size===1&&cessyPowers.has('22.08'),'Les offres externes et directes 22 kW ne sont pas regroupées');

const sainteJulitte=strict.find(st=>st.e55cStationId==='FR55CP78210SA1P9PESJ');
assert(sainteJulitte,'Station E55C Sainte-Julitte absente');
const sainteJulitteDirect=sainteJulitte.chargingConfigurations.find(config=>config.e55cDirect&&config.e55cVerified);
assert(sainteJulitteDirect,'Tarif direct Sainte-Julitte absent');
const nightRule=sainteJulitteDirect.pricing?.rules?.find(rule=>rule.start==='23:00'&&rule.end==='07:00');
assert(nightRule,'Créneau de nuit Sainte-Julitte absent');
assert(Math.abs(Number(nightRule.chargePerMinute)-.0624)<1e-9,'Tarif de recharge nocturne Sainte-Julitte invalide');
assert(Math.abs(Number(nightRule.idlePerMinute)-.0624)<1e-9,'Tarif de stationnement après charge Sainte-Julitte invalide');
assert(Number(nightRule.parkingPerMinute||0)===0,'Double comptage pendant la recharge à Sainte-Julitte');
assert(nightRule.e55cParkingPhase==='parked_not_charging','Phase PARKING_TIME Sainte-Julitte invalide');

const mixedSource=e55c.stations.find(station=>{
  const groups=new Map();
  for(const config of station.configurations||[]){
    if(config.priceStatus!=='resolved_e55c_scan_pay')continue;
    const key=`${config.kind}|${config.powerKw}`;if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(config.pricingProfileId);
  }
  return [...groups.values()].some(ids=>ids.size>1);
});
if(mixedSource){
  const mixed=strict.find(st=>st.e55cStationId===mixedSource.stationId);
  const direct=(mixed?.chargingConfigurations||[]).filter(c=>c.e55cDirect&&c.e55cVerified);
  const byPower=new Map();for(const config of direct){const key=`${config.kind}|${config.powerKw}`;if(!byPower.has(key))byPower.set(key,[]);byPower.get(key).push(config);}
  const variants=[...byPower.values()].find(configs=>new Set(configs.map(c=>c.e55cPricingProfileId)).size>1);
  assert(variants&&new Set(variants.map(c=>c.offerProvider)).size===variants.length,'Les profils directs exacts par PDC ne sont pas distinguables');
}

console.log(JSON.stringify({catalogBefore:catalog.length,catalogAfter:merged.length,strictStations:strict.length,matched:stats.matched,added:stats.added,collapsed:stats.collapsedSourceDuplicates,resolvedPoints:resolved,unresolvedPoints:unresolved},null,2));
