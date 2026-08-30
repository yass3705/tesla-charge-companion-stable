'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const path=require('node:path');
const National=require('../assets/v9/adapters/national-compact.js');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const Data=require('../assets/v9/data-engine.js');
const Session=require('../assets/v9/session-engine.js');

const root=path.join(__dirname,'..');
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const readGzJson=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,p))).toString('utf8'));
const rows=readGzJson('data/v9/italy-static/all.json.gz');
const offersPayload=readJson('data/v9/italy-offers.json');
const rules=Direct.normalizePayload(offersPayload).offerRules;
const source={id:'italy-verified-offers',priority:{tariff:130}};

const stations=rows.map(row=>National.normalizeRow(row,{countryCode:'IT',sourceId:'italy-pun'})).filter(Boolean);
const maxPower=st=>Math.max(0,...(st.evses||[]).flatMap(e=>(e.connectors||[]).map(c=>Number(c.powerKw)||0)));

const rulesByEvse=new Map();
for(const rule of rules){
  for(const eid of rule.evseIds||[]){
    const list=rulesByEvse.get(eid)||[];
    list.push({rule,source});
    rulesByEvse.set(eid,list);
  }
}
const enriched=stations.map(st=>{
  const relevant=[];
  const seen=new Set();
  for(const evse of st.evses||[]){
    for(const item of rulesByEvse.get(evse.id)||[]){
      const key=`${item.rule.id}|${item.rule.kind}|${item.rule.subscriptionId||''}|${evse.id}`;
      if(!seen.has(key)){seen.add(key);relevant.push(item);}
    }
  }
  return relevant.length?Data.applyOfferRules([st],relevant)[0]:st;
});

assert.equal(stations.length,29696);
assert.ok(enriched.some(s=>s.offers.some(o=>o.kind==='direct')),'no direct offers attached');
assert.ok(enriched.some(s=>s.offers.some(o=>o.kind==='subscription')),'no subscription offers attached');
assert.ok(enriched.some(s=>s.offers.some(o=>o.kind==='emsp')),'no eMSP offers attached');

const zones={
  Rome:{lat:41.9028,lon:12.4964},
  Milan:{lat:45.4642,lon:9.1900},
  Bologna:{lat:44.4949,lon:11.3426}
};
const zoneResults={};
for(const [name,origin] of Object.entries(zones)){
  const within50=enriched.filter(s=>Data.distanceKm(origin,s)<=50);
  const available=within50.filter(s=>s.status?.state==='available');
  const fast=available.filter(s=>maxPower(s)>=50);
  assert.ok(within50.length>20,`${name}: implausibly low station coverage`);
  assert.ok(available.length>0,`${name}: no available stations`);
  assert.ok(fast.length>0,`${name}: no >=50 kW stations`);
  zoneResults[name]={within50:within50.length,available:available.length,fast50:fast.length};
}

const session={energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR'};
const comparable=enriched.filter(s=>s.offers.length);
let publicEvaluated=0,subEvaluated=0,subWins=0,emspWins=0,directWins=0;
const examples={};
for(const st of comparable){
  const pub=Session.evaluateStation(st,session,{selectedSubscriptions:[]});
  if(pub.best){
    publicEvaluated++;
    if(pub.best.kind==='emsp')emspWins++;
    if(pub.best.kind==='direct')directWins++;
    if(!examples.public)examples.public={station:st.name,operator:st.physicalOperator?.name,best:pub.best};
  }
  const sub=Session.evaluateStation(st,session,{selectedSubscriptions:['atlante_go']});
  if(sub.best){
    subEvaluated++;
    if(sub.best.subscriptionId==='atlante_go'){
      subWins++;
      if(!examples.atlanteGo)examples.atlanteGo={station:st.name,operator:st.physicalOperator?.name,best:sub.best,publicBest:pub.best};
    }
  }
}
assert.ok(publicEvaluated>1000,'too few publicly comparable stations');
assert.ok(subEvaluated>=publicEvaluated,'subscription selection reduced comparability');
assert.ok(directWins>0,'direct tariff never wins');
assert.ok(emspWins>0,'NextCharge eMSP never wins');
assert.ok(subWins>0,'Atlante Go never wins when selected');

const firstResult=enriched.map(st=>({st,res:Session.evaluateStation(st,session,{selectedSubscriptions:['atlante_go']})})).find(x=>x.res.best);
assert.ok(firstResult);
const b=firstResult.res.best;
assert.equal(b.costPerRecoveredKm,Number((b.total/(20/15*100)).toFixed(6)));

const operators=new Map();
for(const st of enriched){
  const name=st.physicalOperator?.name||'Unknown';
  const row=operators.get(name)||{stations:0,direct:0,subscription:0,emsp:0};
  row.stations++;
  for(const o of st.offers){if(o.kind==='direct')row.direct++;else if(o.kind==='subscription')row.subscription++;else if(o.kind==='emsp')row.emsp++;}
  operators.set(name,row);
}
const topOperators=[...operators.entries()].sort((a,b)=>b[1].stations-a[1].stations).slice(0,12);

console.log(JSON.stringify({
  ok:true,
  stations:stations.length,
  indexedEvseRules:rulesByEvse.size,
  zones:zoneResults,
  publicEvaluated,
  selectedSubscriptionEvaluated:subEvaluated,
  winners:{direct:directWins,emsp:emspWins,atlanteGo:subWins},
  examples,
  topOperators
},null,2));
