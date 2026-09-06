const assert=require('node:assert/strict');
const Engine=require('../assets/v9/data-engine.js');
const Adapter=require('../assets/v9/adapters/france-emsp-compact.js');

const rule=(price)=>[['allDay','00:00','24:00','kwh','EUR',price,0,0,0,0,0,null,[]]];
const rows=[
  ['S1','Station 1','Rue 1',48.8,2.1,'Operator',2,[],[
    ['ev1','Electroverse · DC 150 kW','DC',150,1,rule(.49),['FR*ABC*E1*1']],
    ['ev2','Electra · DC 150 kW','DC',150,1,rule(.39),['FR*ABC*E1*2']],
    ['ev3','Other MSP · DC 150 kW','DC',150,1,rule(.20),['FR*ABC*E1*3']]
  ]],
  ['S2','Ambiguous','Rue 2',48.81,2.11,'Operator',1,[],[
    ['a1','Electra · DC 100 kW','DC',100,1,rule(.42),['FR*ABC*E2*1']],
    ['a2','Electra · DC 100 kW','DC',100,1,rule(.51),['FR*ABC*E2*1']]
  ]],
  ['S3','No PDC','Rue 3',48.82,2.12,'Operator',1,[],[
    ['n1','Electroverse · AC 22 kW','AC',22,1,rule(.35),[]]
  ]]
];
const normalized={offerRules:Adapter.offerRulesFromRows(rows,{priority:{tariff:80}})};
assert.equal(normalized.offerRules.length,2,'only exact, unambiguous Electroverse/Electra PDC offers should survive');
assert.deepEqual(normalized.offerRules.map(x=>x.provider).sort(),['Electra','Electroverse']);
assert(normalized.offerRules.every(x=>x.metadata.identityMode==='exact_irve_pdc'));
assert.equal(normalized.offerRules.find(x=>x.provider==='Electroverse').pricing.rules[0].pricePerKwh,.49);
assert(!normalized.offerRules.some(x=>x.evseIds.includes('FR*ABC*E2*1')),'conflicting Electra prices on one PDC must fail closed');

const station=(name,pdc)=>({canonicalId:`FR:national:${name}`,sourceStationId:name,countryCode:'FR',name,physicalOperator:{id:'operator',name:'Operator'},evses:[{id:pdc,pdcIds:[pdc],connectors:[{id:`${pdc}:c`,kind:'DC',powerKw:150}]}]});
const registry={sources:[
  {id:'france-national',countries:['FR'],priority:{identity:55,connectors:60,tariff:30},active:true},
  {id:'france-emsp-offers',countries:['FR'],priority:{tariff:80},active:true,optional:true}
]};
(async()=>{
  const engine=Engine.createEngine({registry,loaders:{
    'france-national':async()=>[station('exact','FR*ABC*E1*1'),station('electra','FR*ABC*E1*2'),station('wrong','FR*ABC*OTHER')],
    'france-emsp-offers':async()=>normalized
  }});
  const area=await engine.queryArea({countryCode:'FR'});
  const exact=area.stations.find(s=>s.name==='exact'),electra=area.stations.find(s=>s.name==='electra'),wrong=area.stations.find(s=>s.name==='wrong');
  assert.equal(exact.offers.filter(o=>o.provider==='Electroverse').length,1);
  assert.equal(electra.offers.filter(o=>o.provider==='Electra').length,1);
  assert.equal(wrong.offers.filter(o=>['Electroverse','Electra'].includes(o.provider)).length,0,'eMSP tariff must never leak to another station/PDC');
  assert.equal(exact.offers.find(o=>o.provider==='Electroverse').kind,'roaming');
  console.log('V9 France eMSP exact PDC migration OK');
})().catch(err=>{console.error(err);process.exit(1);});