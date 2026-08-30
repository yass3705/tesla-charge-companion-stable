const assert=require('node:assert/strict');
const Parity=require('../assets/v9/parity-engine.js');

const v8=[
  {id:'legacy-a',name:'Station A',lat:48.80001,lng:2.10001,operator:'Fastned',status:'available',powerKw:300,offers:[{provider:'Fastned',kind:'direct',currency:'EUR',pricing:{pricePerKwh:0.59}}]},
  {id:'legacy-b',name:'Station B',lat:48.81,lng:2.11,operator:'IONITY',status:'available',powerKw:350}
];

const v9=[
  {id:'station:a',aliases:['legacy-a'],name:'Station A',latitude:48.8,longitude:2.1,physicalOperator:{id:'fastned',name:'Fastned'},status:{state:'available'},evses:[{connectors:[{powerKw:300}]}],offers:[{provider:'Fastned',kind:'direct',currency:'EUR',pricing:{pricePerKwh:0.59}}]},
  {id:'station:b',aliases:['legacy-b'],name:'Station B',latitude:48.81,longitude:2.11,physicalOperator:{id:'ionity',name:'IONITY'},status:{state:'available'},evses:[{connectors:[{powerKw:350}]}]},
  {id:'station:c',name:'Station C',latitude:48.82,longitude:2.12,physicalOperator:{id:'tesla',name:'Tesla'},status:{state:'available'}}
];

const ok=Parity.compareAreas(v8,{stations:v9});
assert.equal(ok.summary.v8Count,2);
assert.equal(ok.summary.v9Count,3);
assert.equal(ok.summary.matchedCount,2);
assert.equal(ok.summary.v8OnlyCount,0);
assert.equal(ok.summary.v9OnlyCount,1);
assert.equal(ok.summary.errorCount,0);
assert.equal(ok.gates.noV8Loss,true);
assert.equal(ok.gates.noCriticalDifferences,true);
assert.equal(ok.gates.pass,true,'V9 may add stations without failing parity');

const regressed=Parity.compareAreas(v8,{stations:[
  {...v9[0],physicalOperator:{id:'ionity',name:'IONITY'}},
  v9[2]
]});
assert.equal(regressed.summary.v8OnlyCount,1);
assert.equal(regressed.summary.errorCount,1);
assert.equal(regressed.gates.pass,false);
assert.ok(regressed.changed.some(row=>row.differences.some(d=>d.field==='operator')));

const statusRegression=Parity.compareAreas(v8,{stations:[
  {...v9[0],status:{state:'out_of_service'}},v9[1]
]},{compareOffers:false});
assert.equal(statusRegression.summary.errorCount,1);
assert.equal(statusRegression.gates.pass,false);

(async()=>{
  const shadow=await Parity.shadowQuery({
    v8Query:async()=>({stations:v8}),
    v9Engine:{queryArea:async()=>({stations:v9})},
    query:{countryCode:'FR'}
  });
  assert.equal(shadow.parity.gates.pass,true);
  console.log(JSON.stringify({ok:true,module:'tcc-v9-shadow-parity',summary:shadow.parity.summary,gates:shadow.parity.gates},null,2));
})().catch(err=>{console.error(err);process.exit(1);});