import fs from 'node:fs';
import zlib from 'node:zlib';

const file=process.argv[2]||'data/belib_station_tariffs_v1.json.gz';
const raw=fs.readFileSync(file);
const text=(raw[0]===0x1f&&raw[1]===0x8b?zlib.gunzipSync(raw):raw).toString('utf8');
const data=JSON.parse(text);
function assert(condition,message){if(!condition)throw new Error(message);}

assert(data?.schemaVersion===1,'Schéma Belib V8 invalide');
assert(data?.dataset==='belib-operated-paris-tcc-v8','Dataset Belib V8 invalide');
assert(data?.scope?.activeInV73===false,'La V7.3 ne doit pas charger Belib V8');
assert(data?.scope?.strictOperatorField==='nom_operateur'&&data?.scope?.strictOperatorValue==='TOTALENERGIES','Filtre opérateur Belib invalide');
assert(data?.scope?.strictBrandField==='nom_enseigne'&&data?.scope?.strictBrandValue==="Belib'",'Filtre enseigne Belib invalide');
assert(data?.scope?.thirdPartyRoamingStationsExcluded===true,'Les stations Belib seulement itinérantes ne sont pas exclues');
assert(data?.scope?.teslaCompatibleConnectorsOnly===true,'Le filtre connecteur Tesla Belib est absent');
assert(data?.scope?.parkingFeesIncluded===false,'Le parking Belib ne doit pas être intégré');
assert(data?.scope?.reservationFeesIncluded===false,'La réservation Belib ne doit pas être imputée');
assert(data?.scope?.dynamicStatusIncluded===false,'Le statut Belib ne doit pas être figé');
assert(/opendata\.paris\.fr/.test(data?.scope?.runtimeLiveStatusUrl||''),'Source live Belib absente');
assert(Array.isArray(data?.stations)&&data.stations.length>=350,'Inventaire Belib trop petit');
assert(Number(data?.stats?.stationCount)===data.stations.length,'Comptage stations Belib invalide');
assert(Number(data?.stats?.chargePointCount)>=1600,'Comptage EVSE Belib trop petit');
assert(Object.keys(data?.profiles||{}).length===9,'Les neuf profils Belib sont requis');

const visitorFlex=data.profiles['belib-visitor-flex'];
assert(visitorFlex&&visitorFlex.subscriptionId===null,'Profil visiteur Belib invalide');
assert(Math.abs(visitorFlex.rules[0].pricePerKwh-.33)<1e-9,'Énergie visiteur Flex invalide');
assert(Math.abs(visitorFlex.rules[0].belibConnectedTimePerMinute-.038)<1e-9,'Temps connecté visiteur Flex invalide');
const nonresident=data.profiles['belib-nonresident-flex'];
assert(nonresident?.subscriptionId==='belib-nonresident','Abonnement Belib non-résident invalide');
assert(Math.abs(nonresident.rules[0].belibConnectedTimePerMinute-.37/15)<1e-8,'Temps connecté Belib non-résident invalide');
const resident=data.profiles['belib-resident-flex'];
assert(resident?.subscriptionId==='belib-resident'&&resident.rules.length===3,'Profil résident Belib invalide');
assert(resident.rules.some(rule=>rule.start==='23:00'&&rule.end==='08:00'&&Math.abs(rule.pricePerKwh-.25)<1e-9),'Nuit résident Belib invalide');
const boost=data.profiles['belib-visitor-boost'];
assert(Math.abs(boost.rules[0].chargePerMinute-2.30/15)<1e-8,'Tarif Boost visiteur invalide');
assert(Math.abs(boost.rules[0].idlePerMinute-2.30/15)<1e-8,'La facturation Boost doit continuer jusqu’au débranchement');
assert(boost.rules[0].afterMinutesThreshold===840&&Math.abs(boost.rules[0].afterMinutesRate-10/60)<1e-8,'Frais de longue connexion Belib invalides');

const stationIds=new Set(),evseIds=new Set();let configLinks=0;
for(const station of data.stations){
  assert(station.stationId&&!stationIds.has(station.stationId),`Station Belib dupliquée : ${station.stationId}`);stationIds.add(station.stationId);
  assert(station.operatorSourceValue==='TOTALENERGIES'&&station.brandSourceValue==="Belib'",`Périmètre Belib invalide : ${station.stationId}`);
  const physical=new Set();
  for(const config of station.configurations||[]){
    assert(['AC','DC'].includes(config.kind)&&config.powerKw>0,`Configuration Belib invalide : ${station.stationId}`);
    assert(['flex','boost','boostPlus'].includes(config.serviceClass),`Classe Belib invalide : ${station.stationId}`);
    assert(config.pricingProfileIds?.length===3,`Offres directes Belib incomplètes : ${station.stationId}`);
    config.evseIds.forEach(id=>{physical.add(id);evseIds.add(id);configLinks++;});
  }
  assert(physical.size===station.chargePointCount,`EVSE Belib incohérents : ${station.stationId}`);
}
assert(evseIds.size===data.stats.chargePointCount,'Comptage EVSE Belib global incohérent');
assert(configLinks===data.stats.configurationEvseLinkCount,'Comptage liens configuration/EVSE Belib incohérent');
assert(!/parkingPerMinute|parkingCost|parkingCredit/i.test(text),'Une dimension monétaire de parking Belib a été trouvée');
console.log(JSON.stringify({stations:stationIds.size,evses:evseIds.size,profiles:Object.keys(data.profiles).length,parkingIncluded:false},null,2));
