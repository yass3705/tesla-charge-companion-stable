const assert=require('node:assert/strict');
const Adapter=require('../assets/v9/adapters/morocco-kilowatt.js');

const fixture={stations:[
  {id:'a',name:'Kilowatt',address:'A',city:'Rabat',latitude:34,longitude:-6,status:'available',connectors:[{type:'Type 2',power_kw:22}],production_candidate:true,site_brand:null,tariff_channel:null,status_source:'Kilowatt public web map'},
  ...Array.from({length:42},(_,i)=>({id:`p${i}`,name:'Kilowatt',address:`A${i}`,city:'MA',latitude:30+(i%6),longitude:-9+(i%6)/10,status:'available',connectors:[{type:'Type 2',power_kw:22}],production_candidate:true,site_brand:null,tariff_channel:null,status_source:'Kilowatt public web map'})),
  {id:'x1',latitude:59.9,longitude:10.74,status:'available',connectors:[{type:'Type 2',power_kw:22}],production_candidate:false},
  {id:'x2',latitude:59.9,longitude:10.74,status:'available',connectors:[{type:'Type 2',power_kw:22}],production_candidate:false},
  {id:'x3',latitude:59.9,longitude:10.74,status:'available',connectors:[{type:'Type 2',power_kw:22}],production_candidate:false},
  {id:'x4',latitude:59.9,longitude:10.74,status:'available',connectors:[{type:'Type 2',power_kw:22}],production_candidate:false}
]};

const v=Adapter.validateDataset(fixture);assert.equal(v.ok,true);assert.equal(v.rawCount,47);assert.equal(v.productionCount,43);
const out=Adapter.normalizeDataset(fixture);assert.equal(out.length,43);assert.ok(out.every(s=>s.physicalOperator.name==='Kilowatt'));assert.ok(out.every(s=>s.offers.length===0),'unresolved tariff must not become free');assert.ok(out.every(s=>s.status.state==='available'));assert.ok(out.every(s=>s.access.appSource==='Kilowatt public web map'));assert.ok(out.every(s=>s.access.accessNetwork==='Kilowatt'));assert.ok(out.every(s=>s.evses[0].connectors[0].powerKw===22));assert.ok(out.every(s=>s.evses[0].connectors[0].kind==='AC'));
assert.equal(Adapter.stationState('faulted'),'out_of_service');assert.equal(Adapter.stationState('offline'),'out_of_service');assert.equal(Adapter.stationState('unknown'),'out_of_service');assert.equal(Adapter.stationState('unavailable'),'out_of_service');
console.log(JSON.stringify({ok:true,raw:v.rawCount,production:v.productionCount,tariffDefault:'unresolved',powerKw:22,connector:'Type 2'},null,2));
