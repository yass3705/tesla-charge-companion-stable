#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const engine=require(path.resolve(process.argv[2]));
const tesla=require(path.resolve(process.argv[3]));
let checks=0;
const close=(actual,expected,name)=>{
 assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-6,
    name+': got '+actual+' expected '+expected);checks++;
};
const session=(durationMinutes,startAt='2026-10-10T09:00:00+02:00',timeZone='Europe/Paris')=>({
 startAt,timeZone,durationMinutes,chargingMinutes:Math.min(40,durationMinutes),
 energyKwh:0,targetSoc:75,arrivalSoc:20,includeCongestionFees:true
});
const offer=(id,rule,provider='Electra eMSP')=>({id,currency:'EUR',provider,
 pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0,...rule}]}});
function checkAdd(id,rule,minutes,expected,start){
 const r=engine.evaluateOffer(offer(id,rule),session(minutes,start));
 assert.equal(r.complete,true,id+': '+JSON.stringify(r));
 close(r.components.afterMinutes?.costEur,expected,id+'_'+minutes);
}
checkAdd('electra-msp-example',{afterMinutesRate:.3,afterMinutesThreshold:60},50,0);
checkAdd('electra-msp-example',{afterMinutesRate:.3,afterMinutesThreshold:60},60,0);
checkAdd('electra-msp-example',{afterMinutesRate:.3,afterMinutesThreshold:60},200,42);
checkAdd('pluginn-direct',{afterMinutesRate:.3,afterMinutesThreshold:60},61,.3);
checkAdd('sigeif-24',{afterMinutesRate:.2,afterMinutesThreshold:120},200,16);
const sig={afterMinutesRate:.05,afterMinutesThreshold:180,afterMinutesCap:4,
 afterMinutesCapStart:'20:00',afterMinutesCapEnd:'08:00'};
checkAdd('sigeif-7-22',sig,300,6);
checkAdd('sigeif-7-22',sig,600,4,'2026-10-10T17:00:00+02:00');
checkAdd('sigeif-7-22',sig,600,13,'2026-10-10T14:00:00+02:00');
const unsafe=engine.evaluateOffer(offer('other-cpo',sig),session(600));
assert.equal(unsafe.complete,false);checks++;
const advanced=offer('electra-msp-split',{afterMinutesRate:.2,afterMinutesThreshold:60});
advanced.pricing.rules=[
 {scope:'timeWindow',start:'08:00',end:'20:00',pricePerKwh:0,afterMinutesRate:.2,afterMinutesThreshold:60},
 {scope:'timeWindow',start:'20:00',end:'08:00',pricePerKwh:0,afterMinutesRate:.05,afterMinutesThreshold:60}
];
const split=engine.evaluateOffer(advanced,session(120,'2026-10-10T19:00:00+02:00'));
assert.equal(split.complete,true,JSON.stringify(split));
close(split.components.afterMinutes.costEur,3,'electra_multiple_windows');
function ts(cc,rule){
 const station={id:'tesla-example-'+cc,countryCode:cc,chargingConfigurations:[
   {id:cc+'-1',powerKw:250,pricing:{type:'rules',rules:[{scope:'allDay',...rule}]}}]};
 return tesla.normalizeStation(station).offers[0];
}
const ch=ts('CH',{billing:'kwh',currency:'CHF',pricePerKwh:.5});
assert.equal(ch.currency,'CHF');checks++;
close(engine.evaluateOffer(ch,{...session(45),energyKwh:20}).totalEur,10,'swiss_native_chf');
const uk=ts('GB',{billing:'minute',currency:'GBP',chargePerMinute:1});
assert.equal(uk.currency,'GBP');checks++;
close(engine.evaluateOffer(uk,{...session(20),chargingMinutes:20}).totalEur,20,'tesla_minute_single_fee');
const ma=ts('MA',{billing:'powerMinute',currency:'MAD',
 powerBands:[{minKw:0,maxKw:60,ratePerMinute:.5},{minKw:60,maxKw:100,ratePerMinute:1},
 {minKw:100,maxKw:180,ratePerMinute:2},{minKw:180,maxKw:250,ratePerMinute:3}]});
assert.equal(ma.currency,'MAD');checks++;
const maSession={...session(20,'2026-10-10T10:00:00+01:00','Africa/Casablanca'),
 durationMinutes:20,chargingMinutes:20,
 powerSegments:[{startMin:0,endMin:10,powerKw:50},{startMin:10,endMin:20,powerKw:120}]};
const missingPower=engine.evaluateOffer(ma,{...maSession,powerSegments:null});
assert.equal(missingPower.complete,false);checks++;
assert.equal(missingPower.reason,'tesla_power_curve_required');checks++;
const power=engine.evaluateOffer(ma,maSession);
assert.equal(power.complete,true,JSON.stringify(power));
close(power.totalEur,25,'tesla_ma_dynamic_50_120kw_native_mad');
const timed=engine.evaluateOffer(ma,{...maSession,powerSegments:null,
 chargeTimeline:[{offsetMinutes:0,durationMinutes:10,powerKw:50},
                 {offsetMinutes:10,durationMinutes:10,powerKw:120}]});
close(timed.totalEur,25,'tesla_ma_timeline');
close(engine.evaluateOffer(offer('unaffected-cpo',{pricePerKwh:.5}),
 {...session(45),energyKwh:20}).totalEur,10,'standard_cpo_unchanged');
console.log('TCC_V9_RUNTIME_FIX_VALIDATED='+JSON.stringify({checks,
 electraAfterMinutes:true,sigeifNight:true,teslaChfGbpMad:true,
 noDoubleMinute:true,dynamicPower:true,failClosed:true}));
