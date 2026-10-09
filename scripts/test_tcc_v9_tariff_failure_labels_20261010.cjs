#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const bridge=fs.readFileSync(process.argv[2],'utf8');
const helper=fs.readFileSync(__dirname+'/tcc_v9_tariff_failure_labels_20261010.js','utf8');
assert.equal((bridge.match(/function tariffFailureLabel\(/g)||[]).length,1,'UI classifier injected exactly once');
const label=vm.runInNewContext(helper+'\n;tariffFailureLabel;',{});
let checks=0;
const check=(name,rows,station,status,expected)=>{
  const actual=label(rows,station,status);
  assert.equal(actual,expected,name);
  checks++;
};
const mk=(id,pricing,metadata)=>({id,pricing,metadata});
const profile={type:'rules',rules:[{scope:'allDay',pricePerKwh:.29}]};
const power={type:'rules',rules:[{scope:'allDay',billing:'powerMinute',
  powerBands:[{minKw:0,maxKw:60,ratePerMinute:1}]}]};
const empty={type:'rules',rules:[]};
const single=(reason,more={})=>({offerId:'source-a',result:{complete:false,reason},
  comparable:false,total:null,...more});
const station=(pricing,metadata)=>({offers:[mk('source-a',pricing,metadata)]});
check('no offers = unavailable',[],station(empty),'missing','Tarif indisponible');
check('Tesla actual power trace unknown = incalculable',
 [single('tesla_power_curve_required')],station(power),'unresolved','Tarif incalculable');
check('Power curve gap = incalculable',
 [single('tesla_power_curve_gap_or_overlap')],station(power),'unresolved','Tarif incalculable');
check('Electra surcharge cap window unknown = incalculable',
 [single('after_minutes_unverified_time_cap')],station(profile),'unresolved','Tarif incalculable');
check('EVSE tariff attribution flagged = incalculable',
 [single('tariff_attribution_missing_evse_evidence')],station(profile),'ambiguous','Tarif incalculable');
check('Metadata ambiguous = incalculable',
 [single('fallback',{incompletePricingReason:'unresolved_tariff'})],
 station(profile,{tariffAmbiguous:true}),'unresolved','Tarif incalculable');
check('No source pricing rules = unavailable',
 [single('no_matching_time_rule')],station(empty),'unresolved','Tarif indisponible');
check('Explicit missing source = unavailable',
 [single('tariff_unavailable')],station(empty),'unresolved','Tarif indisponible');
check('No applicable period = unavailable',
 [single('offer_outside_validity_window')],station(profile),'unresolved','Tarif indisponible');
check('Currency conversion absent = incalculable',
 [single(null,{result:{complete:true},currency:'GBP',targetCurrency:'EUR'})],
 station(profile),'unresolved','Tarif incalculable');
check('Explicit tariff conflict even before offer = incalculable',
 [],station(empty),'ambiguous','Tarif incalculable');
check('Empty null rows = unavailable',
 [null,undefined],station(empty),'unresolved','Tarif indisponible');
check('Tariff with only charging-minute component = incalculable',
 [single('charging_time_requires_duration')],
 station({type:'rules',rules:[{scope:'allDay',chargingTimePerMinuteEur:.1}]}),
 'unresolved','Tarif incalculable');
const required=[
 "const amount=state.status==='priced'?displayAmount(displayItem,fxRates)",
 "tariffFailureLabel(state.offers,station,state.status)",
 "tariffFailureLabel(failed,station,'unresolved')",
 "nearby.some(row=>tariffFailureLabel(",
 "TARIF-NEVER-SHOW"
];
for(const fragment of required.slice(0,-1)){
  assert.ok(bridge.includes(fragment),'rendering missing integration '+fragment);
  checks++;
}
assert.ok(!bridge.includes(required.at(-1)));checks++;
assert.ok(!bridge.includes("Tarif ambigu à vérifier auprès de l’opérateur"));checks++;
assert.ok(!bridge.includes("Tarif à vérifier auprès de l’opérateur"));checks++;
console.log('TCC_V9_TARIFF_STATUS_LABELS_VALIDATED='+JSON.stringify({
 checks,availableLabel:'Tarif indisponible',ambiguousLabel:'Tarif incalculable',
 sources:['Tesla','Electra eMSP','Electroverse','CPO direct','Abonnements']
}));
