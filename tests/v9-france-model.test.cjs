const assert=require('node:assert/strict');
const Engine=require('../assets/v9/data-engine.js');
const Crosswalk=require('../assets/v9/adapters/france-crosswalk.js');
const Status=require('../assets/v9/adapters/france-irve-status.js');
const Direct=require('../assets/v9/adapters/direct-offers.js');

const staticStation={
  canonicalId:'FR:irve:station-1',aliases:['irve-station:FR*S1','irve-pdc:FR*P1','irve-pdc:FR*P2'],sourceStationId:'FR*S1',countryCode:'FR',
  name:'IRVE Test',address:'1 rue Test',latitude:48.8,longitude:2.1,physicalOperator:{id:'operator-x',name:'Operator X'},networkBrand:'Network Y',
  evses:[
    {id:'FR*P1',aliases:['irve-pdc:FR*P1'],connectors:[{id:'c1',kind:'AC',powerKw:22}]},
    {id:'FR*P2',aliases:['irve-pdc:FR*P2'],connectors:[{id:'c2',kind:'DC',powerKw:150}]}
  ],status:{state:'unknown',sourceId:'france-national'}
};

async function crosswalkAndStatus(){
  const cross=Crosswalk.normalizePayload({entries:[{
    canonicalId:'FR:irve:station-1',idStationItinerance:'FR*S1',pdcIds:['FR*P1','FR*P2'],sourceIds:[{source:'ionity',id:'direct-123'}]
  }]}).stationFragments;
  const now=Date.parse('2026-08-29T20:00:00Z');
  const dynamic=Status.normalizePayload({records:[
    {id_station_itinerance:'FR*S1',id_pdc_itinerance:'FR*P1',etat_pdc:'hors_service',date_maj:'2026-08-29T19:30:00Z'},
    {id_station_itinerance:'FR*S1',id_pdc_itinerance:'FR*P2',etat_pdc:'en_service',date_maj:'2026-08-29T19:31:00Z'},
    {id_station_itinerance:'FR*OLD',id_pdc_itinerance:'FR*OLDP',etat_pdc:'hors_service',date_maj:'2026-08-29T10:00:00Z'}
  ]},{maxAgeMinutes:120,now}).stationFragments;
  assert.equal(dynamic.length,1,'stale dynamic status rows must be rejected before merge');
  assert.equal(dynamic[0].status.state,'available','one in-service PDC keeps the station available');

  const registry={sources:[
    {id:'france-crosswalk',countries:['FR'],priority:{identity:120},active:true},
    {id:'france-national',countries:['FR'],priority:{identity:55,connectors:60,status:0},active:true},
    {id:'france-irve-dynamic',countries:['FR'],priority:{status:85},active:true}
  ]};
  const engine=Engine.createEngine({registry,loaders:{
    'france-crosswalk':async()=>cross,
    'france-national':async()=>[staticStation],
    'france-irve-dynamic':async()=>dynamic
  }});
  const area=await engine.queryArea({countryCode:'FR'});
  assert.equal(area.stations.length,1,'crosswalk aliases must merge physical and dynamic fragments');
  const st=area.stations[0];
  assert.equal(st.name,'IRVE Test','sparse high-priority crosswalk must never blank physical identity fields');
  assert.equal(st.status.state,'available');
  assert.ok(st.aliases.some(a=>a.includes('ionity:direct-123')),'provider identity must survive as exact alias');
}

async function scopedOffers(){
  const payload=Direct.normalizePayload({country:'FR',directOffers:[
    {id:'wrong-station',provider:'Operator X',operatorIds:['operator-x'],stationIds:['other-station'],pricePerKwh:0.10},
    {id:'wrong-power',provider:'Operator X',operatorIds:['operator-x'],minPowerKw:200,pricePerKwh:0.20},
    {id:'right-dc',provider:'Operator X',operatorIds:['operator-x'],evseIds:['FR*P2'],minPowerKw:100,maxPowerKw:180,connectorKinds:['DC'],pricePerKwh:0.30},
    {id:'right-ac',provider:'Operator X',operatorIds:['operator-x'],evseIds:['FR*P1'],maxPowerKw:22,connectorKinds:['AC'],pricePerKwh:0.40},
    {id:'right-network',provider:'Network Y tariff',operatorAliases:['other-technical-cpo'],networkAliases:['Network Y'],pricePerKwh:0.50},
    {id:'wrong-network',provider:'Network Z tariff',operatorAliases:['other-technical-cpo'],networkAliases:['Network Z'],pricePerKwh:0.60},
    {id:'physical-only',provider:'Physical tariff',operatorAliases:['operator-x'],networkAliases:['Network Z'],directOperatorOnly:true,pricePerKwh:0.70}
  ]});
  const registry={sources:[
    {id:'france-national',countries:['FR'],priority:{identity:55,connectors:60},active:true},
    {id:'france-direct',countries:['FR'],priority:{tariff:95},active:true}
  ]};
  const engine=Engine.createEngine({registry,loaders:{'france-national':async()=>[staticStation],'france-direct':async()=>payload}});
  const st=(await engine.queryArea({countryCode:'FR'})).stations[0];
  assert.ok(st.offers.some(o=>o.id==='right-dc'));
  assert.ok(st.offers.some(o=>o.id==='right-ac'));
  assert.ok(st.offers.some(o=>o.id==='right-network'),'tariff may match an explicit network brand even when the technical CPO differs');
  assert.ok(st.offers.some(o=>o.id==='physical-only'),'physical-only tariff must still match its technical CPO');
  assert.ok(!st.offers.some(o=>o.id==='wrong-station'),'station-scoped verified tariff must not leak network-wide');
  assert.ok(!st.offers.some(o=>o.id==='wrong-power'),'power-scoped tariff must not apply to incompatible station');
  assert.ok(!st.offers.some(o=>o.id==='wrong-network'),'unrelated network tariff must not leak to the station');
}

(async()=>{
  await crosswalkAndStatus();
  await scopedOffers();
  console.log(JSON.stringify({ok:true,model:'france-v9',invariants:['sparse-crosswalk-safe','fresh-status-only','station-scope','evse-scope','power-scope','operator-network-separation']},null,2));
})().catch(err=>{console.error(err);process.exit(1);});