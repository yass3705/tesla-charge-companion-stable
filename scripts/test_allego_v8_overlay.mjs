import fs from 'node:fs';
import vm from 'node:vm';

function assert(condition,message){if(!condition)throw new Error(message);}
const code=fs.readFileSync('assets/v8-allego-direct.js','utf8');
const sandbox={
  console,
  fetch:async()=>{throw new Error('fetch interdit dans le test synthétique');},
  candidateStations:async()=>({origin:{lat:48.8,lon:2.0,label:'test'},stations:[]}),
  window:null,
  DecompressionStream:function(){},Blob:function(){},Response:function(){}
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(code,sandbox);
const api=sandbox.TCCAllegoDirectV8;
assert(api,'API Allego V8 absente');
assert(api.isAllegoOperator({operator:'Allego'}),'Opérateur Allego non reconnu');
assert(!api.isAllegoOperator({operator:'Electroverse'}),'Electroverse reconnu comme Allego');

const record={
  name:'Allego Test',address:'1 rue Test',irveAddress:'1 rue Test, France',coordinates:[48.8001,2.0001],irveStationIds:['FR*ALG*S0001'],rankableDirect:true,pricingStatus:'exact_official_station_partial',stationPageUrl:'https://www.allego.eu/charging-station/test/',
  evses:[
    {evseId:'FRALLEGO000011',kind:'AC',powerKw:22,directEurPerKwh:.36,dxpChargePointId:'FRALLEGO00001'},
    {evseId:'FRALLEGO000012',kind:'DC',powerKw:300,directEurPerKwh:.59,dxpChargePointId:'FRALLEGO00001'},
    {evseId:'FRALLEGO000013',kind:'DC',powerKw:50,directEurPerKwh:null,dxpChargePointId:'FRALLEGO00001'}
  ]
};
const configs=api.directConfigurations(record);
assert(configs.length===2,`Configurations Allego exactes attendues=2, obtenu=${configs.length}`);
assert(configs.every(config=>config.allegoDirect===true&&config.allegoVerified===true&&config.offerType==='operator_direct'),'Configuration Allego non marquée directe/vérifiée');
assert(configs.some(config=>config.kind==='AC'&&config.powerKw===22&&config.pricing.rules[0].pricePerKwh===.36),'Tarif AC 0,36 absent');
assert(configs.some(config=>config.kind==='DC'&&config.powerKw===300&&config.pricing.rules[0].pricePerKwh===.59),'Tarif DC 0,59 absent');
assert(!configs.some(config=>config.powerKw===50),'EVSE non tarifé rendu rankable');

sandbox.TCC_ALLEGO_DIRECT_CATALOG_V1={generatedAt:'2026-08-26T00:00:00Z'};
const existingRoaming={id:'roaming',label:'Electroverse · DC 300 kW',kind:'DC',powerKw:300,stalls:2,offerProvider:'Electroverse',pricing:{type:'rules',rules:[{billing:'kwh',currency:'EUR',pricePerKwh:.69}]}};
const baseStation={id:'france-catalog:electroverse:test',catalogStationId:'electroverse:test',name:'Allego Test',address:'1 rue Test',latitude:48.8,longitude:2,operator:'Allego',chargingConfigurations:[existingRoaming],pricing:existingRoaming.pricing,kind:'DC',powerKw:300,stalls:2,_airKm:.02,operationalStatus:'available'};
const data={stations:[record],counts:{}};
const prepared={origin:{lat:48.8,lon:2,label:'test'},stations:[baseStation]};
const merged=api.overlayPrepared(prepared,data,20);
assert(merged.stations.length===1,'La station Allego correspondante a été dupliquée');
const station=merged.stations[0];
assert(station.allegoStrictCpo===true&&station.allegoDirectPricingContext==='official_dxp','Contexte CPO Allego invalide');
assert(station.operationalStatus==='available','Statut source perdu pendant la fusion');
assert(station.chargingConfigurations.some(config=>config.offerProvider==='Electroverse'),'Offre Electroverse existante supprimée');
assert(station.chargingConfigurations.filter(config=>config.allegoDirect).length===2,'Offres directes Allego mal fusionnées');
assert(station.allegoDirectEvseCount===2,'Nombre EVSE Allego directs incorrect');

const second={...record,name:'Allego Standalone',irveStationIds:['FR*ALG*S0002'],coordinates:[48.81,2.01],evses:[{evseId:'FRALLEGO000021',kind:'AC',powerKw:22,directEurPerKwh:.39,dxpChargePointId:'FRALLEGO00002'}]};
const withStandalone=api.overlayPrepared({origin:{lat:48.8,lon:2,label:'test'},stations:[]},{stations:[second]},20);
assert(withStandalone.stations.length===1,'Station Allego officielle manquante non ajoutée');
assert(Number.isFinite(withStandalone.stations[0]._airKm),'Distance de repli de la station ajoutée absente');
assert(withStandalone.stations[0].chargingConfigurations[0].pricing.rules[0].pricePerKwh===.39,'Tarif exact station ajoutée incorrect');

console.log(JSON.stringify({directConfigs:configs.length,matched:merged.allegoMergeStats.matched,added:withStandalone.allegoMergeStats.added,directEvses:station.allegoDirectEvseCount},null,2));
