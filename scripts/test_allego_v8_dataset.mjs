import fs from 'node:fs';
import zlib from 'node:zlib';

function assert(condition,message){if(!condition)throw new Error(message);}
const path=process.argv[2]||'data/allego_direct_stations_france.json.gz';
const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString('utf8'));
const counts=data.counts||{};
assert(data.dataset==='allego-direct-operated-stations-france','Dataset Allego inattendu');
assert(data.operator==='Allego'&&data.country==='FR','Périmètre pays/opérateur Allego invalide');
assert(data.scope?.operatorDirectOnly===true,'operatorDirectOnly doit être true');
assert(data.scope?.roamingIncluded===false,'Aucun tarif d’itinérance ne doit être inclus');
assert(data.scope?.countryDefaultsAreRankable===false,'Les tarifs pays ne doivent pas être rankables');
assert(data.scope?.exactDirectPricesFromDxp===true,'Tarifs DXP exacts absents');
assert(Array.isArray(data.stations)&&data.stations.length>=300,'Inventaire Allego France insuffisant');
assert(Number(counts.franceEvseCount)>=2000,'Nombre EVSE Allego insuffisant');
assert(Number(counts.dxpPricedEvseCount)>=1500&&Number(counts.dxpPricedEvsePct)>=60,'Couverture DXP insuffisante');
assert(Number(counts.irveLinkedEvseCount)>=2000&&Number(counts.stationsWithCoordinates)>=300,'Rattachement IRVE insuffisant');

let priced=0,rankable=0,invalid=0;
const distinct=new Set();
for(const station of data.stations){
  if(station.rankableDirect){
    rankable++;
    assert(Array.isArray(station.coordinates)&&station.coordinates.length>=2,`Coordonnées absentes: ${station.name}`);
    assert(Number.isFinite(Number(station.coordinates[0]))&&Number.isFinite(Number(station.coordinates[1])),`Coordonnées invalides: ${station.name}`);
  }
  for(const evse of station.evses||[]){
    if(evse.directEurPerKwh==null)continue;
    const price=Number(evse.directEurPerKwh);priced++;distinct.add(price.toFixed(3));
    if(!(price>=.05&&price<=2))invalid++;
  }
}
assert(invalid===0,`Prix Allego hors garde-fou: ${invalid}`);
assert(priced===Number(counts.dxpPricedEvseCount),`Compte EVSE tarifés incohérent: ${priced}/${counts.dxpPricedEvseCount}`);
assert(rankable>=250,`Stations Allego rankables insuffisantes: ${rankable}`);
assert(distinct.size>=2,'Aucune variation tarifaire Allego observée: risque de tarif national généralisé');
console.log(JSON.stringify({stations:data.stations.length,evses:counts.franceEvseCount,pricedEvses:priced,pricedPct:counts.dxpPricedEvsePct,rankableStations:rankable,distinctDirectPrices:[...distinct].sort()},null,2));
