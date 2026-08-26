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
assert.deepEqual(matrix.scope.rankableTerritories,['S34']);
assert.equal(matrix.scope.roamingTariffsPromotedToDirect,false);

const unsafe=structuredClone(matrix);
unsafe.territories.S12.public=[{key:'unsafe',kind:'AC',pricePerKwh:.4}];
assert.throws(()=>api.validateMatrix(unsafe),/non vérifié rendu calculable/);

function base({department='34',operator='Révéo',name='Révéo Test',address='',city='',partyId='',configs=[]}={}){
  return {id:`test-${department}-${name}`,name,operator,department,address,city,partyId,countryCode:'FR',source:'franceNationalCatalog',chargingConfigurations:configs};
}
function config(kind,powerKw,stalls=1,provider='Electroverse'){
  return {id:`${provider}-${kind}-${powerKw}`,label:`${provider} · ${kind} ${powerKw} kW`,kind,powerKw,stalls,offerProvider:provider,offerType:'roaming',pricing:{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:.77}]}};
}
const ac22=config('AC',22,2),ac43=config('AC',43.6),dc24=config('DC',24),dc50=config('DC',50),dc100=config('DC',100,2);
const feeRule=c=>c.pricing.rules.find(r=>Number(r.afterMinutesRate)>0);

// Hérault hors métropole : public + abonné exacts, roaming conservé.
let st=api.mergeStation(base({department:'34',city:'Béziers',configs:[ac22,ac43,dc24,dc50,dc100]}),matrix);
assert.equal(st.reveoTerritory,'S34');
assert.equal(st.reveoPricingStatus,'verified');
assert.ok(st.chargingConfigurations.some(c=>c.offerProvider==='Electroverse'),'roaming must be preserved separately');
const pub=st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Direct');
const sub=st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Abonné');
assert.equal(pub.length,5);assert.equal(sub.length,5);
for(const p of [22,43.6]){
  assert.equal(pub.find(c=>c.kind==='AC'&&c.powerKw===p).pricing.rules[0].pricePerKwh,.40);
  assert.equal(sub.find(c=>c.kind==='AC'&&c.powerKw===p).pricing.rules[0].pricePerKwh,.32);
  assert.equal(feeRule(pub.find(c=>c.kind==='AC'&&c.powerKw===p)).afterMinutesThreshold,180);
  assert.equal(feeRule(pub.find(c=>c.kind==='AC'&&c.powerKw===p)).afterMinutesRate,.10);
  assert.equal(feeRule(sub.find(c=>c.kind==='AC'&&c.powerKw===p)).afterMinutesRate,.075);
}
assert.equal(pub.find(c=>c.kind==='DC'&&c.powerKw===24).pricing.rules[0].pricePerKwh,.46);
assert.equal(sub.find(c=>c.kind==='DC'&&c.powerKw===24).pricing.rules[0].pricePerKwh,.36);
assert.equal(pub.find(c=>c.kind==='DC'&&c.powerKw===50).pricing.rules[0].pricePerKwh,.50);
assert.equal(sub.find(c=>c.kind==='DC'&&c.powerKw===50).pricing.rules[0].pricePerKwh,.40);
assert.equal(pub.find(c=>c.kind==='DC'&&c.powerKw===100).pricing.rules[0].pricePerKwh,.59);
assert.equal(sub.find(c=>c.kind==='DC'&&c.powerKw===100).pricing.rules[0].pricePerKwh,.50);
assert.equal(pub.find(c=>c.kind==='DC'&&c.powerKw===100).pricing.rules[0].afterMinutesThreshold,30);
assert.equal(pub.find(c=>c.kind==='DC'&&c.powerKw===100).pricing.rules[0].afterMinutesRate,.12);
assert.ok(sub.every(c=>c.subscriptionId==='reveo-subscription'&&c.subscriptionSelectionId==='reveo-subscription'));

// La catégorie longue utilisation n'est utilisée que si le site est explicitement marqué.
st=api.mergeStation(base({department:'34',city:'Béziers',name:'Révéo borne longue utilisation',configs:[ac22]}),matrix);
let direct=st.chargingConfigurations.find(c=>c.offerProvider==='Révéo Direct');
assert.equal(direct.reveoTariffKey,'ac-long');
assert.equal(direct.pricing.rules[0].afterMinutesThreshold,600);
assert.equal(direct.pricing.rules[0].afterMinutesRate,.10);

// Montpellier Méditerranée Métropole : exclusion géographique, même avec FR*S34 explicite.
for(const sample of [
  base({department:'34',city:'Montpellier',partyId:'FR*S34',configs:[ac22]}),
  base({department:'34',city:'Lattes',partyId:'FR*S34',configs:[dc100]}),
  base({department:'34',address:'1 avenue de Test, 34970 Lattes',configs:[ac22]})
]){
  st=api.mergeStation(sample,matrix);
  assert.equal(st.reveoTerritory,'M34');
  assert.equal(st.reveoPricingStatus,'unresolved');
  assert.equal(st.chargingConfigurations.filter(c=>c.reveoDirect).length,0);
}

// Tous les autres territoires connus restent fail-closed : aucune donnée roaming/OCPI n'est promue.
const cases=[
  ['12','S12','Rodez','FR*S12'],['31','M31','Toulouse','FR*M31'],['48','S48','Mende','FR*S48'],
  ['09','D09','Foix',''],['11','D11','Carcassonne',''],['46','D46','Cahors',''],['65','D65','Tarbes',''],['66','D66','Perpignan','']
];
for(const [department,territory,city,partyId] of cases){
  st=api.mergeStation(base({department,city,partyId,configs:[ac22,dc100]}),matrix);
  assert.equal(st.reveoTerritory,territory,department);
  assert.equal(st.reveoPricingStatus,'unresolved',department);
  assert.equal(st.chargingConfigurations.filter(c=>c.offerProvider==='Révéo Direct'||c.offerProvider==='Révéo Abonné').length,0,department);
}

// Un CPO partenaire proposant Révéo en itinérance ne devient jamais une station Révéo opérée.
st=api.mergeStation(base({department:'34',operator:'Powerdot',city:'Béziers',configs:[config('AC',22,1,'Révéo')]}),matrix);
assert.equal(st.operator,'Powerdot');
assert.equal(st.reveoPricingStatus,undefined);

// Statistiques overlay : vérifié uniquement sur Hérault hors métropole.
const prepared={stations:[
  base({department:'34',city:'Béziers',configs:[ac22]}),
  base({department:'34',city:'Montpellier',configs:[ac22]}),
  base({department:'12',city:'Rodez',configs:[ac22]})
]};
api.overlayPrepared(prepared,matrix);
assert.equal(prepared.reveoMergeStats.verifiedStations,1);
assert.equal(prepared.reveoMergeStats.unresolvedStations,2);

assert.ok(registered.some(p=>p.selectionId==='reveo-subscription'),'Révéo plan not registered');
const plan=registered.find(p=>p.selectionId==='reveo-subscription');
assert.equal(plan.defaultSelected,false);
assert.equal(plan.monthlyFeeEur,1.5);
assert.match(plan.monthlyFeeLabel,/12 €/);
assert.equal(plan.directOperatorOnly,true);

console.log(JSON.stringify({ok:true,rankableTerritories:matrix.scope.rankableTerritories,subscription:'reveo-subscription',unresolved:['09','11','12','31','46','48','65','66','Montpellier Métropole']},null,2));
