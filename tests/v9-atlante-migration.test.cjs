const assert=require('node:assert/strict');
const Engine=require('../assets/v9/data-engine.js');
const Legacy=require('../assets/v9/adapters/legacy-direct-stations.js');

const payload={
  dataset:'atlante-direct-operated-stations-france',generatedAt:'2026-08-29T00:00:00Z',
  scope:{requiredCpo:'FRATL',requiredCountryCode:'FR',requiredPartyId:'ATL',onlyOperatedLocations:true},
  locations:[{
    id:'atl-1',operatorName:'Atlante',countryCode:'FR',partyId:'ATL',
    connectors:[
      {connectorId:'c1',evseId:'FR*ATL*E*001*1',kind:'DC',powerKw:150,pricePerKwhEur:.55},
      {connectorId:'c2',evseId:'FR*ATL*E*001*2',kind:'AC',powerKw:22,pricePerKwhEur:.39},
      {connectorId:'c3',evseId:'',kind:'DC',powerKw:150,pricePerKwhEur:.55},
      {connectorId:'c4',evseId:'FR*ATL*E*001*4',kind:'DC',powerKw:150,pricePerKwhEur:0}
    ]
  }]
};
const normalized=Legacy.normalizePayload(payload,{priority:{tariff:98}});
assert.equal(normalized.offerRules.length,2,'only priced connectors with exact EVSE identity should migrate');
assert(normalized.offerRules.every(r=>r.metadata.identityMode==='exact_evse'));
assert(normalized.offerRules.every(r=>r.priority===98));

const registry={sources:[
  {id:'national',countries:['FR'],priority:{identity:55,connectors:60},active:true},
  {id:'atlante',countries:['FR'],priority:{tariff:98},active:true,optional:true}
]};
function station(pdc){return{
  canonicalId:`FR:national:${pdc}`,sourceStationId:pdc,countryCode:'FR',name:'Atlante test',address:'Test',latitude:48.8,longitude:2,
  physicalOperator:{name:'Atlante'},networkBrand:'Atlante',
  evses:[{id:'national-cfg',pdcIds:[pdc],connectors:[{kind:pdc.endsWith('*1')?'DC':'AC',powerKw:pdc.endsWith('*1')?150:22}]}],status:{state:'available'}
};}

(async()=>{
  const engine=Engine.createEngine({registry,loaders:{national:async()=>[station('FR*ATL*E*001*1')],atlante:async()=>normalized}});
  const area=await engine.queryArea({countryCode:'FR'});
  const direct=area.stations[0].offers.filter(o=>o.provider==='Atlante direct');
  assert.equal(direct.length,1);
  assert.equal(direct[0].pricing.rules[0].pricePerKwh,.55);
  assert.equal(direct[0].evseIds[0],'FR*ATL*E*001*1');

  const mismatch=Engine.createEngine({registry,loaders:{national:async()=>[station('FR*OTHER*E*9')],atlante:async()=>normalized}});
  const area2=await mismatch.queryArea({countryCode:'FR'});
  assert.equal(area2.stations[0].offers.filter(o=>o.provider==='Atlante direct').length,0,'Atlante tariff must not attach without exact EVSE identity');
  console.log('V9 Atlante exact EVSE migration OK');
})().catch(error=>{console.error(error);process.exit(1);});