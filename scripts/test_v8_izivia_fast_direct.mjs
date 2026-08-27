import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const registered=[];
const document={addEventListener(){}};
const window={TCCV8DirectPipeline:{registerPreparedEnricher(id,fn,priority){registered.push({id,fn,priority});return true;}}};
const sandbox={window,document,console,fetch:async()=>{throw new Error('fixture test must not fetch')},setTimeout,clearTimeout,CustomEvent:class{}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/v8-izivia-fast-direct.js','utf8'),sandbox,{filename:'assets/v8-izivia-fast-direct.js'});
assert.deepEqual(registered.map(x=>[x.id,x.priority]),[['izivia-fast-direct',55]]);
const api=window.TCCV8IziviaFastDirect;
assert.ok(api);

const catalog={
  schemaVersion:'1.0.0',dataset:'izivia-fast-direct-france-v1',generatedAt:'2026-08-27',
  scope:{countryCode:'FR',network:'IZIVIA FAST',operator:'IZIVIA',onlyDirectCpo:true,roamingIncluded:false,subscriptionDiscountsIncluded:false,failClosed:true},
  matching:{operatorAliases:['izivia','sodetrel'],stationHintsAny:['izivia fast','mcdonald'],dcOnly:true},
  tariff:{currency:'EUR',billing:'kwh',windows:[
    {start:'00:00',end:'11:30',pricePerKwh:.30,label:'Happy Hour'},
    {start:'11:30',end:'15:00',pricePerKwh:.35,label:'Standard'},
    {start:'15:00',end:'18:00',pricePerKwh:.30,label:'Happy Hour'},
    {start:'18:00',end:'24:00',pricePerKwh:.35,label:'Standard'}
  ]}
};
api.validateCatalog(catalog);

const station={
  countryCode:'FR',operator:'Izivia',network:'IZIVIA FAST',name:"IZIVIA FAST McDonald's Les Clayes Sous Bois",
  chargingConfigurations:[
    {id:'electra',offerProvider:'Electra',kind:'DC',powerKw:380,stalls:3,pricing:{type:'kwh',pricePerKwh:.30}},
    {id:'electroverse',offerProvider:'Electroverse',kind:'DC',powerKw:380,stalls:3,pricing:{type:'kwh',pricePerKwh:.35}}
  ]
};
const out=api.addOffers(station,catalog);
assert.equal(station.chargingConfigurations.length,2,'input station must not be mutated');
assert.equal(out.chargingConfigurations.length,3,'IZIVIA FAST direct must be appended beside Electra/Electroverse');
const direct=out.chargingConfigurations.find(x=>x.iziviaFastDirectOffer);
assert.ok(direct,'IZIVIA direct offer expected');
assert.equal(direct.offerProvider,'IZIVIA direct');
assert.equal(direct.offerType,'operator_direct');
assert.equal(direct.powerKw,380);
assert.deepEqual(direct.pricing.rules.map(x=>[x.start,x.end,x.pricePerKwh]),[
  ['00:00','11:30',.30],['11:30','15:00',.35],['15:00','18:00',.30],['18:00','24:00',.35]
]);

function priceAt(hhmm){
  const [h,m]=hhmm.split(':').map(Number),minute=h*60+m;
  const toMin=s=>{const [hh,mm]=s.split(':').map(Number);return hh*60+mm};
  const row=direct.pricing.rules.find(r=>minute>=toMin(r.start)&&minute<toMin(r.end));
  return row?.pricePerKwh;
}
assert.equal(priceAt('10:00'),.30);
assert.equal(priceAt('12:45'),.35);
assert.equal(priceAt('16:00'),.30);
assert.equal(priceAt('20:00'),.35);

const express={countryCode:'FR',operator:'IZIVIA',network:'IZIVIA Express',name:'IZIVIA Express test',chargingConfigurations:[{kind:'DC',powerKw:150}]};
assert.strictEqual(api.addOffers(express,catalog),express,'IZIVIA Express must not inherit FAST tariff');
const sigeif={countryCode:'FR',operator:'IZIVIA',network:'SIGEIF',name:'SIGEIF mairie',chargingConfigurations:[{kind:'DC',powerKw:100}]};
assert.strictEqual(api.addOffers(sigeif,catalog),sigeif,'generic IZIVIA must not inherit FAST tariff');
const roamingOnly={countryCode:'FR',operator:'Electroverse',network:'IZIVIA FAST',name:"McDonald's Les Clayes",chargingConfigurations:[{kind:'DC',powerKw:380}]};
assert.strictEqual(api.addOffers(roamingOnly,catalog),roamingOnly,'roaming provider label must not prove physical IZIVIA CPO');
const acOnly={countryCode:'FR',operator:'IZIVIA',network:'IZIVIA FAST',name:"IZIVIA FAST McDonald's AC",chargingConfigurations:[{kind:'AC',powerKw:22}]};
assert.equal(api.addOffers(acOnly,catalog).chargingConfigurations.length,1,'FAST adapter is DC-only');

console.log('V8 IZIVIA FAST direct adapter tests: OK');
