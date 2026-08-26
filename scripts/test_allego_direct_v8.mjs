import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const registered=[];
globalThis.window=globalThis;
globalThis.document={
  readyState:'complete',
  addEventListener(){},
  dispatchEvent(){},
  querySelector(){return null},
  head:{appendChild(){}},
  createElement(){return {dataset:{}}}
};
globalThis.CustomEvent=class{constructor(type){this.type=type}};
globalThis.queueMicrotask=fn=>fn();
globalThis.candidateStations=async()=>({origin:{lat:45.72,lon:4.92,label:'test'},stations:[]});
globalThis.priceWithRules=(pp,startMin,chargeMinutes,billedEnergy)=>({
  total:billedEnergy*Number(pp.rules?.[0]?.pricePerKwh||0),connection:0,chargeCost:billedEnergy*Number(pp.rules?.[0]?.pricePerKwh||0),idleCost:0,durationSurcharge:0,occupiedMinutes:chargeMinutes,currencies:['EUR']
});
globalThis.TCCV8Subscriptions={registerPlan(plan){registered.push(plan);return true}};

const code=fs.readFileSync(new URL('../assets/v8-allego-direct.js',import.meta.url),'utf8');
vm.runInThisContext(code,{filename:'v8-allego-direct.js'});
const api=globalThis.TCCAllegoDirectV8;
assert.ok(api,'Allego API missing');

const fee={type:'idle_after_charging',ratePerMinuteEur:0.248,notBeforeSessionMinute:45,onlyAfterChargingStops:true};
const offer={id:'burger-king-kingdom-happy-hours',selectionId:'burger-king-kingdom',provider:'Burger King Kingdom',offerType:'loyalty_direct',requiresSelection:true,pricePerKwhEur:0.30,start:'14:30',end:'18:30'};
const bron={
  stationId:'FRSITE00000224',name:'LYON BRON BURGER KING',address:'4 rue Paul Langevin - 69500 BRON',irveAddress:'4 rue Paul Langevin - 69500 BRON',coordinates:[45.7225674,4.9188476],rankableDirect:true,pricingStatus:'exact_official_evse',irveStationIds:['FRSITE00000224'],
  evses:['1','2','3','4'].map(n=>({evseId:`FRALLEGO60000${n}1`,kind:'DC',powerKw:150,directEurPerKwh:0.45,rankableDirect:true,feePolicy:fee,conditionalOffers:[offer],dxpChargePointId:`FRALLEGO60000${n}`}))
};

const configs=api.directConfigurations(bron);
const direct=configs.find(c=>c.offerProvider==='Allego Direct');
const kingdom=configs.find(c=>c.offerProvider==='Burger King Kingdom');
assert.ok(direct&&kingdom,configs);
assert.equal(direct.kind,'DC');
assert.equal(direct.powerKw,150);
assert.equal(direct.stalls,4);
assert.equal(direct.pricing.rules.length,1);
assert.equal(direct.pricing.rules[0].pricePerKwh,0.45);
assert.deepEqual(direct.pricing.allegoFeePolicy,fee);
assert.equal(kingdom.subscriptionId,'burger-king-kingdom');
assert.equal(kingdom.subscriptionSelectionId,'burger-king-kingdom');
assert.equal(kingdom.pricing.rules.length,3);
assert.deepEqual(kingdom.pricing.rules.map(r=>[r.start,r.end,r.pricePerKwh]),[
  ['00:00','14:30',0.45],['14:30','18:30',0.30],['18:30','24:00',0.45]
]);

// Screenshot reference case: Bron must remain direct 0.45; Kingdom is conditional only.
assert.equal(direct.allegoPricePerKwhEur,0.45);
assert.equal(kingdom.allegoSpecialPricePerKwhEur,0.30);
assert.equal(kingdom.allegoSpecialStart,'14:30');
assert.equal(kingdom.allegoSpecialEnd,'18:30');

// HPC: charge ends at 20 min, unplug at 60 => fee only from minute 45 to 60.
let calc=api.customAllegoFee(fee,600,20,60);
assert.ok(Math.abs(calc.idle-15*0.248)<1e-9,calc);
// If charge itself lasts beyond 45 min, fee starts only after charging stops.
calc=api.customAllegoFee(fee,600,60,70);
assert.ok(Math.abs(calc.idle-10*0.248)<1e-9,calc);

// Regular Allego: exact DXP hourly rate converted to per minute, 5h threshold,
// 07:00-23:00 window, and stop at 16h from session start.
const regular={type:'connection_overstay',ratePerMinuteEur:2.98/60,startAfterSessionMinutes:300,endAfterSessionMinutes:960,activeTimeWindows:[{start:'07:00',end:'23:00'}]};
calc=api.customAllegoFee(regular,6*60,100,600);
assert.ok(Math.abs(calc.overstay-300*(2.98/60))<1e-7,calc);
calc=api.customAllegoFee(regular,6*60,100,1200);
// From session minute 300 (11:00) to 960 (22:00) = 660 billable minutes.
assert.ok(Math.abs(calc.overstay-660*(2.98/60))<1e-7,calc);

const roaming={id:'electroverse',label:'Electroverse · DC 150 kW',kind:'DC',powerKw:150,stalls:4,pricing:{type:'rules',rules:[{scope:'allDay',billing:'kwh',currency:'EUR',pricePerKwh:0.50}]},offerProvider:'Electroverse',offerType:'roaming'};
const base={id:'catalog-bron',name:'4 Rue Paul Langevin Bron',operator:'Allego',latitude:45.72256,longitude:4.91885,chargingConfigurations:[roaming],source:'franceNationalCatalog'};
const merged=api.mergedStation(bron,base);
assert.ok(merged.chargingConfigurations.some(c=>c.offerProvider==='Allego Direct'));
assert.ok(merged.chargingConfigurations.some(c=>c.offerProvider==='Burger King Kingdom'));
assert.ok(merged.chargingConfigurations.some(c=>c.offerProvider==='Electroverse'),'roaming offer must be preserved separately');

const sampleCatalog={
  schemaVersion:'3.1.0',dataset:'allego-direct-operated-evse-france',operator:'Allego',country:'FR',
  scope:{operatorDirectOnly:true,roamingIncluded:false,countryDefaultsAreRankable:false,exactDirectPricesFromDxp:true,structuredTimeFeesAreRankable:true,conditionalOffersRequireSelection:true},
  counts:{franceEvseCount:1127,rankableEvseCount:1121,coveragePct:99.47,stationsWithCoordinates:153,irveLinkedEvseCount:1123},
  stations:Array.from({length:154},()=>({}))
};
assert.equal(api.validateCatalog(sampleCatalog),sampleCatalog);
assert.ok(registered.some(p=>p.selectionId==='burger-king-kingdom'),'Kingdom plan was not registered');
assert.equal(registered.find(p=>p.selectionId==='burger-king-kingdom').defaultSelected,false);

console.log('Allego Direct V8 tests OK');
