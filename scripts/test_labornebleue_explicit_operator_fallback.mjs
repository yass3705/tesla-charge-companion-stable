import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(process.argv[2]||'assets/v8-labornebleue-operator-fallback.js','utf8');
const bridge=fs.readFileSync('assets/v8-overlay-area-bridge.js','utf8');
const subscriptions=fs.readFileSync('assets/v8-compare-subscriptions.js','utf8');
const subscriptionCompat=fs.readFileSync('assets/v8-subscription-stability-fix.js','utf8');
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
  assert.ok(pub&&sub,`${label} must expose public and subscriber offers`);
  assert.equal(pub.pricing?.labornebleueExact?.model,'per_minute');
  assert.ok(Math.abs(pub.pricing.labornebleueExact.ratePerMinute*60-6.5)<1e-9);
  assert.equal(sub.pricing?.labornebleueExact?.model,'time_windows');
  assert.ok(Math.abs(sub.pricing.labornebleueExact.windows[0].ratePerMinute*60-5.5)<1e-9);
  assert.equal(sub.pricing.labornebleueExact.windows[1].capEur,12);
}

assertAc22Pair(structuredClone(henri),'Henri-Poincare');
assertAc22Pair({...structuredClone(henri),id:'avenue-marne',name:'ASNIERES-SUR-SEINE - 44 Avenue De La Marne'},'44 Avenue de la Marne');

const partner={id:'partner',operator:'SIPPEREC / Alize',countryCode:'FR',kind:'AC',powerKw:22,chargingConfigurations:[{id:'p',kind:'AC',powerKw:22,stalls:2}]};
assert.equal(lbbOffers(partner).length,0,'SIPPEREC/Alize partner must stay excluded');

const existing={...structuredClone(henri),chargingConfigurations:[
  ...henri.chargingConfigurations,
  {id:'old-lbb',kind:'AC',powerKw:22,stalls:2,offerProvider:'La Borne Bleue direct',pricing:{type:'unknown'}}
]};
const replaced=api.addDirect(existing).chargingConfigurations.filter(c=>c.labornebleueDirect===true);
assert.equal(replaced.length,2,'old non-calculable LBB placeholder must be replaced by exact pair');
assert.ok(replaced.every(c=>c.pricing?.labornebleueExact),'replaced LBB offers must carry exact pricing');

const prepared=api.applyToPrepared({origin:{lat:48.91,lon:2.28},stations:[structuredClone(henri),structuredClone(partner)]});
assert.equal(prepared.stations[0].chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,2,'prepared cache must gain LBB pair');
assert.equal(prepared.stations[1].chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,0,'partner must stay excluded in prepared cache');

const bridgeSandbox={
  console,Promise,
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
assert.match(subscriptions,/function host\(\)\{return \$\('v8CompareCard'\)\|\|\$\('compare'\)\?\.querySelector\('\.card'\)/,'compact subscription UI must prefer the visible top-level compare card');
assert.match(subscriptions,/root\.insertBefore\(box,filters\)/,'compact subscription UI must be placed before the collapsed filters panel');
assert.doesNotMatch(subscriptionCompat,/out\.filter\(eligible\)/,'subscriber variants must remain visible even when excluded from ranking');

console.log(JSON.stringify({ok:true,stations:['Henri-Poincare','44 Avenue de la Marne'],publicEurPerHour:6.5,subscriberEurPerHour:5.5,placeholderReplaced:true,candidateGuard:true,metadataGuard:true,subscriptionHostVisible:true,bridgeBoundary:true,partnerExcluded:true},null,2));
