import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadAsset(path){
  const registered=[];
  const document={addEventListener(){}};
  const window={TCCV8DirectPipeline:{registerPreparedEnricher(id,fn,priority){registered.push({id,fn,priority});return true;}}};
  const sandbox={window,document,console,fetch:async()=>{throw new Error('fixture test must not fetch')},setTimeout,clearTimeout,CustomEvent:class{}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path,'utf8'),sandbox,{filename:path});
  return {window,registered};
}

const q=loadAsset('assets/v8-qovoltis-direct.js');
assert.deepEqual(q.registered.map(x=>[x.id,x.priority]),[['qovoltis-direct',60]]);
const qapi=q.window.TCCV8QovoltisDirect;
assert.ok(qapi);

const qCatalog={
  dataset:'qovoltis-direct-safe-station-power-v1',
  policy:{failClosed:true},
  stations:[
    {stationId:'FRQOV7800027',refSite:'FR*QOV*78-00027',name:'Aérodrome Toussus',address:'Aérodrome de Toussus 78117',powers:[{powerKw:22,rankable:true,pricePerKwhEur:0.3504}]},
    {stationId:'FRQVI3300013',refSite:'FR*QVI*33-00013',name:'QVI Test',address:'1 rue de test 33000 Bordeaux',powers:[{powerKw:22,rankable:false,pricePerKwhEur:null,observedPricesEurPerKwh:[0.35,0.49],blockedReasons:['mixed_prices']}]}
  ]
};
const qStation={countryCode:'FR',operator:'Qovoltis',id_station:'FRQOV7800027',name:'Aérodrome Toussus',address:'Aérodrome de Toussus 78117',chargingConfigurations:[{id:'physical',kind:'AC',powerKw:22,stalls:1,pricing:{type:'kwh',pricePerKwh:9}}]};
const qOut=qapi.addOffers(qStation,qCatalog);
assert.equal(qOut.chargingConfigurations.length,2,'Qovoltis direct must append, never replace physical offers');
const qDirect=qOut.chargingConfigurations.find(x=>x.qovoltisDirectOffer);
assert.ok(qDirect,'Qovoltis direct offer expected');
assert.equal(qDirect.offerProvider,'Qovoltis direct');
assert.equal(qDirect.offerType,'operator_direct');
assert.equal(qDirect.pricing.rules[0].pricePerKwh,0.3504);
assert.equal(qDirect.qovoltisStatusSeparated,true);
assert.equal(qDirect.subscriptionId,undefined,'Qovoltis direct is not a subscription fallback');
assert.equal(qStation.chargingConfigurations.length,1,'input station must not be mutated');

const qUnsafe={countryCode:'FR',operator:'Qovoltis',id_station:'FRQVI3300013',name:'QVI Test',address:'1 rue de test 33000 Bordeaux',chargingConfigurations:[{kind:'AC',powerKw:22}]};
assert.equal(qapi.addOffers(qUnsafe,qCatalog).chargingConfigurations.length,1,'ambiguous/mixed Qovoltis power must fail closed');
const qWrongOperator={countryCode:'FR',operator:'Other',name:'Aérodrome Toussus',address:'Aérodrome de Toussus 78117',chargingConfigurations:[{kind:'AC',powerKw:22}]};
assert.equal(qapi.addOffers(qWrongOperator,qCatalog).chargingConfigurations.length,1,'name/address fallback is forbidden outside Qovoltis');

const a=loadAsset('assets/v8-avia-picoty-reference.js');
assert.deepEqual(a.registered.map(x=>[x.id,x.priority]),[['avia-picoty-reference',70]]);
const aapi=a.window.TCCV8AviaPicoty;
assert.ok(aapi);
const aCatalog={dataset:'avia-volt-picoty-reference-stations-v1',policy:{failClosed:true,rankableTariffAvailable:false},stations:[{stationId:'FRPY27800001',stationName:'AVIA VOLT TEST',address:'10 rue test 78000 Versailles',powerKw:[22,180],pdcIds:['FRPY2E1']} ]};
const aStation={countryCode:'FR',operator:'Picoty',id_station:'FRPY27800001',name:'AVIA VOLT TEST',address:'10 rue test 78000 Versailles',chargingConfigurations:[{kind:'AC',powerKw:22}]};
const aOut=aapi.markStation(aStation,aCatalog);
assert.equal(aOut._tccAviaPicoty,true);
assert.equal(aOut._tccAviaPicotyRankable,false);
assert.equal(aOut.chargingConfigurations.length,1,'AVIA reference adapter must never add a rankable offer');
assert.equal(aOut.chargingConfigurations[0].offerProvider,undefined);
const genericAvia={countryCode:'FR',operator:'AVIA',name:'AVIA VOLT TEST',address:'10 rue test 78000 Versailles',chargingConfigurations:[{kind:'AC',powerKw:22}]};
assert.strictEqual(aapi.markStation(genericAvia,aCatalog),genericAvia,'generic AVIA must not inherit Picoty pricing/reference by name');
const exactIdOtherLabel={countryCode:'FR',operator:'Unknown',externalStationId:'FRPY27800001',chargingConfigurations:[{kind:'DC',powerKw:180}]};
assert.equal(aapi.markStation(exactIdOtherLabel,aCatalog)._tccAviaPicoty,true,'exact FRPY2 identifier is sufficient');

console.log('V8 AVIA Picoty + Qovoltis adapter tests: OK');
