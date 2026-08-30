const assert=require('assert');
const fs=require('fs');
const physical=require('../assets/v9/adapters/morocco-public.js');
const nonprod=require('../assets/v9/adapters/morocco-nonproduction.js');
const browserLoaders=require('../assets/v9/browser-loaders.js');

const RAW='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/morocco';
const sources=[
  {id:'morocco-evgo-native',profile:'evgo',url:`${RAW}/evgo/latest-normalized-stations.json`},
  {id:'morocco-fastvolt-public',profile:'fastvolt',url:`${RAW}/fastvolt/latest-public-map-inventory.json`},
  {id:'morocco-kilowatt-public',profile:'kilowatt',url:`${RAW}/kilowatt/latest-public-station-inventory.json`},
  {id:'morocco-totalenergies-hosts',profile:'totalenergies',urls:{official:`${RAW}/totalenergies/official-network-inventory-2026-08-23.json`,alWaha:`${RAW}/totalenergies/al-waha-cpo-attribution.json`,links:`${RAW}/totalenergies/official-link-reconciliation-2026-08-30.json`}}
];

(async()=>{
  const registry=JSON.parse(fs.readFileSync(require.resolve('../data/v9/source-registry.json'),'utf8'));
  const ma=registry.sources.filter(s=>s.active!==false&&Array.isArray(s.countries)&&s.countries.includes('MA'));
  assert.deepEqual(ma.map(s=>s.id).sort(),sources.map(s=>s.id).sort(),'registry must contain exactly the four physical Morocco public sources');
  assert(ma.every(s=>s.adapter==='morocco-public-v1'),'Morocco physical registry adapter');
  assert(!ma.some(s=>/evone|evplug|shell|vivo/i.test(s.id)),'eMSP/diagnostic source must not enter physical registry');
  const wired=browserLoaders.createRegistryLoaders({registry,adapters:{moroccoPublic:physical}});
  for(const source of sources)assert.equal(typeof wired[source.id],'function',`browser loader wired for ${source.id}`);

  const evgo=await physical.createLoader({source:sources[0]})();
  assert.equal(evgo.length,17,'EVGO station count');
  assert.equal(evgo.flatMap(s=>s.evses||[]).length,43,'EVGO EVSE count');
  assert(evgo.every(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)),'EVGO GPS');
  assert(evgo.every(s=>s.physicalOperator?.name&&s.access?.appSource==='EVGO'&&s.access?.accessNetwork==='EVGO'),'EVGO identity/source dimensions');
  assert(evgo.every(s=>s.status?.statusSource==='EVGO native backend cp.evgo.ma'),'EVGO native status source');
  assert.equal(physical.evgoClassify({status:'suspendedEV'}),'occupied_or_active_session');
  assert.equal(physical.evgoClassify({status:'available',isAvailable:true}),'available');
  assert.equal(physical.evgoClassify({status:'available',isAvailable:true,isTemporarilyUnavailable:true}),'out_of_service');
  assert.equal(physical.evgoClassify({status:'available',isAvailable:true,isLongTermUnavailable:true}),'out_of_service');

  const fastvolt=await physical.createLoader({source:sources[1]})();
  assert.equal(fastvolt.length,97,'FastVolt production count');
  assert(fastvolt.every(s=>s.physicalOperator?.name==='FastVolt / Afrimobility'),'FastVolt CPO attribution');
  assert(fastvolt.every(s=>(s.offers||[]).every(o=>o.metadata?.tariffChannel==='FastVolt direct')),'FastVolt tariff channel');

  const kilowatt=await physical.createLoader({source:sources[2]})();
  assert.equal(kilowatt.length,43,'Kilowatt production count');
  assert(kilowatt.every(s=>s.physicalOperator?.name==='Kilowatt'),'Kilowatt CPO attribution');

  const te=await physical.createLoader({source:sources[3]})();
  assert.equal(te.length,13,'TotalEnergies geolocated host count');
  const alWaha=te.find(s=>s.access?.siteBrand==='TotalEnergies'&&s.physicalOperator?.name==='Kilowatt');
  assert(alWaha,'AL WAHA exact CPO/site-brand reconciliation');
  assert(te.filter(s=>s!==alWaha).every(s=>s.physicalOperator===null),'unresolved TotalEnergies hosts must not infer CPO');

  for(const s of ['Available','Occupied','Charging'])assert.equal(nonprod.evoneStatusClass(s),'production');
  for(const s of ['Faulted','Offline','Unknown','Unavailable'])assert.equal(nonprod.evoneStatusClass(s),'diagnostic_only');
  const native={physicalOperator:{name:'EVGO'},access:{siteBrand:null},status:{state:'available',statusSource:'EVGO native backend cp.evgo.ma'},offers:[]};
  const overlay=nonprod.applyEvoneOverlay(native,{status:'Occupied',site_brand:'Host'});
  assert.equal(overlay.physicalOperator.name,'EVGO');
  assert.equal(overlay.status.statusSource,'EVGO native backend cp.evgo.ma','EVOne must not overwrite native CPO status');
  assert.equal(overlay.access.appSource,'EVOne');
  assert.equal(overlay.access.accessNetwork,'EVPlug');

  console.log(JSON.stringify({ok:true,registryMoroccoSources:ma.map(s=>s.id),browserLoaderCount:Object.keys(wired).filter(k=>k.startsWith('morocco-')).length,evgo:evgo.length,evgoEvses:43,fastvolt:fastvolt.length,kilowatt:kilowatt.length,totalenergies:te.length,evoneProduction:['Available','Occupied','Charging']},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
