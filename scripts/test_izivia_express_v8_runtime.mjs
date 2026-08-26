import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code=fs.readFileSync('assets/v8-izivia-express-direct-overlay.js','utf8');
const sandbox={
  console,
  document:{readyState:'complete',addEventListener(){}},
  setInterval(fn){fn();return 1;},clearInterval(){},
  fetch(){return Promise.reject(new Error('network disabled in runtime unit test'));},
  candidateStations:async()=>({stations:[],origin:{lat:48,lon:2},maxDistanceKm:20}),
  priceWithRules(){return{total:999,connection:999,chargeCost:999,idleCost:999,durationSurcharge:999,occupiedMinutes:0,currencies:['EUR']};}
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(code,sandbox,{filename:'v8-izivia-express-direct-overlay.js'});
const api=sandbox.TCCV8IziviaExpressDirect;
assert.ok(api&&typeof api.exactCost==='function');
assert.equal(typeof sandbox.priceWithRules,'function');

const rule=exact=>({type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:0,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}],iziviaExact:exact});
const close=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

const cap={family:'session_cap',currency:'EUR',energy:{ratePerKwhEur:.55,billing:'started_kwh'},postCharge:{billing:'started_block',blockMinutes:5,blockFeeEur:1},sessionCapEur:50};
let x=api.exactCost(rule(cap),600,30,10.1,'10:36','10:00');
close(x.chargeCost,6.05);close(x.idleCost,2);close(x.total,8.05);assert.equal(x.postChargeMinutes,6);
x=api.exactCost(rule(cap),600,30,100.1,'12:00','10:00');
close(x.total,50);assert.ok(x.capSavings>0);
x=api.exactCost(rule(cap),600,30,10.1,'','10:00');
close(x.total,6.05);close(x.idleCost,0);

const dayNight={family:'day_night_included_energy',currency:'EUR',tariffSelection:'connection_start_local_time',day:{start:'08:00',end:'20:00',energy:{ratePerKwhEur:.42,billing:'started_kwh'},postCharge:{billing:'started_minute',ratePerMinuteEur:4/60}},night:{start:'20:00',end:'08:00',connectionFeeEur:6,includedEnergyKwh:20,extraEnergy:{ratePerKwhEur:.30,billing:'started_kwh'}}};
x=api.exactCost(rule(dayNight),600,20,10.1,'10:24','10:00');
close(x.chargeCost,4.62);close(x.idleCost,4*(4/60));close(x.total,4.62+4*(4/60));assert.equal(x.night,false);
x=api.exactCost(rule(dayNight),1260,20,19.9,'','21:00');close(x.total,6);assert.equal(x.night,true);
x=api.exactCost(rule(dayNight),1260,20,20.1,'','21:00');close(x.total,6.3);
x=api.exactCost(rule(dayNight),1260,20,21.2,'','21:00');close(x.total,6.6);
assert.equal(api.exactCost(rule(dayNight),479,10,5,'','07:59').night,true);
assert.equal(api.exactCost(rule(dayNight),480,10,5,'','08:00').night,false);
assert.equal(api.exactCost(rule(dayNight),1199,10,5,'','19:59').night,false);
assert.equal(api.exactCost(rule(dayNight),1200,10,5,'','20:00').night,true);

const simple={family:'simple_postcharge',currency:'EUR',energy:{ratePerKwhEur:.55,billing:'started_kwh'},postCharge:{billing:'started_block',blockMinutes:5,blockFeeEur:2}};
x=api.exactCost(rule(simple),600,30,20.1,'10:36','10:00');close(x.chargeCost,11.55);close(x.idleCost,4);close(x.total,15.55);

const wrapped=sandbox.priceWithRules(rule(cap),600,30,10.1,'10:36','10:00',[]);
close(wrapped.total,8.05);assert.equal(wrapped.iziviaExactPricing,true);assert.notEqual(wrapped.total,999);
const untouched=sandbox.priceWithRules({type:'rules',rules:[]},600,30,10,'','','');assert.equal(untouched.total,999);

assert.throws(()=>api.validateExact({...cap,currency:'USD'}));
assert.throws(()=>api.validateExact({family:'unknown',currency:'EUR'}));
console.log('IZIVIA Express exact V8 runtime tests: OK');
