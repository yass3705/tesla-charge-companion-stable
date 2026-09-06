const fs=require('fs');
const assert=require('assert');
const Engine=require('../assets/v9/device-scenario-engine.js');
const Runtime=require('../assets/v9/runtime-engine.js');
const Routing=require('../assets/v9/routing-engine.js');
const pack=JSON.parse(fs.readFileSync('data/v9/first-device-scenarios.json','utf8'));
const runner=fs.readFileSync('v9-app/scenario-runner.js','utf8');
assert.match(runner,/runScenarioPack[^\n]+telemetry\.clear\(\)/,'a new device pack must reset stale telemetry before its first run');
assert.match(runner,/telemetry\.record=\(\.\.\.args\)[^\n]+renderTelemetry\(\)/,'pack telemetry must refresh the visible summary after every run');
const validation=Engine.validatePack(pack);
assert.equal(validation.valid,true,validation.errors.join(','));
assert.equal(validation.scenarioCount,10);
assert.equal(pack.execution.stationLimit,24);
assert.equal(pack.execution.routingConcurrency,4);
assert.equal(pack.execution.routingRequestTimeoutMs,6000);
assert.equal(pack.execution.routingBudgetMs,25000);
assert(pack.execution.routingBudgetMs<pack.execution.maxDurationMs);
assert.equal(pack.execution.maxDurationMs,30000);
assert(pack.execution.uiYieldMs>=0);
const countries=new Set(pack.scenarios.map(s=>s.countryCode));
assert(countries.has('FR')&&countries.has('NL')&&countries.has('IT'));
assert(pack.scenarios.some(s=>Number.isFinite(Number(s.disconnectOffsetMinutes))));
assert(pack.scenarios.some(s=>Array.isArray(s.selectedSubscriptions)&&s.selectedSubscriptions.length>0));
assert(pack.scenarios.some(s=>s.sortBy==='finalCost'));
assert(pack.scenarios.some(s=>s.sortBy==='totalTime'));
assert(pack.scenarios.some(s=>s.sortBy==='distance'));
const session=Engine.buildSession(pack.scenarios.find(s=>s.disconnectOffsetMinutes),new Date('2026-08-31T12:00:00Z'));
assert(session.disconnectAt);
const okArea={stations:[{id:'a'}],rankedStations:[{id:'a'}],diagnostics:{sourceStationCount:933,stationLimitApplied:true,routingErrorCount:0,errors:[],fullyScoredStationCount:1,routingRequestedCount:1,routedStationCount:1}};
const ok=Engine.evaluateArea({...pack.scenarios[0],maxDurationMs:pack.execution.maxDurationMs},okArea,1000);
assert.equal(ok.ok,true);
assert.equal(ok.sourceStationCount,933);
assert.equal(ok.stationLimitApplied,true);
const slow=Engine.evaluateArea({...pack.scenarios[0],maxDurationMs:pack.execution.maxDurationMs},okArea,30001);
assert.equal(slow.ok,false);
assert(slow.reasons.includes('duration_budget_exceeded'));
const all=Array.from({length:60},(_,i)=>({id:`s${i}`}));
const routed=[all[10],all[2],all[30],all[1],all[40]];
const bounded=Runtime.boundedStations(all,routed,3);
assert.deepEqual(bounded.map(x=>x.id),['s10','s2','s30']);
assert.equal(Runtime.boundedStations(all,routed,100).length,60);
const pass=Engine.summary(Array.from({length:10},(_,i)=>({...ok,scenarioId:String(i)})));
assert.equal(pass.decision,'PASS');
const bad={...ok,ok:false,sourceErrors:1,reasons:['source_errors']};
const rollback=Engine.summary([...Array.from({length:9},(_,i)=>({...ok,scenarioId:String(i)})),bad]);
assert.equal(rollback.decision,'ROLLBACK');

(async()=>{
  const deadlineStarted=Date.now();
  await assert.rejects(
    Engine.withDeadline(()=>new Promise(()=>{}),35),
    err=>err?.code==='TCC_V9_DURATION_BUDGET_EXCEEDED'
  );
  assert(Date.now()-deadlineStarted<150,'scenario deadline must return control promptly');
  const stations=Array.from({length:6},(_,i)=>({id:`r${i}`,latitude:48.8+i/1000,longitude:2.06+i/1000}));
  const never=()=>new Promise(()=>{});
  const started=Date.now();
  const result=await Routing.routeCandidates(stations,{origin:{lat:48.798,lon:2.061},provider:never,concurrency:2,requestTimeoutMs:40,budgetMs:120});
  const elapsed=Date.now()-started;
  assert.equal(result.requestedCount,6);
  assert.equal(result.routedCount,0);
  assert(result.errors.length>=2);
  assert.equal(result.timedOut,true);
  // routing-engine intentionally enforces a 500 ms minimum hard budget. Allow
  // modest CI/event-loop scheduling overhead while still proving hard abort.
  assert(elapsed<650,`hard routing budget exceeded wall clock tolerance: ${elapsed}ms`);
  console.log('first-device scenario pack mobile guardrails OK');
})().catch(err=>{console.error(err);process.exitCode=1;});
