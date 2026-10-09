#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const engine=require(path.resolve(process.argv[2]));
const reference=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const raw=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
const overlay=JSON.parse(fs.readFileSync(process.argv[5],'utf8'));
const selected=[...raw,...overlay].filter(x=>(x.offer?.pricing?.rules||[]).some(r=>Number(r.afterMinutesRate)>0));
assert.equal(selected.length,84,'France 84 real source offers must be present');
const expected=new Map(reference.rows.map(x=>[x.offerId+'|'+x.durationMinutes,x]));
let complete=0,issues=[],providers={};
for(const x of selected){
 providers[x.provider]=(providers[x.provider]||0)+1;
 for(const duration of [50,61,90,120,180,200,300]){
  const session={energyKwh:20,chargingMinutes:Math.min(40,duration),durationMinutes:duration,
   startAt:'2026-10-10T10:00:00+02:00',timeZone:'Europe/Paris',
   includeCongestionFees:true,vehicleSoc:50,targetSoc:80};
  const result=engine.evaluateOffer(x.offer,session),gold=expected.get(x.offer.id+'|'+duration);
  if(!gold){issues.push({id:x.offer.id,duration,reason:'missing_golden_case'});continue;}
  if(!result.complete){issues.push({id:x.offer.id,duration,reason:result.reason});continue;}
  const actual=Number(result.components?.afterMinutes?.costEur);
  if(!Number.isFinite(actual)||Math.abs(actual-gold.extraEur)>0.00001)
   issues.push({id:x.offer.id,duration,actual,expected:gold.extraEur,reason:'extra_surcharge_mismatch'});
  else complete++;
 }
}
const summary={offers:selected.length,profilesPerOffer:7,complete,
  mismatchCount:issues.length,providers,examples:issues.slice(0,12)};
console.log('FRANCE_84_REAL_V9_RUNTIME_REGRESSION='+JSON.stringify(summary));
assert.equal(complete,588,'All 588 real source profiles must match golden staging surcharge');
assert.equal(issues.length,0,'No real-tariff computation exceptions');
