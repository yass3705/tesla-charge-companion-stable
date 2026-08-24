import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const input=process.argv[2]||'belib_stations_paris.json';
const output=process.argv[3]||'data/belib_station_tariffs_v1.json.gz';
const SOURCE_URL='https://github.com/yass3705/tesla-charge-companion-data-lab/blob/main/data/national/belib_stations_paris.json';

function assert(condition,message){if(!condition)throw new Error(message);}
function text(value){return String(value==null?'':value).trim();}
function number(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function round(value,digits=9){const n=number(value);return n==null?null:Number(n.toFixed(digits));}
function unique(values){return [...new Set((values||[]).filter(Boolean).map(text))].sort((a,b)=>a.localeCompare(b,'fr'));}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function clone(value){return JSON.parse(JSON.stringify(value));}

function normalizeRule(rule,profileId){
  const energy=Math.max(0,number(rule?.energyEurPerKwh)||0);
  const charge=Math.max(0,number(rule?.chargeTimeEurPerMinute)||0);
  const idle=Math.max(0,number(rule?.idleTimeEurPerMinute)||0);
  const connected=Math.max(0,number(rule?.connectedTimeEurPerMinute)||0);
  const longRate=Math.max(0,number(rule?.longConnectionEurPerMinute)||0);
  const threshold=Math.max(0,Math.round(number(rule?.longConnectionThresholdMinutes)||0));
  assert(energy>0||charge>0,`Profil Belib non simulable : ${profileId}`);
  const normalized={
    scope:rule?.scope==='timeWindow'?'timeWindow':'allDay',
    start:text(rule?.start)||'00:00',
    end:text(rule?.end)||'24:00',
    billing:energy>0?'kwh':'minute',
    currency:text(rule?.currency||'EUR').toUpperCase(),
    pricePerKwh:round(energy),
    chargePerMinute:round(charge),
    connectionFee:0,
    idlePerMinute:round(idle),
    afterMinutesRate:round(longRate),
    afterMinutesThreshold:threshold,
    afterMinutesCap:0,
    afterMinutesCapStart:'00:00',
    afterMinutesCapEnd:'24:00',
    belibConnectedTimePerMinute:round(connected),
    belibDirect:true,
    belibParkingExcluded:true
  };
  assert(!('parkingPerMinute' in normalized)&&!('parkingCost' in normalized),`Frais de parking Belib détectés : ${profileId}`);
  return normalized;
}

function normalizeProfile(profile){
  const profileId=text(profile?.profileId);
  assert(profileId.startsWith('belib-'),`Identifiant de profil Belib invalide : ${profileId}`);
  assert(['flex','boost','boostPlus'].includes(text(profile?.serviceClass)),`Classe Belib invalide : ${profileId}`);
  assert(profile?.parkingFeesIncluded===false,`Le parking ne doit pas être intégré : ${profileId}`);
  assert(profile?.reservationFeesIncluded===false,`La réservation ne doit pas être imputée automatiquement : ${profileId}`);
  const rules=(profile?.rules||[]).map(rule=>normalizeRule(rule,profileId));
  assert(rules.length,`Profil Belib vide : ${profileId}`);
  return {
    profileId,
    channel:'Belib direct',
    customerPlan:text(profile.customerPlan),
    customerPlanLabelFr:text(profile.customerPlanLabelFr),
    subscriptionId:text(profile.subscriptionId)||null,
    annualFeeEur:round(profile.annualFeeEur||0,2),
    serviceClass:text(profile.serviceClass),
    taxIncluded:profile.taxIncluded===true,
    parkingFeesIncluded:false,
    reservationFeesIncluded:false,
    rules
  };
}

function normalizeStation(station,profileIdsByClass){
  assert(station?.operatorSourceValue==='TOTALENERGIES',`Opérateur Belib hors périmètre : ${station?.stationId}`);
  assert(station?.brandSourceValue==="Belib'",`Enseigne hors périmètre Belib : ${station?.stationId}`);
  const lat=number(station?.coordinates?.latitude),lon=number(station?.coordinates?.longitude);
  assert(lat!=null&&lat>=-90&&lat<=90&&lon!=null&&lon>=-180&&lon<=180,`Coordonnées Belib invalides : ${station?.stationId}`);
  const configurations=(station?.configurations||[]).map((config,index)=>{
    const klass=text(config?.serviceClass),kind=text(config?.kind).toUpperCase(),power=round(config?.powerKw,3);
    const evseIds=unique(config?.evseIds),profileIds=profileIdsByClass.get(klass)||[];
    assert(['AC','DC'].includes(kind)&&power>0,`Configuration Belib invalide : ${station.stationId}/${index}`);
    assert(['flex','boost','boostPlus'].includes(klass),`Classe Belib absente : ${station.stationId}/${index}`);
    assert(evseIds.length&&profileIds.length===3,`EVSE ou profils Belib incomplets : ${station.stationId}/${index}`);
    return {
      kind,powerKw:power,serviceClass:klass,stalls:evseIds.length,
      connectorTypes:unique(config.connectorTypes),evseIds,
      roamingEvseIds:unique(config.roamingEvseIds),pricingProfileIds:[...profileIds]
    };
  }).sort((a,b)=>a.kind.localeCompare(b.kind)||a.powerKw-b.powerKw||a.serviceClass.localeCompare(b.serviceClass));
  assert(configurations.length,`Station Belib sans configuration : ${station?.stationId}`);
  return {
    stationId:text(station.stationId),
    roamingStationId:text(station.roamingStationId),
    name:text(station.name),address:text(station.address),postalCode:text(station.postalCode),city:text(station.city)||'Paris',
    coordinates:[round(lat,7),round(lon,7)],operator:"Belib'",operatorSourceValue:'TOTALENERGIES',brandSourceValue:"Belib'",
    access:{hours:text(station?.access?.hours)||'24/7',condition:text(station?.access?.condition)||'Accès libre'},
    payment:clone(station.payment||{}),lastUpdated:text(station.lastUpdated),
    chargePointCount:Number(station.chargePointCount||0),maxPowerKw:round(station.maxPowerKw,3),
    connectorTypes:unique(station.connectorTypes),configurations
  };
}

const sourceRaw=fs.readFileSync(input,'utf8');
const source=JSON.parse(sourceRaw);
assert(source?.dataset==='belib-operated-stations-paris',`Dataset Belib source inattendu : ${source?.dataset}`);
assert(source?.scope?.strictOperatorField==='nom_operateur'&&source?.scope?.strictOperatorValue==='TOTALENERGIES','Filtre opérateur Belib invalide');
assert(source?.scope?.strictBrandField==='nom_enseigne'&&source?.scope?.strictBrandValue==="Belib'",'Filtre enseigne Belib invalide');
assert(source?.scope?.thirdPartyRoamingStationsExcluded===true,'Les stations seulement itinérantes doivent être exclues');
assert(source?.scope?.parkingFeesIncluded===false,'Le parking ne doit pas être intégré à Belib');
assert(source?.scope?.dynamicStatusIncluded===false,'Le statut Belib ne doit pas être figé dans le catalogue statique');
assert(Array.isArray(source?.stations)&&source.stations.length>=350,'Inventaire Belib incomplet');
assert(Array.isArray(source?.directTariffProfiles)&&source.directTariffProfiles.length===9,'Profils Belib incomplets');

const profiles=Object.fromEntries(source.directTariffProfiles.map(item=>{
  const normalized=normalizeProfile(item);return [normalized.profileId,normalized];
}).sort((a,b)=>a[0].localeCompare(b[0])));
const profileIdsByClass=new Map();
for(const profile of Object.values(profiles)){
  if(!profileIdsByClass.has(profile.serviceClass))profileIdsByClass.set(profile.serviceClass,[]);
  profileIdsByClass.get(profile.serviceClass).push(profile.profileId);
}
for(const ids of profileIdsByClass.values())ids.sort((a,b)=>a.localeCompare(b));

const stations=source.stations.map(station=>normalizeStation(station,profileIdsByClass)).sort((a,b)=>a.stationId.localeCompare(b.stationId));
const stationIds=new Set(),evseIds=new Set();let configurationEvseLinkCount=0;
for(const station of stations){
  assert(station.stationId&&!stationIds.has(station.stationId),`Station Belib dupliquée : ${station.stationId}`);stationIds.add(station.stationId);
  const physical=new Set();
  for(const config of station.configurations){
    configurationEvseLinkCount+=config.evseIds.length;
    config.evseIds.forEach(id=>{physical.add(id);evseIds.add(id);});
  }
  assert(physical.size===station.chargePointCount,`Comptage EVSE Belib incohérent : ${station.stationId}`);
}
assert(stations.length===Number(source?.stats?.stationCount),`Comptage stations Belib incohérent : ${stations.length}`);
assert(evseIds.size===Number(source?.stats?.chargePointCount),`Comptage EVSE Belib incohérent : ${evseIds.size}`);

const payload={
  schemaVersion:1,
  dataset:'belib-operated-paris-tcc-v8',
  generatedAt:text(source.generatedAt),
  source:{url:SOURCE_URL,dataset:text(source.dataset),schemaVersion:text(source.schemaVersion),semanticSha256:sha256(sourceRaw)},
  scope:{
    target:'Tesla Charge Companion V8',activeInV73:false,
    strictOperatorField:'nom_operateur',strictOperatorValue:'TOTALENERGIES',
    strictBrandField:'nom_enseigne',strictBrandValue:"Belib'",
    thirdPartyRoamingStationsExcluded:true,teslaCompatibleConnectorsOnly:true,
    operatorDirectTariffsOnly:true,thirdPartyEmspTariffsExcluded:true,
    parkingFeesIncluded:false,reservationFeesIncluded:false,
    dynamicStatusIncluded:false,runtimeLiveStatusUrl:text(source.scope.liveStatusRuntimeSource),
    unresolvedTariffsRemainUnranked:true
  },
  stats:{
    stationCount:stations.length,chargePointCount:evseIds.size,configurationEvseLinkCount,
    profileCount:Object.keys(profiles).length
  },
  profiles,stations
};

const serialized=JSON.stringify(payload)+'\n';
assert(!/parkingPerMinute|parkingCost|parkingCredit/i.test(serialized),'Une dimension monétaire de parking Belib a été générée');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,output.endsWith('.gz')?zlib.gzipSync(Buffer.from(serialized),{level:9,mtime:0}):serialized);
console.log(JSON.stringify({output,...payload.stats,bytes:fs.statSync(output).size},null,2));
