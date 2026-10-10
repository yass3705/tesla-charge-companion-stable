#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const file=process.argv[2];
if(!file)throw Error('Usage node test_tcc_v9_incalculable_status.cjs path/to/bridge.js');
const code=fs.readFileSync(file,'utf8');
assert.ok(code.includes('Tarif incalculable'),'Missing uncomputable text');
assert.ok(code.includes('Tarif indisponible'),'Missing unavailable text');
assert.ok(!code.includes('Tarif ambigu à vérifier auprès de l’opérateur'),'Old ambiguous label not removed');
const begin=code.indexOf('  function sourcePriceIsPresent('),end=code.indexOf('  function congestionLaneKey(',begin);
assert.ok(begin>=0&&end>begin,'Tariff-status code not found in actual bridge');
const ctx={
  text:v=>v==null?'':String(v),
  num:v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null
};
vm.createContext(ctx);
vm.runInContext(code.slice(begin,end),ctx);
vm.runInContext("function offerPriceCategory(item){return item.provider==='Electroverse eMSP'?'electroverse':'direct'}",ctx);
const state=(offers,station={offers:[]},category='electroverse')=>
 ctx.tariffLaneState({best:null,alternatives:[],incomplete:offers},station,category);
function check(name,condition){
 assert.ok(condition,'Incorrect tariff state: '+name);
 console.log('TCC_TARIFF_STATUS_TEST '+name+' PASS');
}
const item=(reason='tariff_source_conflict',provider='Electroverse eMSP')=>({
  provider,offerId:'Electroverse-test',currency:'EUR',comparable:false,total:null,
  result:{complete:false,reason}
});
check('absent_tariff_is_unavailable',ctx.tariffFailureLabel({incomplete:[]},{offers:[]})==='Tarif indisponible');
check('published_source_but_missing_session_is_uncalculable',
  ctx.tariffFailureLabel({incomplete:[item('power_curve_required')]},{offers:[{
    id:'Electroverse-test',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:0.5}]}
  }]})==='Tarif incalculable');
const evseId='FRMGPE94015AB1P1';
const ambiguousSource={offers:[{
 id:'Electroverse-test',
 metadata:{tariffAmbiguous:true,ambiguousPdcIds:[evseId]},
 pricing:{type:'rules',rules:[]}
}],evses:[{id:evseId}]};
check('electroverse_conflicting_evse_detected',
  state([item('tariff_source_conflict')],ambiguousSource).status==='ambiguous');
check('electroverse_conflict_label',
  ctx.tariffFailureLabel({incomplete:[item('ambiguous_source_tariff')]},ambiguousSource)==='Tarif incalculable');
check('missing_offer_source_classifies_unavailable',
  ctx.tariffFailureLabel({incomplete:[item('source_price_absent')]},{offers:[]})==='Tarif indisponible');
check('unpriced_tesla_missing_rule_unavailable',
  ctx.tariffFailureLabel({incomplete:[{...item('tariff_missing','Tesla'),offerId:'tesla-30168'}]},
    {offers:[{id:'tesla-30168',pricing:{type:'rules',rules:[]}}]})==='Tarif indisponible');
console.log('TCC_V9_TARIFF_STATUS_TESTS_PASS=6');
