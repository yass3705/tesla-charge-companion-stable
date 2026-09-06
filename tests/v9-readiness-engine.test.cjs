const assert=require('node:assert/strict');
const Ready=require('../assets/v9/readiness-engine.js');

const parity={gates:{noV8Loss:true,noCriticalDifferences:true,sessionParity:true},summary:{v8OnlyCount:0,errorCount:0,sessionErrorCount:0}};
const matrix={summary:{matrixPass:true,strictFailedCount:0,strictPassedCount:5,strictScenarioCount:5}};
const area={diagnostics:{sessionEvaluatedStationCount:100,sessionComparableStationCount:98,scoredStationCount:100,fullyScoredStationCount:97,routingRequestedCount:80,routedStationCount:80,routingErrorCount:0}};
const ci={checks:[{name:'V9 unified data engine',conclusion:'success'},{name:'V9 pricing engine',conclusion:'success'},{name:'V9 shadow parity',conclusion:'success'}]};

let report=Ready.assess({parity,matrix,area,ci},{requireCi:true});
assert.equal(report.verdict,'READY');assert.equal(report.summary.blockerCount,0);

report=Ready.assess({parity:{...parity,gates:{...parity.gates,noV8Loss:false},summary:{...parity.summary,v8OnlyCount:1}},matrix,area,ci},{requireCi:true});
assert.equal(report.verdict,'BLOCKED');assert(report.blockers.some(x=>x.id==='parity-no-v8-loss'));

report=Ready.assess({parity,matrix:{summary:{matrixPass:false,strictFailedCount:1,strictPassedCount:4,strictScenarioCount:5}},area,ci},{requireCi:true});
assert.equal(report.verdict,'BLOCKED');assert(report.blockers.some(x=>x.id==='matrix-strict'));

report=Ready.assess({parity,matrix,area:{diagnostics:{sessionEvaluatedStationCount:100,sessionComparableStationCount:90,scoredStationCount:100,fullyScoredStationCount:99,routingRequestedCount:80,routedStationCount:79,routingErrorCount:1}},ci},{requireCi:true});
assert.equal(report.verdict,'BLOCKED');assert(report.blockers.some(x=>x.id==='runtime-session-comparable'));assert(report.blockers.some(x=>x.id==='runtime-routing-errors'));

report=Ready.assess({parity,matrix,area,ci:null},{requireCi:true});
assert.equal(report.verdict,'BLOCKED');assert(report.blockers.some(x=>x.id==='ci-required'));

report=Ready.assess({parity,matrix,area,ci},{requireCi:true,minComparableSessionRatio:.99});
assert.equal(report.verdict,'BLOCKED');

console.log(JSON.stringify({ok:true,module:'tcc-v9-readiness-engine',checks:['v8-coverage','critical-parity','strict-matrix','session-comparability','full-score-ratio','routing-success','routing-errors','ci-required']},null,2));
