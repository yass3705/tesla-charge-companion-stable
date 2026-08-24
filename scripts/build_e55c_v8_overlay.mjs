import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const input=process.argv[2]||'electric55_stations_france.json';
const output=process.argv[3]||'data/e55c_station_tariffs_v1.json.gz';
const SOURCE_URL='https://github.com/yass3705/tesla-charge-companion-data-lab/blob/main/data/national/electric55_stations_france.json';

function assert(condition,message){if(!condition)throw new Error(message);}
function text(value){return String(value==null?'':value).trim();}
function number(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function round(value,digits=6){const n=number(value);return n==null?null:Number(n.toFixed(digits));}
function unique(values){return [...new Set(values.filter(Boolean).map(text))].sort((a,b)=>a.localeCompare(b,'fr'));}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}

function normalizeProfile(profile){
  const sourceRules=Array.isArray(profile?.rules)?profile.rules:[];
  const flat=sourceRules.reduce((sum,rule)=>sum+Math.max(0,number(rule?.flatEur)||0),0);
  const variable=sourceRules.filter(rule=>
    number(rule?.energyEurPerKwh)>0||
    number(rule?.chargingTimeEurPerMinute)>0||
    number(rule?.parkingTimeEurPerMinute)>0
  );
  assert(variable.length,`Profil E55C sans dimension variable : ${profile?.profileId}`);
  const rules=variable.map(rule=>{
    const energy=Math.max(0,number(rule.energyEurPerKwh)||0);
    const charging=Math.max(0,number(rule.chargingTimeEurPerMinute)||0);
    const parking=Math.max(0,number(rule.parkingTimeEurPerMinute)||0);
    assert(energy>0||charging>0,`Profil E55C non simulable : ${profile.profileId}`);
    return {
      scope:rule.scope==='timeWindow'?'timeWindow':'allDay',
      start:text(rule.start)||'00:00',
      end:text(rule.end)||'24:00',
      billing:energy>0?'kwh':'minute',
      currency:text(rule.currency||profile.currency||'EUR').toUpperCase(),
      pricePerKwh:round(energy),
      chargePerMinute:round(charging),
      parkingPerMinute:0,
      connectionFee:round(flat),
      idlePerMinute:round(parking),
      afterMinutesRate:0,
      afterMinutesThreshold:0,
      afterMinutesCap:0,
      afterMinutesCapStart:'00:00',
      afterMinutesCapEnd:'24:00',
      e55cDirect:true,
      e55cParkingPhase:'parked_not_charging',
      e55cTaxIncluded:profile.taxIncluded===true,
      e55cSourceDefinitionId:text(rule.sourceDefinitionId)
    };
  });
  return {
    profileId:text(profile.profileId),
    channel:'E55C Scan Pay',
    currency:text(profile.currency||'EUR').toUpperCase(),
    taxIncluded:profile.taxIncluded===true,
    displayTextFr:text(profile.displayTextFr),
    chargingAndParkingDimensionsSeparated:true,
    parkingTimeSemantics:'parked_not_charging',
    simultaneousChargingAndParking:false,
    rules
  };
}

function pointStatus(point,profiles){
  const profileId=text(point?.pricing?.profileId);
  if(point?.pricing?.status==='resolved_e55c_scan_pay'&&profileId&&profiles[profileId])return 'resolved_e55c_scan_pay';
  return 'missing_direct_tariff';
}

function normalizeStation(station,profiles){
  assert(station?.operatorSourceValue==='ELECTRIC 55 CHARGING',`Opérateur hors périmètre : ${station?.stationId}`);
  const lat=number(station?.coordinates?.latitude),lon=number(station?.coordinates?.longitude);
  assert(lat!=null&&lat>=-90&&lat<=90&&lon!=null&&lon>=-180&&lon<=180,`Coordonnées invalides : ${station?.stationId}`);
  const groups=new Map();
  for(const point of station.chargePoints||[]){
    const evseId=text(point.evseId),localEvseId=text(point.localEvseId);
    assert(evseId,`EVSE manquant : ${station.stationId}`);
    const status=pointStatus(point,profiles),profileId=status==='resolved_e55c_scan_pay'?text(point.pricing.profileId):'';
    const kind=text(point.kind||'AC').toUpperCase(),powerKw=round(point.powerKw,3);
    assert(['AC','DC'].includes(kind)&&powerKw>0,`Configuration invalide : ${evseId}`);
    const key=[kind,powerKw,profileId||'unresolved',status].join('|');
    let group=groups.get(key);
    if(!group){
      group={kind,powerKw,priceStatus:status,pricingProfileId:profileId||null,evseIds:[],localEvseIds:[],paymentUrls:[]};
      groups.set(key,group);
    }
    group.evseIds.push(evseId);
    if(localEvseId)group.localEvseIds.push(localEvseId);
    if(point?.directAccess?.available===true&&text(point?.directAccess?.paymentUrl))group.paymentUrls.push(text(point.directAccess.paymentUrl));
  }
  const configurations=[...groups.values()].map(group=>({
    ...group,
    evseIds:unique(group.evseIds),
    localEvseIds:unique(group.localEvseIds),
    paymentUrls:unique(group.paymentUrls),
    stalls:unique(group.evseIds).length
  })).sort((a,b)=>a.kind.localeCompare(b.kind)||a.powerKw-b.powerKw||text(a.pricingProfileId).localeCompare(text(b.pricingProfileId)));
  return {
    stationId:text(station.stationId),
    localStationId:text(station.localStationId),
    name:text(station.name),
    address:text(station.address),
    postalCode:text(station.postalCode),
    city:text(station.city),
    coordinates:[round(lat),round(lon)],
    operator:'Electric 55 Charging (E55C)',
    operatorSourceValue:'ELECTRIC 55 CHARGING',
    access:{hours:text(station?.access?.hours)||'',condition:text(station?.access?.condition)||''},
    chargePointCount:Number(station.chargePointCount||0),
    maxPowerKw:round(station.maxPowerKw,3),
    connectorTypes:unique(station.connectorTypes||[]),
    configurations
  };
}

