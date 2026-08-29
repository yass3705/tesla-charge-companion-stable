const assert=require('node:assert/strict');
const https=require('node:https');
const Adapter=require('../assets/v9/adapters/morocco-evgo.js');
const Engine=require('../assets/v9/data-engine.js');

const URL='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/morocco/evgo/latest-normalized-stations.json';
function getJson(url){return new Promise((resolve,reject)=>https.get(url,{headers:{'user-agent':'tcc-v9-public-validator'}},r=>{if(r.statusCode!==200){reject(new Error(`HTTP ${r.statusCode}`));r.resume();return;}let s='';r.setEncoding('utf8');r.on('data',d=>s+=d);r.on('end',()=>{try{resolve(JSON.parse(s));}catch(e){reject(e);}});}).on('error',reject));}

(async()=>{
  const dataset=await getJson(URL);
  const validation=Adapter.validateDataset(dataset);
  assert.equal(validation.ok,true,validation.errors.join('; '));
  assert.equal(validation.stationCount,17);
  assert.equal(validation.evseCount,43);
  const fragments=Adapter.normalizeDataset(dataset);
  assert.equal(fragments.length,17);
  assert.ok(fragments.every(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)),'all 17 EVGO stations require usable GPS');
  assert.ok(fragments.every(s=>s.physicalOperator.name==='Nareva Services / EVGO'),'CPO attribution must remain EVGO/Nareva, not host brand or app provider');
  const suspended=dataset.stations.flatMap(s=>s.evses||[]).filter(e=>e.status==='suspendedEV');
  assert.ok(suspended.length>0,'fresh dataset should retain suspendedEV diagnostics');
  assert.ok(suspended.every(e=>Adapter.classifyEvse(e)==='occupied_or_active_session'),'suspendedEV must map to occupied/session active');

  const source={id:'morocco-evgo-native',countries:['MA'],priority:{identity:100,connectors:100,access:100,status:100,tariff:100},active:true};
  const engine=Engine.createEngine({registry:{sources:[source]},loaders:{'morocco-evgo-native':async()=>fragments}});
  const area=await engine.queryArea({countryCode:'MA'});
  assert.equal(area.stations.length,17);
  const sampleFragment=fragments.find(s=>s.siteBrand)||fragments[0];
  const sample=area.stations.find(s=>s.id===sampleFragment.canonicalId);
  const missingDimensions=[];
  if(sampleFragment.siteBrand!=null&&sample?.siteBrand!==sampleFragment.siteBrand)missingDimensions.push('site_brand');
  if(sample?.appSource!==sampleFragment.appSource)missingDimensions.push('app_source');
  if(sample?.accessNetwork!==sampleFragment.accessNetwork)missingDimensions.push('access_network');
  if(sample?.tariffChannel!==sampleFragment.tariffChannel)missingDimensions.push('tariff_channel');
  if(sample?.statusSource!==sampleFragment.statusSource)missingDimensions.push('status_source');
  assert.deepEqual(missingDimensions,['site_brand','app_source','access_network','tariff_channel','status_source'],'document the exact current V9 preservation blocker until the canonical engine supports source dimensions');

  console.log(JSON.stringify({ok:true,datasetGeneratedAt:dataset.generated_at,stations:17,evses:43,gpsValidated:17,statusRulesValidated:true,cpoPreserved:true,v9Compatible:false,blocker:'canonical engine currently drops distinct source-dimension fields',missingDimensions},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
