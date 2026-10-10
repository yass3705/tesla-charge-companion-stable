'use strict';
const assert=require('node:assert/strict');
const Pricing=require('../v9-production-runtime/assets/v9/pricing-engine.js');
const Session=require('../v9-production-runtime/assets/v9/session-engine.js');
const Bridge=require('../v9-production-shell/bridge.js');
function near(a,b,msg){assert.ok(Math.abs(a-b)<1e-5,msg+': '+a+' vs '+b);}
const policy={requiresSaturation:true,startsAtSoc:80,graceMinutes:5,rateEurPerMinute:0.40,capEur:50,dcOnly:true};
const rule={scope:'allDay',start:'00:00',end:'24:00',pricePerKwh:0.49,
  congestionStartSoc:80,congestionTimePerMinute:0,
  ocpiCongestionDurationBands:[[0,300,0],[300,7800,0.4]],
  electraCongestionPolicy:policy};
const s={includeCongestionFees:true,assumeStationSaturated:true,chargingKind:'DC',arrivalSoc:70,targetSoc:90};
let r=Pricing.evaluateCongestion(rule,s,40,0,40);
assert.equal(r.complete,true);near(r.costEur,6,'SOC80 crossing + five-minute grace (15 billed minutes)');
r=Pricing.evaluateCongestion(rule,{...s,includeCongestionFees:false},40,0,40);
near(r.costEur,0,'default-off option');
r=Pricing.evaluateCongestion(rule,{...s,chargingKind:'AC'},40,0,40);
near(r.costEur,0,'no congestion on AC');
r=Pricing.evaluateCongestion(rule,{...s,assumeStationSaturated:false},40,0,40);
assert.equal(r.complete,false);assert.equal(r.reason,'electra_congestion_saturation_unconfirmed');
r=Pricing.evaluateCongestion(rule,{...s,arrivalSoc:85,targetSoc:99},200,0,200);
near(r.costEur,50,'50 EUR cap');
const offer={id:'electra-time-window',provider:'Electra',currency:'EUR',
 pricing:{type:'rules',priceSelectionBasis:'session_start_local_time',rules:[
 {scope:'timeWindow',start:'11:00',end:'12:00',pricePerKwh:0.39,currency:'EUR'},
 {scope:'timeWindow',start:'12:00',end:'15:00',pricePerKwh:0.61,currency:'EUR'}
 ]}};
const crossing={startAt:'2026-10-10T09:55:00Z',timeZone:'Europe/Paris',energyKwh:20,durationMinutes:40,chargingMinutes:40,includeCongestionFees:false};
r=Session.evaluateSessionStartLockedOffer(offer,crossing);
assert.equal(r.complete,true);assert.equal(r.segmented,false);
near(r.totalEur,7.8,'start price persists beyond noon');
const later={...crossing,startAt:'2026-10-10T10:05:00Z'};
r=Session.evaluateSessionStartLockedOffer(offer,later);
near(r.totalEur,12.2,'later session uses the newer start bracket');
const defaultSession=Bridge.buildSession({startSoc:30,targetSoc:80,startAt:crossing.startAt,condition:'normal',profile:'realistic'});
assert.equal(defaultSession.includeCongestionFees,false,'UI must not apply congestion by default');
console.log('PASS Electra: station toggle default off, price lock, SOC80 saturation grace cap AC excluded');
