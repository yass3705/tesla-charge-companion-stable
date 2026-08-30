'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const DataEngine=require('../assets/v9/data-engine.js');
const BrowserLoaders=require('../assets/v9/browser-loaders.js');
const Morocco=require('../assets/v9/adapters/morocco-public.js');
const Policies=require('../assets/v9/adapters/morocco-nonproduction.js');

(async()=>{
  const fullRegistry=JSON.parse(fs.readFileSync('data/v9/source-registry.json','utf8'));
  const sources=fullRegistry.sources.filter(s=>Array.isArray(s.countries)&&s.countries.includes('MA'));
  assert.deepEqual(sources.map(s=>s.id).sort(),[
    'morocco-evgo-native','morocco-fastvolt-public','morocco-kilowatt-public','morocco-totalenergies-hosts'
  ]);
  assert.ok(!fullRegistry.sources.some(s=>/evone|evplug|shell|vivo/i.test(s.id)&&s.countries?.includes('MA')),'eMSP/diagnostic sources must not become physical Morocco sources');

  const registry={...fullRegistry,sources};
  const loaders=BrowserLoaders.createRegistryLoaders({registry,adapters:{moroccoPublic:Morocco}});
  assert.equal(Object.keys(loaders).length,4);
  const engine=DataEngine.createEngine({registry,loaders});
  const area=await engine.queryArea({countryCode:'MA'});
  assert.deepEqual(area.diagnostics.errors,[],'all Morocco public sources must load cleanly');

  // 17 EVGO + 97 FastVolt + 43 Kilowatt + 13 geolocated TotalEnergies hosts,
  // minus one exact AL WAHA cross-source merge.
  assert.equal(area.stations.length,169,`unexpected Morocco merged station count ${area.stations.length}`);
  const alWaha=area.stations.find(s=>s.id==='MA:kilowatt:62e29ef59ad98566676cf824');
  assert.ok(alWaha,'AL WAHA exact canonical station missing');
  assert.equal(alWaha.physicalOperator.name,'Kilowatt');
  assert.equal(alWaha.access.siteBrand,'TotalEnergies');
  assert.equal(alWaha.access.appSource,'Kilowatt public web map');
  assert.equal(alWaha.access.accessNetwork,'Kilowatt');
  assert.equal(alWaha.status.statusSource,'Kilowatt public web map');
  assert.equal(alWaha.offers.length,0,'unresolved Kilowatt/TotalEnergies tariff must not become free');
  assert.ok(alWaha.provenance.some(p=>p.sourceId==='morocco-kilowatt-public'));
  assert.ok(alWaha.provenance.some(p=>p.sourceId==='morocco-totalenergies-hosts'));

  const alWahaDuplicates=area.stations.filter(s=>(s.aliases||[]).includes('totalenergies-host:al-waha')||(s.aliases||[]).includes('kilowatt-station:62e29ef59ad98566676cf824'));
  assert.equal(alWahaDuplicates.length,1,'AL WAHA must not be duplicated across Kilowatt and TotalEnergies');

  const fastVolt=area.stations.filter(s=>s.physicalOperator.name==='FastVolt / Afrimobility');
  assert.equal(fastVolt.length,97);
  const alBoustane=fastVolt.find(s=>(s.aliases||[]).includes('fastvolt-charger:W00057'));
  assert.ok(alBoustane);
  assert.equal(alBoustane.access.siteBrand,'Afriquia');
  assert.equal(alBoustane.evses[0].connectors.filter(c=>c.kind==='DC'&&c.powerKw===360).length,4);
  assert.equal(alBoustane.evses[0].connectors.filter(c=>c.kind==='AC'&&c.powerKw===22).length,2);
  assert.ok(alBoustane.offers.some(o=>o.metadata?.tariffChannel==='FastVolt direct'));

  const evgo=area.stations.filter(s=>s.networkBrand==='EVGO');
  assert.equal(evgo.length,17);
  assert.ok(evgo.every(s=>s.status?.statusSource==='EVGO native backend cp.evgo.ma'));
  const kilowatt=area.stations.filter(s=>s.physicalOperator.name==='Kilowatt');
  assert.equal(kilowatt.length,43,'TotalEnergies AL WAHA must merge into existing Kilowatt inventory rather than increase CPO count');

  const unknownTotalHosts=area.stations.filter(s=>s.access?.siteBrand==='TotalEnergies'&&s.physicalOperator.name==='Unknown');
  assert.equal(unknownTotalHosts.length,12,'12 geolocated TotalEnergies hosts must remain CPO-unresolved');
  assert.ok(unknownTotalHosts.every(s=>s.offers.length===0&&s.status.state==='unknown'));

  const base={physicalOperator:{name:'Kilowatt'},access:{siteBrand:'TotalEnergies',appSource:'Kilowatt public web map',accessNetwork:'Kilowatt'},status:{state:'available',statusSource:'Kilowatt public web map'},offers:[]};
  const overlay=Policies.applyEvoneOverlay(base,{status:'Available',offers:[]});
  assert.ok(overlay);
  assert.equal(overlay.physicalOperator.name,'Kilowatt','EVOne must never redefine CPO');
  assert.equal(overlay.access.siteBrand,'TotalEnergies','EVOne must preserve host brand');
  assert.equal(overlay.access.appSource,'EVOne');
  assert.equal(overlay.access.accessNetwork,'EVPlug');
  assert.equal(overlay.status.statusSource,'Kilowatt public web map','native CPO status must win over EVOne roaming status');
  for(const excluded of ['Faulted','Offline','Unknown','Unavailable'])assert.equal(Policies.applyEvoneOverlay(base,{status:excluded}),null,`${excluded} must stay out of production`);

  const shell=Policies.shellVivoDiagnostic({station:{canonical_name:'Shell Al Jazira',site_brand:'Shell',network_brand:'Shell Recharge',latitude_candidate:33.779558,longitude_candidate:-7.232679},modeling:{site_brand:'Shell',network_brand:'Shell Recharge',access_network:'Shell Recharge'},production_recommendation:{reason:'CPO unresolved'}});
  assert.equal(shell.productionEligible,false);
  assert.equal(shell.diagnosticOnly,true);
  assert.equal(shell.physicalOperator,null);
  assert.equal(shell.access.siteBrand,'Shell');
  assert.equal(shell.networkBrand,'Shell Recharge');
  assert.deepEqual(shell.offers,[]);

  console.log(JSON.stringify({ok:true,physicalSources:sources.map(s=>s.id),mergedStations:area.stations.length,evgo:evgo.length,fastVolt:fastVolt.length,kilowatt:kilowatt.length,totalEnergiesUnknownHosts:unknownTotalHosts.length,alWaha:{id:alWaha.id,cpo:alWaha.physicalOperator.name,siteBrand:alWaha.access.siteBrand,provenance:alWaha.provenance.map(p=>p.sourceId)},evoneProductionPolicy:Policies.allowedStatuses,shellVivo:'diagnostic_only'},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
