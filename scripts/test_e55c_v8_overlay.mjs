import fs from 'node:fs';
import zlib from 'node:zlib';

const file=process.argv[2]||'data/e55c_station_tariffs_v1.json.gz';
const raw=fs.readFileSync(file);
const data=JSON.parse((file.endsWith('.gz')?zlib.gunzipSync(raw):raw).toString('utf8'));
function assert(condition,message){if(!condition)throw new Error(message);}

assert(data?.schemaVersion===1,'Schéma E55C V8 invalide');
assert(data?.dataset==='e55c-operated-france-tcc-v8','Dataset E55C V8 invalide');
assert(data?.scope?.activeInV73===false,'La V7.3 ne doit pas charger E55C V8');
assert(data?.scope?.strictOperatorField==='nom_operateur','Filtre opérateur strict absent');
assert(data?.scope?.strictOperatorValue==='ELECTRIC 55 CHARGING','Valeur opérateur stricte invalide');
assert(data?.scope?.thirdPartySupervisedStationsExcluded===true,'Les stations tierces supervisées doivent être exclues');
assert(data?.scope?.dynamicStatusIncluded===false,'Aucun statut dynamique E55C ne doit être embarqué');
assert(data?.scope?.parkingTimeSemantics==='parked_not_charging','Sémantique PARKING_TIME E55C invalide');
assert(data?.scope?.unresolvedTariffsRemainUnranked===true,'Les tarifs non résolus doivent rester non classés');
assert(Array.isArray(data.stations)&&data.stations.length>=500,'Inventaire E55C trop petit');
assert(data.stats.stationCount===data.stations.length,'Comptage stations incohérent');

const stationIds=new Set(),evseIds=new Set(),profiles=data.profiles||{};
let points=0,resolved=0,unresolved=0,payments=0;
for(const [profileId,profile] of Object.entries(profiles)){
  assert(profile.profileId===profileId,`Profil mal indexé : ${profileId}`);
  assert(profile.taxIncluded===true,`TVA non incluse : ${profileId}`);
  assert(profile.parkingTimeSemantics==='parked_not_charging',`Sémantique stationnement absente : ${profileId}`);
  assert(profile.simultaneousChargingAndParking===false,`Charge et stationnement ne doivent jamais être simultanés : ${profileId}`);
  assert(Array.isArray(profile.rules)&&profile.rules.length,'Règles absentes');
  for(const rule of profile.rules){
    assert(rule.e55cDirect===true,`Marqueur direct absent : ${profileId}`);
    assert(Number(rule.connectionFee)>=0,'Frais fixe invalide');
    assert(Number(rule.pricePerKwh)>0||Number(rule.chargePerMinute)>0,'Dimension de charge absente');
    assert(Number(rule.parkingPerMinute||0)===0,'Le stationnement E55C ne doit jamais être facturé pendant la charge');
    assert(Number(rule.idlePerMinute)>0,'Dimension stationnement après charge E55C absente');
    assert(rule.e55cParkingPhase==='parked_not_charging','Marqueur PARKING_TIME E55C absent');
  }
}
for(const station of data.stations){
  assert(station.operatorSourceValue==='ELECTRIC 55 CHARGING',`Opérateur hors périmètre : ${station.stationId}`);
  assert(station.stationId&&!stationIds.has(station.stationId),`Station dupliquée : ${station.stationId}`);stationIds.add(station.stationId);
  assert(Array.isArray(station.coordinates)&&station.coordinates.length===2&&station.coordinates.every(Number.isFinite),`GPS invalide : ${station.stationId}`);
  for(const config of station.configurations||[]){
    assert(config.stalls===config.evseIds.length,`Stalls incohérents : ${station.stationId}`);
    points+=config.stalls;payments+=config.paymentUrls.length;
    if(config.priceStatus==='resolved_e55c_scan_pay'){
      resolved+=config.stalls;
      assert(config.pricingProfileId&&profiles[config.pricingProfileId],`Profil absent : ${station.stationId}`);
    }else{
      unresolved+=config.stalls;
      assert(config.pricingProfileId===null,`Profil extrapolé sur un tarif non résolu : ${station.stationId}`);
    }
    for(const id of config.evseIds){assert(!evseIds.has(id),`EVSE dupliquée : ${id}`);evseIds.add(id);}
  }
}
assert(points===data.stats.chargePointCount,'Comptage PDC invalide');
assert(resolved===data.stats.resolvedPointCount,'Comptage tarifs résolus invalide');
assert(unresolved===data.stats.unresolvedPointCount,'Comptage tarifs non résolus invalide');
assert(payments===data.stats.directPaymentPointCount,'Comptage paiements directs invalide');
assert(resolved/points>=.95,'Couverture tarifaire inférieure à 95 %');

const serialized=JSON.stringify(data);
for(const forbidden of ['operationalStatus','availabilityStatus','occupiedConnectors'])assert(!serialized.includes(`"${forbidden}"`),`Champ dynamique interdit : ${forbidden}`);
console.log(JSON.stringify({stations:stationIds.size,chargePoints:points,resolved,unresolved,payments,profiles:Object.keys(profiles).length},null,2));