const sourceRaw=fs.readFileSync(input,'utf8');
const source=JSON.parse(sourceRaw);
assert(source?.dataset==='electric55-operated-stations-france',`Dataset source inattendu : ${source?.dataset}`);
assert(source?.scope?.dynamicStatusIncluded===false,'La source E55C ne doit contenir aucun statut dynamique');
assert(source?.scope?.thirdPartySupervisedStationsWithoutE55CAsOperatorExcluded===true,'Le filtre CPO strict E55C est absent');
assert(Array.isArray(source.directTariffProfiles)&&source.directTariffProfiles.length>0,'Profils tarifaires E55C absents');
assert(Array.isArray(source.stations)&&source.stations.length>0,'Stations E55C absentes');

const profiles=Object.fromEntries(source.directTariffProfiles.map(profile=>{
  const normalized=normalizeProfile(profile);
  assert(normalized.profileId,'Identifiant de profil E55C manquant');
  return [normalized.profileId,normalized];
}).sort((a,b)=>a[0].localeCompare(b[0])));
const stations=source.stations.map(station=>normalizeStation(station,profiles)).sort((a,b)=>a.stationId.localeCompare(b.stationId));
const stationIds=new Set(),evseIds=new Set();
let chargePointCount=0,resolvedPointCount=0,directPaymentPointCount=0;
for(const station of stations){
  assert(station.stationId&&!stationIds.has(station.stationId),`Station E55C dupliquée : ${station.stationId}`);stationIds.add(station.stationId);
  for(const config of station.configurations){
    chargePointCount+=config.stalls;
    if(config.priceStatus==='resolved_e55c_scan_pay')resolvedPointCount+=config.stalls;
    directPaymentPointCount+=config.paymentUrls.length;
    for(const id of config.evseIds){assert(!evseIds.has(id),`EVSE E55C dupliquée : ${id}`);evseIds.add(id);}
  }
}
assert(chargePointCount===Number(source?.stats?.chargePointCount),`Comptage PDC incohérent : ${chargePointCount}`);
assert(resolvedPointCount/Math.max(1,chargePointCount)>=.95,`Couverture tarifaire E55C insuffisante : ${resolvedPointCount}/${chargePointCount}`);

const payload={
  schemaVersion:1,
  dataset:'e55c-operated-france-tcc-v8',
  generatedAt:text(source.generatedAt),
  source:{url:SOURCE_URL,dataset:text(source.dataset),schemaVersion:text(source.schemaVersion),semanticSha256:sha256(sourceRaw)},
  scope:{
    target:'Tesla Charge Companion V8',
    activeInV73:false,
    strictOperatorField:'nom_operateur',
    strictOperatorValue:'ELECTRIC 55 CHARGING',
    thirdPartySupervisedStationsExcluded:true,
    operatorDirectTariffsOnly:true,
    thirdPartyEmspTariffsExcluded:true,
    dynamicStatusIncluded:false,
    dynamicStatusAuthorityForTcc:['Electroverse','Electra'],
    parkingTimeSemantics:'parked_not_charging',
    unresolvedTariffsRemainUnranked:true
  },
  stats:{
    stationCount:stations.length,
    chargePointCount,
    resolvedPointCount,
    unresolvedPointCount:chargePointCount-resolvedPointCount,
    directPaymentPointCount,
    pricingCoverage:Number((resolvedPointCount/Math.max(1,chargePointCount)).toFixed(6)),
    profileCount:Object.keys(profiles).length
  },
  profiles,
  stations
};

fs.mkdirSync(path.dirname(output),{recursive:true});
const serialized=JSON.stringify(payload)+'\n';
fs.writeFileSync(output,output.endsWith('.gz')?zlib.gzipSync(Buffer.from(serialized),{level:9,mtime:0}):serialized);
console.log(JSON.stringify({output,...payload.stats,bytes:fs.statSync(output).size},null,2));
