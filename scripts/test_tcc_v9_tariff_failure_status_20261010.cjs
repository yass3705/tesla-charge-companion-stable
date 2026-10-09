#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const shell=require(path.resolve(process.argv[2]));
let checks=0;
const expect=(name,real,want)=>{assert.equal(real,want,name);checks++;};
function offer(id,pricing,metadata={}){return{id,provider:'Electra',kind:'direct',currency:'EUR',pricing,metadata};}
function item(offerId,reason){return{offerId,provider:'Electra',kind:'direct',currency:'EUR',
  result:{complete:false,reason},comparable:false,total:null};}
const pricing={type:'rules',rules:[{scope:'allDay',pricePerKwh:.42}]};
const station={id:'test',physicalOperator:{name:'Electra'},offers:[offer('rule-a',pricing)]};
const noRules={id:'unknown',physicalOperator:{name:'Other'},
  offers:[offer('unpriced',{type:'rules',rules:[]})]};
function evalOf(i){return{best:null,alternatives:[],incomplete:i?[i]:[]};}
expect('no offers truly unavailable',shell.tariffFailureLabel(evalOf(),station),'Tarif indisponible');
expect('empty rules unavailable',shell.tariffFailureLabel(evalOf(item('unpriced','source_tariff_unavailable')),noRules),'Tarif indisponible');
expect('ambiguous time cap incalculable',shell.tariffFailureLabel(evalOf(item('rule-a','after_minutes_unverified_time_cap')),station),'Tarif incalculable');
expect('incomplete power curve incalculable',shell.tariffFailureLabel(evalOf(item('rule-a','tesla_power_curve_required')),station),'Tarif incalculable');
expect('no matching time price with rules incalculable',shell.tariffFailureLabel(evalOf(item('rule-a','no_matching_time_rule')),station),'Tarif incalculable');
expect('source with rate yet FX missing incalculable',shell.tariffFailureLabel(evalOf(item('rule-a','missing_fx_rate')),station),'Tarif incalculable');
expect('direct lane calculation failed',shell.tariffLaneState(evalOf(item('rule-a','unknown_post_charge_fee')),station,'direct').status,'unresolved');
expect('direct lane source missing',shell.tariffLaneState(evalOf(item('unpriced','source_tariff_unavailable')),noRules,'direct').status,'missing');
expect('no direct lane offer',shell.tariffLaneState(evalOf(),station,'direct').status,'missing');
let html=shell.renderTariffs(evalOf(item('rule-a','after_minutes_unverified_time_cap')),station);
assert.match(html,/Tarif incalculable/);checks++;
assert.match(html,/Tarif indisponible/);checks++;
html=shell.renderTariffs(evalOf(item('unpriced','source_tariff_unavailable')),noRules);
assert.doesNotMatch(html,/Tarif incalculable/);checks++;
const tesla={id:'tesla-somewhere',physicalOperator:{name:'Tesla'},offers:[offer('tesla-rule',pricing)]};
expect('Tesla power curve computed unavailable',shell.tariffFailureLabel(evalOf(item('tesla-rule','tesla_power_curve_required')),tesla),'Tarif incalculable');
html=shell.renderTariffs(evalOf(item('tesla-rule','tesla_power_curve_required')),tesla);
assert.match(html,/Tarif incalculable/);checks++;
const noTesla={id:'tesla-no-price',physicalOperator:{name:'Tesla'},offers:[offer('tesla-empty',{type:'rules',rules:[]})]};
html=shell.renderTariffs(evalOf(item('tesla-empty','source_tariff_unavailable')),noTesla);
assert.match(html,/Tarif indisponible/);checks++;
const ambStation={...station,offers:[offer('rule-a',pricing,{tariffAmbiguous:true})]};
expect('conflicting CPO source lane',shell.tariffLaneState(evalOf(item('rule-a','tariff_ambiguous')),ambStation,'direct').status,'ambiguous');
html=shell.renderTariffs(evalOf(item('rule-a','tariff_ambiguous')),ambStation);
assert.match(html,/Tarif incalculable/);checks++;
console.log('TCC_V9_TARIFF_STATUS_UI_PASS='+checks);
