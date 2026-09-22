const assert=require('node:assert/strict');
const FastVolt=require('../assets/v9/adapters/morocco-fastvolt.js');

const sample={
  schema_version:3,
  chargers:[
    {charger_id:'W00057',charger_name:'Station-service Afriquia AL Boustane ADM bouznika',latitude:33.777776,longitude:-7.233264,production_candidate:true,ccs_count:1,chademo_count:0,type2_count:1,max_output:100,brand:'Circontrol',model:'Raption 100',state:'Casablanca-Settat'},
    ...Array.from({length:96},(_,i)=>({charger_id:`T${i}`,charger_name:`Test ${i}`,latitude:33,longitude:-7,production_candidate:true,ccs_count:1,chademo_count:0,type2_count:0,max_output:50})),
    ...Array.from({length:3},(_,i)=>({charger_id:`X${i}`,charger_name:`Excluded ${i}`,latitude:33,longitude:-7,production_candidate:false,production_exclusion_reason:'test_or_reserve_entry'}))
  ]
};

const validation=FastVolt.validateDataset(sample);
assert.equal(validation.ok,true);
assert.equal(validation.rawCount,100);
assert.equal(validation.productionCount,97);
const rows=FastVolt.normalizeDataset(sample);
assert.equal(rows.length,97);
const al=rows.find(r=>r.sourceStationId==='W00057');
assert.ok(al);
assert.equal(al.physicalOperator.name,'FastVolt / Afrimobility');
assert.equal(al.access.siteBrand,'Afriquia');
assert.equal(al.access.accessNetwork,'FastVolt');
assert.equal(al.status.state,'unknown','public map regional state must not become live charger status');
assert.equal(al.evses[0].connectors.filter(c=>c.kind==='DC').length,4);
assert.equal(al.evses[0].connectors.filter(c=>c.kind==='AC').length,2);
assert.ok(al.evses[0].connectors.filter(c=>c.kind==='DC').every(c=>c.powerKw===360));
assert.ok(al.evses[0].connectors.filter(c=>c.kind==='AC').every(c=>c.powerKw===22));
const dc=al.offers.find(o=>o.connectorKinds.includes('DC'));
const ac=al.offers.find(o=>o.connectorKinds.includes('AC'));
assert.equal(dc.pricing.rules[0].chargePerMinute,2.5);
assert.equal(ac.pricing.rules[0].chargePerMinute,0.5);
console.log(JSON.stringify({ok:true,raw:validation.rawCount,production:validation.productionCount,alBoustane:{connectors:al.evses[0].connectors.length,siteBrand:al.access.siteBrand,status:al.status.state}},null,2));