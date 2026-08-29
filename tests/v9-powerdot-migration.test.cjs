const assert=require('node:assert/strict');
const Engine=require('../assets/v9/data-engine.js');
const Adapter=require('../assets/v9/adapters/legacy-direct-stations.js');

const payload={
  source:{sourceType:'direct_cpo_public_adhoc_api',operator:'Power Dot France',roaming:false},
  chargers:[{
    location:{id:'loc-1',uid:'uid-1',countryCode:'FR'},
    chargerName:'PD-01',
    irvePdcIds:['FR*POD*E123*1'],
    charger:{connectors:[{
      type:2,maxPowerKw:120,physicalReference:'1',
      tariff:{id:'t1',currencyCode:'EUR',elements:[{priceComponents:[{type:'ENERGY',pricePerUnit:0.49},{type:'FLAT',pricePerUnit:1},{type:'PARKING_TIME',pricePerUnit:0.02}]}]}
    },{
      type:2,maxPowerKw:120,
      tariff:{id:'subscription-only',subscriptionActive:true,currencyCode:'EUR',elements:[{priceComponents:[{type:'ENERGY',pricePerUnit:0.19}]}]}
    }]}
  },{
    location:{id:'loc-2',countryCode:'FR'},
    irvePdcIds:[],
    charger:{connectors:[{type:2,maxPowerKw:150,tariff:{currencyCode:'EUR',elements:[{priceComponents:[{type:'ENERGY',pricePerUnit:0.39}]}]}}]}
  }]
};
const source={id:'powerdot-direct-france',priority:{tariff:95}};
const normalized=Adapter.normalizePayload(payload,source);
assert.equal(normalized.metadata.sourceType,'direct_cpo_public_adhoc_api','published nested source metadata must identify Powerdot');
assert.equal(normalized.offerRules.length,1,'only exact-PDC public direct tariff should survive');
assert.deepEqual(normalized.offerRules[0].evseIds,['FR*POD*E123*1','FRPODE1231']);
assert.equal(normalized.offerRules[0].pricing.rules[0].pricePerKwh,0.49);
assert.equal(normalized.offerRules[0].pricing.rules[0].connectionFee,1);
assert.equal(normalized.offerRules[0].pricing.rules[0].idlePerMinute,0.02);

const registry={sources:[
  {id:'france-national',countries:['FR'],priority:{identity:55,connectors:60,tariff:30},active:true},
  {id:'powerdot-direct-france',countries:['FR'],priority:{tariff:95},active:true,optional:true}
]};
const good={canonicalId:'FR:national:GOOD',sourceStationId:'GOOD',countryCode:'FR',name:'Powerdot exact',address:'',latitude:48.8,longitude:2.1,physicalOperator:{id:'powerdot',name:'Powerdot'},evses:[{id:'FRPODE1231',pdcIds:['FRPODE1231'],connectors:[{id:'c1',kind:'DC',powerKw:120}]}]};
const bad={canonicalId:'FR:national:BAD',sourceStationId:'BAD',countryCode:'FR',name:'Powerdot other',address:'',latitude:48.81,longitude:2.11,physicalOperator:{id:'powerdot',name:'Powerdot'},evses:[{id:'FRPODOTHER1',pdcIds:['FRPODOTHER1'],connectors:[{id:'c2',kind:'DC',powerKw:120}]}]};

(async()=>{
  const engine=Engine.createEngine({registry,loaders:{'france-national':async()=>[good,bad],'powerdot-direct-france':async()=>normalized}});
  const area=await engine.queryArea({countryCode:'FR'});
  const exact=area.stations.find(x=>x.name==='Powerdot exact');
  const other=area.stations.find(x=>x.name==='Powerdot other');
  assert.equal(exact.offers.filter(o=>o.provider==='Powerdot direct').length,1,'compact exact PDC must receive Powerdot direct tariff');
  assert.equal(other.offers.filter(o=>o.provider==='Powerdot direct').length,0,'different PDC must not receive Powerdot direct tariff');
  const offer=exact.offers.find(o=>o.provider==='Powerdot direct');
  assert.equal(offer.metadata.identityMode,'exact_irve_pdc_with_compact_ocpi_alias');
  assert.equal(offer.pricing.rules[0].pricePerKwh,0.49);
  console.log('V9 Powerdot exact IRVE PDC migration OK');
})().catch(err=>{console.error(err);process.exit(1);});