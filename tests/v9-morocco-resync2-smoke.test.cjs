const assert=require('assert');
const fs=require('fs');
const physical=require('../assets/v9/adapters/morocco-public.js');
const nonprod=require('../assets/v9/adapters/morocco-nonproduction.js');
const browserLoaders=require('../assets/v9/browser-loaders.js');
const pricingEngine=require('../assets/v9/pricing-engine.js');

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
  assert.deepEqual(ma.map(s=>s.id).sort(),sources.map(s=>s.id).sort(),'registry must contain exactly four physical Morocco public sources');
  assert(ma.every(s=>s.adapter==='morocco-public-v1'),'all Morocco physical sources use morocco-public-v1');
  assert(!ma.some(s=>/evone|evplug|shell|vivo/i.test(s.id)),'eMSP/diagnostic entries must not enter the physical registry');
  const wired=browserLoaders.createRegistryLoaders({registry,adapters:{moroccoPublic:physical}});
  for(const source of sources)assert.equal(typeof wired[source.id],'function',`browser loader wired for ${source.id}`);

  const evgo=await physical.createLoader({source:sources[0]})();
  assert.equal(evgo.length,17,'EVGO station count');
  assert.equal(evgo.flatMap(s=>s.evses||[]).length,43,'EVGO EVSE count');
  assert(evgo.every(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)),'EVGO usable GPS for every station');
  assert(evgo.every(s=>s.status?.statusSource==='EVGO native backend cp.evgo.ma'),'EVGO native status source preserved');
  assert.equal(physical.evgoClassify({status:'suspendedEV'}),'occupied_or_active_session');
  assert.equal(physical.evgoClassify({status:'available',isAvailable:true}),'available');
  assert.equal(physical.evgoClassify({status:'available',isAvailable:true,isTemporarilyUnavailable:true}),'out_of_service');
  assert.equal(physical.evgoClassify({status:'available',isAvailable:true,isLongTermUnavailable:true}),'out_of_service');

  const fastvolt=await physical.createLoader({source:sources[1]})();
  assert.equal(fastvolt.length,97,'FastVolt production count');
  assert(fastvolt.every(s=>s.physicalOperator?.name==='FastVolt / Afrimobility'),'FastVolt CPO attribution');
  assert(fastvolt.every(s=>(s.offers||[]).every(o=>o.metadata?.tariffChannel==='FastVolt direct')),'FastVolt tariff channel');
  const alBoustane=fastvolt.find(s=>s.sourceStationId==='W00057');
  assert(alBoustane,'FastVolt Al Boustane W00057');
  const dcOffer=alBoustane.offers.find(o=>o.connectorKinds?.includes('DC'));
  assert(dcOffer,'FastVolt direct DC offer');
  const tenMinutes=pricingEngine.evaluateOffer(dcOffer,{durationMinutes:10,energyKwh:0,startAt:'2026-08-30T12:00:00Z'});
  assert.equal(tenMinutes.complete,true,'FastVolt per-minute pricing must be evaluable');
  assert.equal(tenMinutes.totalEur,25,'10 min at 2.5 MAD/min must cost 25 MAD');
  assert.equal(tenMinutes.currency,'MAD','FastVolt result currency remains MAD');
  assert.equal(tenMinutes.components.connectedTimePerMinute,25,'currency-neutral per-minute component');

  const legacyMinute=pricingEngine.evaluateRule({connectedTimePerMinuteEur:0.5},{durationMinutes:10});
  assert.equal(legacyMinute.totalEur,5,'legacy EUR per-minute field remains compatible');

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
  assert.equal(overlay.status.statusSource,'EVGO native backend cp.evgo.ma');
  assert.equal(overlay.access.appSource,'EVOne');
  assert.equal(overlay.access.accessNetwork,'EVPlug');

  console.log(JSON.stringify({ok:true,registryMoroccoSources:ma.map(s=>s.id),evgoStations:evgo.length,evgoEvses:43,fastvoltStations:fastvolt.length,fastvoltTenMinuteDcMAD:tenMinutes.totalEur,kilowattStations:kilowatt.length,totalenergiesHosts:te.length,evoneProduction:['Available','Occupied','Charging']},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
