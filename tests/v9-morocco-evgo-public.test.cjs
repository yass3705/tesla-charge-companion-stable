const assert=require('node:assert/strict');
const https=require('node:https');
const Adapter=require('../assets/v9/adapters/morocco-evgo.js');
const Engine=require('../assets/v9/data-engine.js');
const URL='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/morocco/evgo/latest-normalized-stations.json';
function getJson(url){return new Promise((resolve,reject)=>https.get(url,{headers:{'user-agent':'tcc-v9-public-validator'}},r=>{if(r.statusCode!==200){reject(new Error(`HTTP ${r.statusCode}`));r.resume();return;}let s='';r.setEncoding('utf8');r.on('data',d=>s+=d);r.on('end',()=>{try{resolve(JSON.parse(s));}catch(e){reject(e);}});}).on('error',reject));}
(async()=>{
  const dataset=await getJson(URL);const v=Adapter.validateDataset(dataset);
  assert.equal(dataset.source_host,'cp.evgo.ma');assert.equal(dataset.summary?.station_count_with_native_geo,17);
  assert.equal(dataset.policy?.suspendedEV_operational_class,'occupied_or_active_session');
  assert.deepEqual(dataset.policy?.modeling_dimensions_kept_separate,['operator_cpo_candidate','site_brand','app_source','tariff_channel','status_source']);
  assert.equal(v.ok,true,v.errors.join('; '));assert.equal(v.stationCount,17);assert.equal(v.evseCount,43);
  const rawEvses=dataset.stations.flatMap(s=>s.evses||[]);
  assert.ok(rawEvses.every(e=>typeof e.isAvailable==='boolean'&&typeof e.isLongTermUnavailable==='boolean'&&typeof e.isTemporarilyUnavailable==='boolean'));
  assert.ok(rawEvses.filter(e=>e.status==='suspendedEV').every(e=>Adapter.classifyEvse(e)==='occupied_or_active_session'));
  assert.ok(rawEvses.every(e=>Adapter.classifyEvse(e)===e.operational_class));
  const fragments=Adapter.normalizeDataset(dataset);assert.equal(fragments.length,17);
  assert.ok(fragments.every(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)));
  const source={id:'morocco-evgo-native',countries:['MA'],priority:{identity:100,connectors:100,access:100,status:100,tariff:100},active:true};
  const engine=Engine.createEngine({registry:{sources:[source]},loaders:{'morocco-evgo-native':async()=>fragments}});
  const area=await engine.queryArea({countryCode:'MA'});assert.equal(area.stations.length,17);
  for(const st of area.stations){
    assert.equal(st.physicalOperator.name,'Nareva Services / EVGO');assert.equal(st.networkBrand,'EVGO');
    assert.equal(st.access.appSource,'EVGO');assert.equal(st.access.accessNetwork,'EVGO');
    assert.equal(st.status.statusSource,'EVGO native backend cp.evgo.ma');
    for(const offer of st.offers)assert.equal(offer.metadata.tariffChannel,'EVGO native');
  }
  const branded=area.stations.filter(s=>s.access.siteBrand);assert.ok(branded.length>0);assert.ok(branded.some(s=>s.access.siteBrand==='Marjane'));
  console.log(JSON.stringify({ok:true,datasetGeneratedAt:dataset.generated_at,stations:17,evses:43,gpsValidated:17,statusRulesValidated:true,availabilityFlagsValidated:true,suspendedEVRule:'occupied_or_active_session',v9Compatible:true,dimensions:{cpo:'physicalOperator',site_brand:'access.siteBrand',app_source:'access.appSource',access_network:'access.accessNetwork',tariff_channel:'offer.metadata.tariffChannel',status_source:'status.statusSource'}},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
