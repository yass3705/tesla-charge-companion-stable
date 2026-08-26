import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code=fs.readFileSync('assets/v8-tariff-integrity.js','utf8');
let registered=null;
const document={readyState:'complete',addEventListener(){},dispatchEvent(){}};
const context={
  console,
  document,
  CustomEvent:class{},
  queueMicrotask(fn){fn()},
  setInterval(fn){fn();return 1},
  clearInterval(){},
  setTimeout,
  Date,
  Promise,
  normalizeConfigurations(configs){
    return (configs||[]).map((c,i)=>({id:c.id||`c${i}`,label:c.label||'',kind:c.kind,powerKw:Number(c.powerKw),stalls:Number(c.stalls||0),pricing:c.pricing}));
  },
  TCCV8DirectPipeline:{registerPreparedEnricher(id,fn,priority){if(id==='tariff-integrity')registered={id,fn,priority};return true}}
};
context.window=context;
vm.createContext(context);
vm.runInContext(code,context,{filename:'v8-tariff-integrity.js'});

assert.ok(context.TCCV8TariffIntegrity,'API intégrité absente');
assert.ok(registered&&registered.priority===90,'enrichisseur intégrité non enregistré');

const raw=[{
  id:'belib-sub',label:'Abonné résident Paris · AC 7 kW',kind:'AC',powerKw:7,stalls:1,
  pricing:{type:'rules',rules:[]},offerProvider:'Belib’ direct — Abonné résident Paris',offerType:'operator_direct',
  subscriptionId:'belib-resident',belibDirect:true,belibCustomerPlan:'resident'
}];
const normalized=context.normalizeConfigurations(raw,{});
assert.equal(normalized[0].offerProvider,'Belib’ direct — Abonné résident Paris','offerProvider perdu par normalisation');
assert.equal(normalized[0].subscriptionId,'belib-resident','subscriptionId perdu par normalisation');
assert.equal(normalized[0].belibCustomerPlan,'resident','métadonnée Belib perdue par normalisation');

const belibPrepared={stations:[{operator:'Belib’ (TotalEnergies)',chargingConfigurations:[{
  label:'Abonné résident Paris · AC 7 kW',kind:'AC',powerKw:7,pricing:{type:'rules',rules:[]},belibDirect:true,belibCustomerPlan:'resident'
},{
  label:'Abonné non-résident · AC 7 kW',kind:'AC',powerKw:7,pricing:{type:'rules',rules:[]},belibDirect:true,belibCustomerPlan:'nonresident'
},{
  label:'Visiteur · AC 7 kW',kind:'AC',powerKw:7,pricing:{type:'rules',rules:[]},belibDirect:true,belibCustomerPlan:'visitor'
}]}]};
context.TCCV8TariffIntegrity.repairBelibMetadata(belibPrepared);
assert.equal(belibPrepared.stations[0].chargingConfigurations[0].subscriptionId,'belib-resident');
assert.equal(belibPrepared.stations[0].chargingConfigurations[1].subscriptionId,'belib-nonresident');
assert.equal(belibPrepared.stations[0].chargingConfigurations[2].subscriptionId,undefined,'visiteur Belib marqué abonnement');

context.TCCFranceCatalog={loadPowerdotCatalog:async()=>({chargers:[{}]})};
context.TCCFranceCatalogV8={
  isPowerdotOperator:st=>String(st.operator).toLowerCase()==='powerdot',
  powerdotLocations:()=>[{id:'orgeval',name:'Marché Frais - Orgeval',address:'988 Rte de Quarante Sous',latitude:48.92,longitude:1.97}],
  powerdotDirectConfigurations:()=>[{offerProvider:'Powerdot direct',kind:'AC',powerKw:22}],
  mergedPowerdotStation:(loc,data,matches)=>({...matches[0],chargingConfigurations:[...(matches[0].chargingConfigurations||[]),{label:'Powerdot direct · AC 22 kW',offerProvider:'Powerdot direct',offerType:'operator_direct',kind:'AC',powerKw:22,pricing:{type:'rules',rules:[{pricePerKwh:.47}]}}]})
};
const powerdotPrepared={stations:[{id:'source-orgeval',name:'Marché Frais - Orgeval',address:'adresse source différente',operator:'Powerdot',latitude:48.9,longitude:1.9,chargingConfigurations:[{label:'Electroverse · AC 22 kW',kind:'AC',powerKw:22,pricing:{type:'kwh',pricePerKwh:.42}}]}]};
await context.TCCV8TariffIntegrity.enrichPowerdotIdentity(powerdotPrepared);
const pd=powerdotPrepared.stations[0].chargingConfigurations.find(c=>String(c.offerProvider).toLowerCase().includes('powerdot'));
assert.ok(pd,'Powerdot Orgeval non rapproché par nom exact');
assert.equal(pd.pricing.rules[0].pricePerKwh,.47);

context.TCCBumpDirectV8={
  loadCatalog:async()=>({stations:[{
    stationId:'FRBMPS664624',name:'Bump - SAGS - Paris - Meyerbeer',address:"3 Rue de la Chau. d'Antin, 75009 Paris",
    points:[{idPdcItinerance:'FRBMPENM0550',powerKw:7,rankable:true,status:'rankable_rule_based',components:{energyEurPerKwh:.55,flatFeeEur:1.2},rules:[{kind:'flat_fee',amountEur:1.2}]}]
  }]}),
  basePricing:point=>({type:'rules',rules:[{scope:'allDay',pricePerKwh:point.components.energyEurPerKwh}],bumpFeePolicy:{components:point.components,rules:point.rules}})
};
const bumpPrepared={stations:[{id:'meyerbeer',name:'Bump - SAGS - Paris - Meyerbeer',address:"3 Rue de la Chau. d'Antin, 75009 Paris",operator:'Bump',kind:'AC',powerKw:7.4,stalls:1,chargingConfigurations:[{label:'Electra · AC 7.4 kW',offerProvider:'Electra',kind:'AC',powerKw:7.4,stalls:1,pricing:{type:'kwh',pricePerKwh:.55}}]}]};
await context.TCCV8TariffIntegrity.enrichBumpNominalPower(bumpPrepared);
const bump=bumpPrepared.stations[0].chargingConfigurations.find(c=>c.offerProvider==='Bump Direct');
assert.ok(bump,'Bump Meyerbeer 7.4 kW non rapproché du point nominal 7 kW');
assert.equal(bump.powerKw,7.4,'la puissance physique affichée doit rester 7.4 kW');
assert.equal(bump.bumpSourcePowerKw,7,'la puissance tarifaire source doit rester traçable');
assert.equal(bump.pricing.rules[0].pricePerKwh,.55);
assert.equal(bump.pricing.bumpFeePolicy.components.flatFeeEur,1.2);

console.log('OK v8 tariff integrity: metadata + Belib opt-in + Powerdot identity + Bump nominal power.');
