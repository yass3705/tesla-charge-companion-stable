const assert=require('node:assert/strict');
const Matrix=require('../assets/v9/parity-scenario-engine.js');

const baseQuery={countryCode:'FR',session:{startSoc:20,targetSoc:80,startAt:'2026-08-30T10:00:00Z',disconnectAt:'2026-08-30T12:00:00Z'},selectedSubscriptions:['sub-a']};
const defaults=Matrix.defaultScenarios(baseQuery);
assert(defaults.some(x=>x.id==='baseline'&&x.gateMode==='strict'));
assert(defaults.some(x=>x.id==='upper-soc'&&x.queryPatch.session.startSoc===80&&x.queryPatch.session.targetSoc===100));
assert(defaults.some(x=>x.id==='short-deadline'));
assert(defaults.some(x=>x.id==='post-charge'));
assert(defaults.some(x=>x.id==='evening-window'));
assert(defaults.some(x=>x.id==='selected-subscriptions'&&x.gateMode==='observe'));

const merged=Matrix.merge({session:{a:1,b:2},filters:{x:true}},{session:{b:3,c:4}});
assert.deepEqual(merged,{session:{a:1,b:3,c:4},filters:{x:true}});

const scenarios=[
  Matrix.scenario('strict-pass','Strict pass',{scenarioMarker:'pass'}),
  Matrix.scenario('strict-fail','Strict fail',{scenarioMarker:'fail'}),
  Matrix.scenario('observe-diff','Observe',{scenarioMarker:'observe'},{gateMode:'observe'})
];
const fakeV9={queryArea:async query=>({query,stations:[]})};
const fakeParity={
  shadowQuery:async({query})=>{
    const fail=query.scenarioMarker==='fail',observe=query.scenarioMarker==='observe';
    const parity={
      gates:{noV8Loss:!fail,noCriticalDifferences:!fail,sessionParity:!fail,pass:!fail&&!observe},
      changed:fail?[{leftId:'s1',rightId:'s1',differences:[],sessionDifferences:[{field:'finalCost',left:10,right:12,severity:'error',delta:2}]}]:observe?[{leftId:'s2',rightId:'s2',differences:[],sessionDifferences:[{field:'costPerRecoveredKm',left:.05,right:.04,severity:'warning',delta:-.01}]}]:[],
      v8Only:fail?[{id:'missing'}]:[],summary:{}
    };
    return{query,v8Result:{},v9Area:{},parity};
  }
};

(async()=>{
  const matrix=await Matrix.runMatrix({baseQuery,scenarios,v8Query:async()=>({}),v9Engine:fakeV9,parityEngine:fakeParity});
  assert.equal(matrix.summary.scenarioCount,3);
  assert.equal(matrix.summary.strictScenarioCount,2);
  assert.equal(matrix.summary.observationScenarioCount,1);
  assert.equal(matrix.summary.strictPassedCount,1);
  assert.equal(matrix.summary.strictFailedCount,1);
  assert.equal(matrix.summary.matrixPass,false);
  assert.equal(matrix.results.find(x=>x.id==='strict-fail').classification,'regression');
  assert.equal(matrix.results.find(x=>x.id==='observe-diff').classification,'review');
  assert.equal(matrix.results.find(x=>x.id==='observe-diff').pass,true);
  assert.equal(matrix.results.find(x=>x.id==='strict-fail').criticalDifferences.length,2);
  assert.equal(matrix.results.find(x=>x.id==='observe-diff').warningDifferences.length,1);
  console.log(JSON.stringify({ok:true,module:'tcc-v9-shadow-scenario-matrix',summary:matrix.summary},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
