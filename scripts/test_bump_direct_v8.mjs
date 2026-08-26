import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.document={readyState:'loading',addEventListener(){},dispatchEvent(){}};
globalThis.CustomEvent=class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}};
const source=fs.readFileSync(new URL('../assets/v8-bump-direct.js',import.meta.url),'utf8');
vm.runInThisContext(source,{filename:'v8-bump-direct.js'});
const B=globalThis.TCCBumpDirectV8;
assert.ok(B,'Bump runtime export missing');

const fakeCatalog={dataset:'bump-direct-tariffs-tcc-france',operator:'Bump',country:'FR',scope:{directCpoOnly:true,roamingIncluded:false,unresolvedCasesNeverRankable:true},counts:{franceStations:1506,francePoints:2252,rankablePoints:2074,unresolvedPoints:178},variableParseFailures:[],stations:[]};
assert.equal(B.validateCatalog(fakeCatalog),fakeCatalog);
assert.equal(B.isBumpOperator({operator:'Bump'}),true);
assert.equal(B.isBumpOperator({operator:'Electroverse'}),false);

const flatPolicy={components:{energyEurPerKwh:.55,minPriceEur:.5},rules:[
 {kind:'minimum_total',amountEur:.5},
 {kind:'flat_fee',amountEur:1.2,conditions:[{kind:'energy_above_kwh',value:.5}]},
 {kind:'energy',eurPerKwh:.55}
]};
assert.equal(B.bumpExtras(flatPolicy,600,20,.5,'','10:00').flat,0);
assert.equal(B.bumpExtras(flatPolicy,600,20,.51,'','10:00').flat,1.2);
assert.equal(B.bumpExtras(flatPolicy,600,20,.51,'','10:00').minimum,.5);

const conditionalFlat={components:{energyEurPerKwh:.45,minPriceEur:.5},rules:[
 {kind:'flat_fee',amountEur:1,conditions:[{kind:'energy_above_kwh',value:1},{kind:'session_duration_after_minutes',value:1}]},
 {kind:'energy',eurPerKwh:.45}
]};
assert.equal(B.bumpExtras(conditionalFlat,600,.5,2,'10:01','10:00').flat,0);
assert.equal(B.bumpExtras(conditionalFlat,600,2,2,'','10:00').flat,1);

const durationPolicy={components:{energyEurPerKwh:.69,minPriceEur:.5},rules:[
 {kind:'energy',eurPerKwh:.69},{kind:'session_duration_surcharge',eurPerMinute:.29,afterMinutes:75}
]};
assert.ok(Math.abs(B.bumpExtras(durationPolicy,600,100,20,'','10:00').duration-7.25)<1e-9);

const occupancyPolicy={components:{energyEurPerKwh:.54,minPriceEur:.5},rules:[
 {kind:'energy',eurPerKwh:.54},{kind:'post_charge_occupancy',eurPerMinute:.2,graceMinutes:15}
]};
assert.ok(Math.abs(B.bumpExtras(occupancyPolicy,600,30,10,'11:00','10:00').idle-3)<1e-9);

const bandPolicy={components:{energyEurPerKwh:.25,minPriceEur:.5},rules:[
 {kind:'minimum_total',amountEur:.5},
 {kind:'energy_time_bands',bands:[{start:'10:00',end:'17:00',eurPerKwh:.25},{start:'17:00',end:'10:00',eurPerKwh:.395}]}
]};
const pricing=B.basePricing({components:bandPolicy.components,rules:bandPolicy.rules});
assert.equal(pricing.rules.length,2);
assert.equal(pricing.rules[0].pricePerKwh,.25);
assert.equal(pricing.rules[1].pricePerKwh,.395);

const nightOccupancy={components:{energyEurPerKwh:.45,minPriceEur:.5},rules:[
 {kind:'energy',eurPerKwh:.45},
 {kind:'post_charge_occupancy_time_bands',bands:[
  {start:'23:00',end:'09:00',eurPerMinute:0,graceMinutes:0},
  {start:'09:00',end:'23:00',eurPerMinute:.2,graceMinutes:15}
 ]}
]};
assert.equal(B.bumpExtras(nightOccupancy,22*60+50,20,10,'00:10','22:50').idle,0);

console.log('Bump V8 direct runtime tests: OK');
