const assert=require('assert');
const api=require('../assets/ocpi-access-intervals.js');

let fallbackCalls=0;
const scope={
  accessStatus(){fallbackCalls+=1;return {canStart:true,remaining:999,label:'fallback'};}
};
api.install(scope);

const station={access:{ocpiIntervals:{date:'2026-08-29',intervals:[['08:00','12:00'],['13:00','18:00']]}}};
let r=scope.accessStatus(station,'2026-08-29','09:00');
assert.equal(r.canStart,true);assert.equal(r.remaining,180);assert.equal(r.close,'12:00');

r=scope.accessStatus(station,'2026-08-29','12:30');
assert.equal(r.canStart,false);assert.equal(r.remaining,0);

r=scope.accessStatus(station,'2026-08-29','17:00');
assert.equal(r.canStart,true);assert.equal(r.remaining,60);assert.equal(r.close,'18:00');

r=scope.accessStatus(station,'2026-08-30','09:00');
assert.equal(r.label,'fallback');assert.equal(fallbackCalls,1);

assert.deepEqual(api.normalize([['08:00','10:00'],['09:30','12:00'],['14:00','15:00']]),[[480,720],[840,900]]);

const closed={access:{ocpiIntervals:{date:'2026-08-29',intervals:[]}}};
r=scope.accessStatus(closed,'2026-08-29','09:00');
assert.equal(r.canStart,false);assert.equal(r.label,'Fermé ce jour');

console.log('OCPI access interval tests: OK');
