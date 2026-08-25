import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(process.argv[2]||'assets/v8-labornebleue-operator-fallback.js','utf8');
const bridge=fs.readFileSync('assets/v8-overlay-area-bridge.js','utf8');
const subscriptions=fs.readFileSync('assets/v8-subscription-stability-fix.js','utf8');
const henri={
  id:'henri-poincare',operator:'La Borne Bleue',countryCode:'FR',kind:'AC',powerKw:22,stalls:2,
  chargingConfigurations:[
    {id:'ev1',kind:'AC',powerKw:22,stalls:2,offerProvider:'Electroverse'},
    {id:'el1',kind:'AC',powerKw:22,stalls:2,offerProvider:'Electra'},
  ]
};
const sandbox={
  console,
  setInterval:()=>0,clearInterval:()=>{},setTimeout:fn=>{fn();return 0},
  document:{readyState:'loading',addEventListener:()=>{}},
  expandConfigurations:x=>x,
  candidateStations:async()=>({origin:{lat:48.91,lon:2.28},stations:[structuredClone(henri)]}),
};
sandbox.window=sandbox;
vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:'v8-labornebleue-operator-fallback.js'});
const api=sandbox.TCCV8LaBorneBleueExplicitFallback;assert.ok(api);

function lbbOffers(st){return api.addDirect(st).chargingConfigurations.filter(c=>c.labornebleueDirect===true)}
function assertAc22Pair(st,label){
  const lbb=lbbOffers(st);
  assert.equal(lbb.length,2,`${label} must gain public + subscriber direct offers`);
  const pub=lbb.find(c=>!c.subscriptionId),sub=lbb.find(c=>c.subscriptionId==='labornebleue-annual');
  assert.ok(pub&&sub,`${label} must expose both tariff plans`);
  assert.equal(pub.offerProvider,'La Borne Bleue direct');
  assert.equal(sub.offerProvider,'La Borne Bleue direct — Abonné');
  assert.ok(Math.abs(pub.pricing.labornebleueExact.ratePerMinute-(6.5/60))<1e-12,`${label}: 22 kW public must be 6.50 EUR/h`);
  assert.equal(sub.pricing.labornebleueExact.model,'time_windows');
  assert.ok(sub.pricing.labornebleueExact.windows.every(w=>Math.abs(w.ratePerMinute-(5.5/60))<1e-12),`${label}: 22 kW subscriber must be 5.50 EUR/h`);
  assert.equal(sub.pricing.labornebleueExact.windows.find(w=>w.start==='20:00')?.capEur,12,`${label}: subscriber night cap must be 12 EUR`);
  return lbb;
}

assertAc22Pair(henri,'Henri-Poincare');
const marne={...henri,id:'avenue-de-la-marne-44',chargingConfigurations:[{id:'ev2',kind:'AC',powerKw:22,stalls:2,offerProvider:'Electroverse'},{id:'el2',kind:'AC',powerKw:22,stalls:2,offerProvider:'Electra'}]};
assertAc22Pair(marne,'44 Avenue de la Marne');

const placeholder={...marne,id:'marne-placeholder',chargingConfigurations:[...marne.chargingConfigurations,{id:'old-lbb-info',kind:'AC',powerKw:22,stalls:2,offerProvider:'La Borne Bleue direct',pricing:{type:'rules',rules:[]}}]};
const placeholderOut=api.addDirect(placeholder);
assert.equal(placeholderOut.chargingConfigurations.some(c=>c.id==='old-lbb-info'),false,'non-calculable LBB placeholder must be removed');
assert.equal(placeholderOut.chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,2,'placeholder must be replaced by public + subscriber calculable offers');

const displayOnly=api.addDirect({...henri,operator:'',displayOperator:'La Borne Bleue'});
assert.equal(displayOnly.chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,2,'explicit display operator must be recognized');

const partner=api.addDirect({...henri,id:'partner',operator:'Alizé',network:'SIPPEREC'});
assert.equal(partner.chargingConfigurations.length,2,'Alize/SIPPEREC partner must not receive LBB fallback');
const duplicate=api.addDirect(api.addDirect(henri));
assert.equal(duplicate.chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,2,'fallback must be idempotent');

