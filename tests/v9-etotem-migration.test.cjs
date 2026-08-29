const assert=require('node:assert/strict');
const Engine=require('../assets/v9/data-engine.js');
const Adapter=require('../assets/v9/adapters/legacy-direct-tariffs.js');

const payload={dataset:'etotem-direct-tariffs-france',stations:[
  {stationId:'ET-1',resolved:true,tariffText:'DC : 50 kW 0,45 €/kWh. Post-charge : 10 minutes gratuites puis 1 € / 10 min, plafonné 12 €.',pdcs:[{id:'FR*ETT*E1*1',powerKw:50,connectors:['CCS2']}]},
  {stationId:'ET-2',resolved:true,tariffText:'DC : tarif Eco 0,20 €/kWh ; tarif standard 0,55 €/kWh',pdcs:[{id:'FR*ETT*E2*1',powerKw:150,connectors:['CCS']}]},
  {stationId:'ET-3',resolved:false,tariffText:'AC : 0,30 €/kWh',pdcs:[{id:'FR*ETT*E3*1',powerKw:22,connectors:['T2']}]},
  {stationId:'ET-4',resolved:true,tariffText:'AC : texte sans prix structurable',pdcs:[{id:'FR*ETT*E4*1',powerKw:22,connectors:['T2']}]}
]};
const normalized=Adapter.normalizePayload(payload,{priority:{tariff:95}});
assert.equal(normalized.offerRules.length,2,'only resolved PDCs with unambiguous standard prices should survive');
const first=normalized.offerRules.find(r=>r.evseIds.includes('FR*ETT*E1*1'));
assert(first);
assert.equal(first.pricing.rules[0].pricePerKwh,0.45);
assert.equal(first.pricing.rules[0].idleGraceMinutes,10);
assert.equal(first.pricing.rules[0].idlePerMinute,0.1);
assert.equal(first.pricing.rules[0].idleCap,12);
const eco=normalized.offerRules.find(r=>r.evseIds.includes('FR*ETT*E2*1'));
assert(eco);
assert.equal(eco.pricing.rules[0].pricePerKwh,0.55,'Eco price must not replace standard public direct tariff');

const registry={sources:[
  {id:'france-national',countries:['FR'],priority:{identity:55,connectors:60,tariff:30},active:true},
  {id:'etotem-direct-france',countries:['FR'],priority:{tariff:95},active:true,optional:true}
]};
const exact={canonicalId:'FR:national:ET1',sourceStationId:'ET1',countryCode:'FR',name:'e-Totem exact',physicalOperator:{id:'etotem',name:'e-Totem'},evses:[{id:'FR*ETT*E1*1',pdcIds:['FR*ETT*E1*1'],connectors:[{id:'c1',kind:'DC',powerKw:50}]}]};
const wrong={canonicalId:'FR:national:ETX',sourceStationId:'ETX',countryCode:'FR',name:'e-Totem wrong',physicalOperator:{id:'etotem',name:'e-Totem'},evses:[{id:'FR*ETT*OTHER*1',pdcIds:['FR*ETT*OTHER*1'],connectors:[{id:'c2',kind:'DC',powerKw:50}]}]};
(async()=>{
  const engine=Engine.createEngine({registry,loaders:{'france-national':async()=>[exact,wrong],'etotem-direct-france':async()=>normalized}});
  const area=await engine.queryArea({countryCode:'FR'});
  const a=area.stations.find(s=>s.name==='e-Totem exact'),b=area.stations.find(s=>s.name==='e-Totem wrong');
  assert.equal(a.offers.filter(o=>o.provider==='e-Totem direct').length,1);
  assert.equal(b.offers.filter(o=>o.provider==='e-Totem direct').length,0,'nearby/other PDC must never receive e-Totem tariff');
  console.log('V9 e-Totem exact PDC migration OK');
})().catch(err=>{console.error(err);process.exit(1);});