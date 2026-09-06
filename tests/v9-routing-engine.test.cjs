const assert=require('node:assert/strict');
const Routing=require('../assets/v9/routing-engine.js');
const Session=require('../assets/v9/session-engine.js');

(async()=>{
  const stations=[
    {id:'a',latitude:48.8,longitude:2.1,countryCode:'FR',offers:[{id:'a-public',provider:'A',kind:'direct',countries:['FR'],pricing:{pricePerKwh:.5},currency:'EUR'}]},
    {id:'b',latitude:48.9,longitude:2.2,countryCode:'FR',offers:[{id:'b-public',provider:'B',kind:'direct',countries:['FR'],pricing:{pricePerKwh:.5},currency:'EUR'}]}
  ];
  const calls=[];
  const provider=async({stationId})=>{calls.push(stationId);return stationId==='a'?{distanceMeters:10000,durationSeconds:900}:{distanceKm:20,driveMinutes:30};};
  const result=await Routing.routeCandidates(stations,{origin:{lat:48.7,lon:2},provider,session:{consumptionKwhPer100Km:15},concurrency:2});
  assert.equal(result.routedCount,2);assert.equal(result.requestedCount,2);assert.deepEqual(calls.sort(),['a','b']);
  assert.equal(result.byStationId.a.distanceKm,10);assert.equal(result.byStationId.a.driveMinutes,15);assert.equal(result.byStationId.a.approachEnergyKwh,1.5);
  assert.equal(result.byStationId.b.approachEnergyKwh,3);
  const energy=Routing.energyByStationId(result);assert.deepEqual(energy,{a:1.5,b:3});
  const evaluated=Session.evaluateStation(stations[0],{energyKwh:20,consumptionKwhPer100Km:15},{approachEnergyKwhByStationId:energy});
  assert.equal(evaluated.requestedEnergyKwh,20);assert.equal(evaluated.approachEnergyKwh,1.5);assert.equal(evaluated.billedEnergyKwh,21.5);assert.equal(evaluated.best.total,10.75);
  const withoutRouteEnergy=Session.evaluateStation(stations[0],{energyKwh:20,consumptionKwhPer100Km:15,includeRouteEnergyInCharge:false},{approachEnergyKwhByStationId:energy});
  assert.equal(withoutRouteEnergy.billedEnergyKwh,20);assert.equal(withoutRouteEnergy.best.total,10);
  const controller=new AbortController();
  const abortable=({signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('routing_aborted')),{once:true}));
  const abortStarted=Date.now();
  const pending=Routing.routeCandidates(stations,{origin:{lat:48.7,lon:2},provider:abortable,concurrency:2,requestTimeoutMs:1000,budgetMs:2000,signal:controller.signal});
  setTimeout(()=>controller.abort(new Error('duration_budget_exceeded')),25);
  const aborted=await pending;
  assert.equal(aborted.aborted,true,'scenario abort signal must reach the routing provider');
  assert(Date.now()-abortStarted<200,'external abort must stop routing promptly');
  console.log(JSON.stringify({ok:true,module:'tcc-v9-routing-engine',routed:result.routedCount,approachEnergyKwh:energy},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