assert.equal(api.installCandidate(),true,'candidateStations guard must install');
const prepared=await sandbox.candidateStations();
assert.equal(prepared.stations[0].chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,2,'candidateStations must expose calculable LBB offers before simulation');
assert.equal(prepared.labornebleueExplicitFallbackApplied,true);
assert.equal(api.installExpansion(),true,'expandConfigurations guard must install');
const expanded=sandbox.expandConfigurations([structuredClone(henri)]);
assert.equal(expanded[0].chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,2,'expansion guard must remain as final safety net');

// Reproduit la normalisation historique d'app.js qui supprimait les métadonnées
// commerciales. Le garde-fou rc48bn du bridge doit les réinjecter avant simulation.
const bridgeSandbox={
  console,
  setInterval:()=>0,clearInterval:()=>{},setTimeout:()=>0,
  document:{
    readyState:'complete',addEventListener:()=>{},querySelector:()=>null,getElementById:()=>null,
    createElement:()=>({dataset:{}}),head:{appendChild:()=>{}}
  },
};
bridgeSandbox.normalizeConfigurations=function(configs,st){
  const source=Array.isArray(configs)&&configs.length?configs:[{id:'main',label:'AC 22 kW',kind:'AC',powerKw:22,stalls:2,pricing:st?.pricing}];
  return source.map((c,i)=>({id:c.id||`config-${i+1}`,label:c.label||`${c.kind||'AC'} ${Number(c.powerKw||11)} kW`,kind:c.kind||'AC',powerKw:Number(c.powerKw||11),stalls:Number(c.stalls||0),pricing:c.pricing||st?.pricing}));
};
bridgeSandbox.stationConfigurations=function(st){return bridgeSandbox.normalizeConfigurations(st.chargingConfigurations,st)};
bridgeSandbox.expandConfigurations=x=>x;
bridgeSandbox.window=bridgeSandbox;
vm.createContext(bridgeSandbox);vm.runInContext(bridge,bridgeSandbox,{filename:'v8-overlay-area-bridge.js'});
const enriched=api.addDirect(structuredClone(henri));
const normalized=bridgeSandbox.stationConfigurations(enriched);
const publicDirect=normalized.find(c=>c.offerProvider==='La Borne Bleue direct');
const subscribedDirect=normalized.find(c=>c.subscriptionId==='labornebleue-annual');
assert.ok(publicDirect,'metadata guard must preserve La Borne Bleue public provider');
assert.equal(publicDirect.labornebleueDirect,true,'metadata guard must preserve LBB direct marker');
assert.ok(subscribedDirect,'metadata guard must preserve subscriptionId');
assert.equal(subscribedDirect.offerProvider,'La Borne Bleue direct — Abonné');

assert.match(bridge,/lbbFallbackApi\?\.applyToPrepared/,'bridge must apply LBB fallback to prepared cache');
assert.match(bridge,/lbbFallbackApi\?\.addDirect/,'bridge must keep final expansion boundary guard');
assert.match(bridge,/installConfigurationMetadataGuard/,'bridge must preserve configuration metadata before simulation');
assert.match(subscriptions,/const compareCard=\$\('v8CompareCard'\)\|\|\$\('compare'\)\?\.querySelector\('\.card'\)/,'subscription UI must prefer the visible top-level compare card');
assert.match(subscriptions,/compareCard\.insertBefore\(box,filters\)/,'subscription UI must be placed before the collapsed filters panel');
assert.doesNotMatch(subscriptions,/out\.filter\(eligible\)/,'subscriber variants must remain visible even when excluded from ranking');

console.log(JSON.stringify({ok:true,stations:['Henri-Poincare','44 Avenue de la Marne'],publicEurPerHour:6.5,subscriberEurPerHour:5.5,placeholderReplaced:true,candidateGuard:true,metadataGuard:true,subscriptionHostVisible:true,bridgeBoundary:true,partnerExcluded:true},null,2));