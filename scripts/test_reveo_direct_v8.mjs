import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const matrix=JSON.parse(fs.readFileSync(new URL('../data/reveo_direct_tariffs_france_v1.json',import.meta.url),'utf8'));
const registered=[];
globalThis.window=globalThis;
globalThis.document={readyState:'complete',addEventListener(){},dispatchEvent(){},querySelector(){return null}};
globalThis.CustomEvent=class{constructor(type){this.type=type}};
globalThis.queueMicrotask=fn=>fn();
globalThis.setInterval=(fn)=>{fn();return 1};
globalThis.clearInterval=()=>{};
globalThis.candidateStations=async()=>({origin:{lat:43.6,lon:3.88,label:'test'},stations:[]});
globalThis.TCCV8Subscriptions={registerPlan(plan){registered.push(plan);return true}};

const code=fs.readFileSync(new URL('../assets/v8-reveo-direct.js',import.meta.url),'utf8');
vm.runInThisContext(code,{filename:'v8-reveo-direct.js'});
const api=globalThis.TCCReveoDirectV8;
assert.ok(api,'Révéo API missing');
assert.equal(api.validateMatrix(matrix),matrix);

function base({department='34',operator='Révéo',name='Révéo Test',address='',configs=[]}={}){
  return {id:`test-${department}-${name}`,name,operator,department,address,countryCode:'FR',source:'franceNationalCatalog',chargingConfigurations:configs};
}
const ac22={id:'electroverse-ac',label:'Electroverse · AC 22 kW',kind:'AC',powerKw:22,stalls:2,offerProvider:'Electroverse',offerType:'roaming',pricing:{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:.55}]}};
const dc24={id:'roam-dc24',label:'Roaming · DC 24 kW',kind:'DC',powerKw:24,stalls:1,offerProvider:'Electroverse',offerType:'roaming'};
const dc50={id:'roam-dc50',label:'Roaming · DC 50 kW',kind:'DC',powerKw:50,stalls:1,offerProvider:'Electroverse',offerType:'roaming'};
const dc100={id:'roam-dc100',label:'Roaming · DC 100 kW',kind:'DC',powerKw:100,stalls:2,offerProvider:'Electroverse',offerType:'roaming'};

// Hérault: public + subscriber exact by connector, roaming preserved.
let st=api.mergeStation(base({department:'34',configs:[ac22,dc24,dc50,dc100]}),matrix);
assert.equal(st.reveoTerritory,'S34');
assert.equal(st.reveoPricingStatus,'verified');
assert.ok(st.chargingConfigurations.some(c=>c.offerProvider==='Electroverse'),'roaming must be preserved');
const pub=st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Direct');
const sub=st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Abonné');
assert.equal(pub.length,4);assert.equal(sub.length,4);
assert.equal(pub.find(c=>c.powerKw===22).pricing.rules[1].pricePerKwh,.40);
assert.equal(pub.find(c=>c.powerKw===22).pricing.rules[1].afterMinutesThreshold,180);
assert.equal(pub.find(c=>c.powerKw===22).pricing.rules[1].afterMinutesRate,.10);
assert.equal(sub.find(c=>c.powerKw===22).pricing.rules[1].pricePerKwh,.32);
assert.equal(sub.find(c=>c.powerKw===24).pricing.rules[1].pricePerKwh,.36);
assert.equal(pub.find(c=>c.powerKw===50).pricing.rules[1].pricePerKwh,.50);
assert.equal(pub.find(c=>c.powerKw===100).pricing.rules[0].pricePerKwh,.59);
assert.equal(sub.find(c=>c.powerKw===100).pricing.rules[0].pricePerKwh,.50);
assert.ok(sub.every(c=>c.subscriptionId==='reveo-subscription'));

// Explicit long-duration tag changes AC threshold from 3 h to 10 h.
st=api.mergeStation(base({department:'34',name:'Révéo longue durée',configs:[ac22]}),matrix);
let direct=st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct');
assert.equal(direct.pricing.rules[0].afterMinutesThreshold,600);
assert.equal(direct.pricing.rules[0].afterMinutesRate,.10);

// Aveyron: 1 July 2026 public grid only; no guessed subscriber offer.
st=api.mergeStation(base({department:'12',configs:[ac22,dc24,dc50,dc100]}),matrix);
assert.equal(st.reveoTerritory,'S12');
assert.equal(st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Direct').length,4);
assert.equal(st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Abonné').length,0);
assert.equal(st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.powerKw===24).pricing.rules[0].pricePerKwh,.46);
assert.equal(st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.powerKw===50).pricing.rules[0].pricePerKwh,.50);
assert.equal(st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.powerKw===100).pricing.rules[0].pricePerKwh,.59);

// Lozère: current public tariff only.
st=api.mergeStation(base({department:'48',configs:[ac22,dc50,dc100]}),matrix);
assert.equal(st.reveoTerritory,'S48');
assert.equal(st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.powerKw===22).pricing.rules[1].pricePerKwh,.40);
assert.equal(st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.powerKw===50).pricing.rules[0].pricePerKwh,.55);
assert.equal(st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.powerKw===100).pricing.rules[0].pricePerKwh,.70);
assert.equal(st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Abonné').length,0);

// Toulouse Métropole: never infer M31 from department alone.
st=api.mergeStation(base({department:'31',name:'Révéo Toulouse',configs:[ac22]}),matrix);
assert.equal(st.reveoPricingStatus,'unresolved');
assert.equal(st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Direct').length,0);
st=api.mergeStation(base({department:'31',name:'Révéo Toulouse Métropole',configs:[ac22,dc50]}),matrix);
assert.equal(st.reveoTerritory,'M31');
let ac=st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.kind==='AC');
assert.deepEqual(ac.pricing.rules.map(r=>[r.start,r.end,r.pricePerKwh,r.afterMinutesRate,r.afterMinutesThreshold]),[
  ['06:00','23:00',.40,.04,120],['23:00','06:00',.30,.04,120]
]);
assert.equal(st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct'&&c.kind==='DC').pricing.rules[0].pricePerKwh,.40);

// Montpellier/Toulibéo must not inherit Hérault S34 by department.
st=api.mergeStation(base({department:'34',name:'Révéo Montpellier Métropole',configs:[ac22]}),matrix);
assert.notEqual(st.reveoPricingStatus,'verified');

// Révéo 2025 remains fail-closed until current territory rules are revalidated.
for(const dep of ['09','11','46','65','66']){
  st=api.mergeStation(base({department:dep,configs:[ac22,dc100]}),matrix);
  assert.equal(st.reveoPricingStatus,'unresolved',dep);
  assert.equal(st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Direct').length,0,dep);
}

// A partner CPO with a Révéo roaming row is not treated as Révéo-operated.
st=api.mergeStation(base({department:'34',operator:'Powerdot',name:'Powerdot',configs:[{...ac22,offerProvider:'Révéo'}]}),matrix);
assert.equal(st.operator,'Powerdot');
assert.equal(st.reveoPricingStatus,undefined);

assert.ok(registered.some(p=>p.selectionId==='reveo-subscription'),'Révéo plan not registered');
const plan=registered.find(p=>p.selectionId==='reveo-subscription');
assert.equal(plan.defaultSelected,false);
assert.equal(plan.monthlyFeeEur,1.5);
assert.match(plan.monthlyFeeLabel,/12 €/);

console.log('Révéo Direct V8 tests OK');
