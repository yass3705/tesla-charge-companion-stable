import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync(process.argv[2]||'assets/v8-labornebleue-operator-fallback.js','utf8');
const sandbox={
  console,
  setInterval:()=>0,clearInterval:()=>{},setTimeout:fn=>{fn();return 0},
  document:{readyState:'loading',addEventListener:()=>{}},
  expandConfigurations:x=>x,
};
sandbox.window=sandbox;
vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:'v8-labornebleue-operator-fallback.js'});
const api=sandbox.TCCV8LaBorneBleueExplicitFallback;assert.ok(api);

const henri={
  id:'henri-poincare',operator:'La Borne Bleue',countryCode:'FR',kind:'AC',powerKw:22,stalls:2,
  chargingConfigurations:[
    {id:'ev1',kind:'AC',powerKw:22,stalls:2,offerProvider:'Electroverse'},
    {id:'el1',kind:'AC',powerKw:22,stalls:2,offerProvider:'Electra'},
  ]
};
const enriched=api.addDirect(henri);
const lbb=enriched.chargingConfigurations.filter(c=>c.labornebleueExplicitOperatorFallback===true);
assert.equal(lbb.length,2,'Henri-Poincare must gain public + subscriber direct offers');
const pub=lbb.find(c=>!c.subscriptionId),sub=lbb.find(c=>c.subscriptionId==='labornebleue-annual');
assert.ok(pub&&sub);
assert.equal(pub.offerProvider,'La Borne Bleue direct');
assert.equal(sub.offerProvider,'La Borne Bleue direct — Abonné');
assert.ok(Math.abs(pub.pricing.labornebleueExact.ratePerMinute-(6.5/60))<1e-12,'22 kW public must be 6.50 EUR/h');
assert.equal(sub.pricing.labornebleueExact.model,'time_windows');
assert.ok(sub.pricing.labornebleueExact.windows.every(w=>Math.abs(w.ratePerMinute-(5.5/60))<1e-12),'22 kW subscriber must be 5.50 EUR/h');
assert.equal(sub.pricing.labornebleueExact.windows.find(w=>w.start==='20:00')?.capEur,12,'subscriber night cap must be 12 EUR');

const partner=api.addDirect({...henri,id:'partner',operator:'Alizé',network:'SIPPEREC'});
assert.equal(partner.chargingConfigurations.length,2,'Alize/SIPPEREC partner must not receive LBB fallback');

const duplicate=api.addDirect(enriched);
assert.equal(duplicate.chargingConfigurations.filter(c=>c.labornebleueDirect===true).length,2,'fallback must be idempotent');

console.log(JSON.stringify({ok:true,station:'Henri-Poincare',publicEurPerHour:6.5,subscriberEurPerHour:5.5,partnerExcluded:true},null,2));
