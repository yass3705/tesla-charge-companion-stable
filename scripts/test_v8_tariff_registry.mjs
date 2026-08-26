import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const registry=JSON.parse(fs.readFileSync('data/v8_tariff_sources.json','utf8'));
assert.equal(registry.schemaVersion,1);
assert.equal(registry.contractVersion,'v8-tariff-engine-1');
assert.equal(registry.policy?.subscriptionsAreOptIn,true);
assert.equal(registry.policy?.subscriptionFixedFeesExcludedFromSessions,true);
assert.equal(registry.policy?.failOnMissingRequiredArtifact,true);
assert.equal(registry.policy?.directOffersResolvedBeforeRanking,true,'direct offers must be resolved before ranking');

for(const entry of registry.publish?.copyFromMain||[]){
  assert.ok(entry.path&&entry.target, 'publish entry requires path and target');
  assert.ok(['file','directory'].includes(entry.kind), `invalid publish kind for ${entry.path}`);
}
const publishEntries=registry.publish?.copyFromMain||[];
const publishTargets=publishEntries.map(x=>x.target);
assert.equal(new Set(publishTargets).size,publishTargets.length,'duplicate publish targets are not allowed');
assert.ok(publishTargets.includes('data/powerdot_direct_france.json.gz'),'Powerdot direct must be part of the declarative publish contract');
assert.ok(publishTargets.includes('data/etotem_direct_tariffs_france.json.gz'),'e-Totem direct must be part of the declarative publish contract');
const isPublishedFromMain=path=>publishEntries.some(entry=>path===entry.target||(entry.kind==='directory'&&path.startsWith(`${entry.target}/`)));

const ids=new Set(),sourcesById=new Map();
for(const source of registry.sources||[]){
  assert.ok(source.id, 'every source must have an id');
  assert.ok(!ids.has(source.id), `duplicate source id: ${source.id}`);
  ids.add(source.id);sourcesById.set(source.id,source);
  assert.ok(['active','staged','disabled'].includes(source.status), `invalid status for ${source.id}`);
  assert.ok(Array.isArray(source.artifactPaths), `artifactPaths missing for ${source.id}`);
  assert.ok(Array.isArray(source.runtimeModules), `runtimeModules missing for ${source.id}`);
  if(source.status==='active'){
    for(const path of source.artifactPaths){
      if(!isPublishedFromMain(path))assert.ok(fs.existsSync(path), `active source ${source.id} missing artifact ${path}`);
    }
    for(const path of source.runtimeModules){
      if(!isPublishedFromMain(path))assert.ok(fs.existsSync(path), `active source ${source.id} missing runtime module ${path}`);
    }
  }
}
for(const sourceId of ['direct-offer-pipeline','powerdot-direct','freshmile-direct','bump-direct','driveco-direct'])assert.equal(sourcesById.get(sourceId)?.status,'active',`${sourceId} must be active`);

const directPipelineSource=fs.readFileSync('assets/v8-direct-offer-pipeline.js','utf8');
const runtimeHotfixSource=fs.readFileSync('assets/v8-rc48bn-runtime-hotfix.js','utf8');
new vm.Script(directPipelineSource,{filename:'assets/v8-direct-offer-pipeline.js'});
new vm.Script(runtimeHotfixSource,{filename:'assets/v8-rc48bn-runtime-hotfix.js'});
for(const id of ['powerdot-direct','freshmile-direct','bump-direct','driveco-direct'])assert.ok(directPipelineSource.includes(`registerPreparedEnricher('${id}'`),`${id} must register a prepared enricher`);
assert.ok(directPipelineSource.includes("await preparePrepared(prepared,{reason:'compare'})"),'prepared direct sources must resolve before compare');
assert.ok(directPipelineSource.indexOf("await preparePrepared(prepared,{reason:'compare'})")<directPipelineSource.indexOf('const result=await current.apply(this,args)'),'direct source preparation must happen before compare execution');
assert.ok(directPipelineSource.includes('repairSubscriptionMetadata'),'subscription metadata repair must be part of finalization');
assert.ok(directPipelineSource.includes("full.endsWith(' '+p)"),'shortened provider labels must map back to subscription plans');
assert.ok(directPipelineSource.includes('window.TCCV8Subscriptions?.applyAll?.(true)'),'subscription eligibility must be reapplied after metadata repair');
assert.ok(directPipelineSource.includes('window.TCCV8ReferenceOffers?.apply?.()'),'operator references must be restored when no exact direct tariff is available');
assert.ok(directPipelineSource.includes('canonicalizePreparedOfferMetadata(prepared)'),'structured provider metadata must be canonicalized before expansion');
assert.ok(directPipelineSource.indexOf('canonicalizePreparedOfferMetadata(prepared)')<directPipelineSource.indexOf('if(window.TCC_V8_AREA_CACHE)'),'provider metadata must be canonicalized before prepared cache is returned');
assert.ok(directPipelineSource.includes('window.TCCV8OfferSelection?.decorateAndCollapseAugustResults'),'unified pipeline must restore physical station + power grouping after render');
assert.ok(directPipelineSource.indexOf('const grouped=ensureOfferGrouping()')<directPipelineSource.indexOf('const changed=repairSubscriptionMetadata()'),'offer grouping must happen before subscription eligibility is applied');
assert.ok(directPipelineSource.includes('api.mergedPowerdotStation(best.location,data,[st])'),'Powerdot must enrich only an already prepared station');
assert.ok(directPipelineSource.includes("if(!api.isPowerdotOperator(st)"),'Powerdot enrichment must be restricted to physical Powerdot stations');
assert.ok(!directPipelineSource.includes('api.mergePowerdotCatalog(prepared.stations'),'Powerdot pipeline must never re-expand the national catalog into a prepared area');
assert.ok(runtimeHotfixSource.includes('loadDirectOfferPipeline()'),'runtime hotfix must bootstrap the unified direct pipeline');
assert.ok(runtimeHotfixSource.includes('assets/v8-direct-offer-pipeline.js'),'runtime hotfix must load the direct pipeline asset');

const bumpSource=fs.readFileSync('assets/v8-bump-direct.js','utf8');
new vm.Script(bumpSource,{filename:'assets/v8-bump-direct.js'});
assert.ok(bumpSource.includes('exact_name_multi_station_power'),'Bump resolver must support identical multi-station site records');
assert.ok(bumpSource.includes('recs.flatMap(rec=>rec.points||[])'),'Bump duplicate station ids must be validated as one safe tariff group');
assert.ok(!bumpSource.includes('if(recs.length!==1)continue'),'Bump exact name/address duplicates must not be rejected solely because ids are duplicated');

// Regression fixture from the published Paris Malesherbes site: multiple Bump station ids,
// but the AC 11 kW PDCs share the same exact rankable tariff.
const bumpData=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/bump_direct_tariffs_tcc_france.json.gz')).toString('utf8'));
const bumpDocument={readyState:'loading',addEventListener(){},dispatchEvent(){}};
class BumpCustomEvent{constructor(type,init){this.type=type;this.detail=init?.detail;}}
const bumpContext=vm.createContext({window:{},document:bumpDocument,CustomEvent:BumpCustomEvent,console,Number,Math,JSON,Date,Set,Map,String,Array,Object,RegExp,Promise,setInterval(){return 0},clearInterval(){},setTimeout(){return 0},queueMicrotask(){},fetch:async()=>{throw new Error('fetch disabled in Bump registry test')}});
bumpContext.window=bumpContext;
vm.runInContext(bumpSource,bumpContext,{filename:'assets/v8-bump-direct.js'});
const bumpApi=bumpContext.TCCBumpDirectV8;bumpApi.validateCatalog(bumpData);bumpContext.TCC_BUMP_DIRECT_CATALOG_V1=bumpData;
const malesherbes={id:'electroverse:malesherbes',catalogStationId:'electroverse:malesherbes',operator:'Bump',countryCode:'FR',name:'Bump - SAGS - Paris - Malesherbes',address:'37 Boulevard Malesherbes, 75008 Paris',chargingConfigurations:[{id:'roaming-ac11',label:'Electroverse · AC 11 kW',kind:'AC',powerKw:11,stalls:49,pricing:{type:'kwh',pricePerKwh:.6}}]};
const malesherbesOut=bumpApi.addOffers(malesherbes,bumpData),malesherbesDirect=malesherbesOut.chargingConfigurations.find(c=>c.offerProvider==='Bump Direct'&&c.kind==='AC'&&Math.abs(c.powerKw-11)<.01);
assert.ok(malesherbesDirect,'Bump Malesherbes AC 11 kW direct tariff must resolve');
assert.equal(malesherbesDirect.bumpMatchMode,'exact_name_multi_station_power');
assert.ok(Math.abs(malesherbesDirect.pricing.rules[0].pricePerKwh-.5499996)<1e-5);
assert.equal(malesherbesDirect.pricing.bumpFeePolicy.components.flatFeeEur,1.2);

// Structured metadata wins over a stale roaming display label.
const pipelineDocument={readyState:'loading',addEventListener(){},dispatchEvent(){},querySelectorAll(){return[]},getElementById(){return null},scripts:[]};
class PipelineCustomEvent{constructor(type){this.type=type;}}
const pipelineContext=vm.createContext({window:{},document:pipelineDocument,CustomEvent:PipelineCustomEvent,console,Date,JSON,Set,Map,Promise,String,Number,Math,setTimeout(){return 0},clearTimeout(){},setInterval(){return 0},clearInterval(){},fetch:async()=>({ok:true,json:async()=>({sources:[]})})});
pipelineContext.window=pipelineContext;vm.runInContext(directPipelineSource,pipelineContext,{filename:'assets/v8-direct-offer-pipeline.js'});
const preparedMetadata={stations:[{operator:'Freshmile',kind:'AC',powerKw:7,chargingConfigurations:[{id:'fm',offerType:'operator_direct',label:'Electra · AC 7 kW',kind:'AC',powerKw:7,pricing:{type:'rules'}}]},{operator:'Bump',kind:'AC',powerKw:11,chargingConfigurations:[{id:'b',offerType:'operator_direct',offerProvider:'Bump Direct',label:'Electra · AC 11 kW',kind:'AC',powerKw:11,pricing:{type:'rules'}}]}]};
assert.equal(pipelineContext.TCCV8DirectPipeline.canonicalizePreparedOfferMetadata(preparedMetadata),2);
assert.equal(preparedMetadata.stations[0].chargingConfigurations[0].offerProvider,'Freshmile Direct');
assert.equal(preparedMetadata.stations[0].chargingConfigurations[0].label,'Freshmile Direct · AC 7 kW');
assert.equal(preparedMetadata.stations[1].chargingConfigurations[0].label,'Bump Direct · AC 11 kW');

const overlay=JSON.parse(fs.readFileSync('data/tariff_overlay_v1.json','utf8'));
const total=JSON.parse(fs.readFileSync('data/totalenergies_tariff_overlay_v1.json','utf8'));
const mergeById=(left,right)=>{
  const map=new Map();
  for(const row of [...(left||[]),...(right||[])])if(row?.id)map.set(row.id,row);
  return [...map.values()];
};
const allOffers=mergeById(overlay.operatorOffers,total.operatorOffers);
const allSubs=mergeById(overlay.subscriptions,total.subscriptions);
const offerIds=new Set();
for(const offer of allOffers){
  assert.ok(offer.id&&offer.provider, 'operator offer requires id and provider');
  assert.ok(!offerIds.has(offer.id), `duplicate operator offer id after merge: ${offer.id}`);
  offerIds.add(offer.id);
  assert.ok(offer.pricing||offer.mappingFile, `operator offer ${offer.id} has neither pricing nor mapping`);
}
const subIds=new Set();
for(const plan of allSubs){
  assert.ok(plan.id&&plan.provider, 'subscription requires id and provider');
  assert.ok(!subIds.has(plan.id), `duplicate subscription id after merge: ${plan.id}`);
  subIds.add(plan.id);
  assert.equal(plan.defaultSelected,false, `subscription ${plan.id} must remain opt-in`);
  if(plan.monthlyFeeEur!=null)assert.ok(Number(plan.monthlyFeeEur)>=0, `invalid monthly fee for ${plan.id}`);
  if(plan.pricePerKwh!=null)assert.ok(Number(plan.pricePerKwh)>=0, `invalid energy price for ${plan.id}`);
}

const storage=new Map([['tccSubscriptionsV1',JSON.stringify({selected:[]})]]);
const localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))};
const document={readyState:'loading',addEventListener(){},dispatchEvent(){}};
class CustomEvent{constructor(type){this.type=type;}}
const fetch=async url=>({ok:true,json:async()=>url.includes('v8_tariff_sources')?registry:(url.includes('totalenergies')?total:overlay)});
const context=vm.createContext({window:{},document,localStorage,CustomEvent,fetch,console,Date,JSON,Set,Map,Promise});
vm.runInContext(fs.readFileSync('assets/v8-tariff-engine.js','utf8'),context,{filename:'assets/v8-tariff-engine.js'});
const engine=context.window.TCCV8TariffEngine;
assert.ok(engine,'unified tariff engine must be exposed');
assert.equal(engine.validateRegistry(registry).ok,true);
await engine.loadCatalogue(true);
assert.equal(engine.offers.length,allOffers.length,'engine must ingest the merged declarative operator catalogue');
assert.equal(engine.subscriptions.length,allSubs.length,'engine must ingest the merged subscription catalogue');
const fastnedGold=engine.subscriptions.find(x=>x.id==='fastned-gold');
assert.ok(fastnedGold,'Fastned Gold must be ingested');
assert.equal(engine.isOfferEligible(fastnedGold,new Set()),false,'subscription must be excluded when not selected');
assert.equal(engine.isOfferEligible(fastnedGold,new Set(['fastned-gold'])),true,'subscription must be eligible when selected');
const direct=engine.offers.find(x=>x.id==='fastned-standard');
assert.ok(direct,'Fastned standard must be ingested');
assert.equal(engine.isOfferEligible(direct,new Set()),true,'direct offer must remain eligible without subscription');
const unrelated={operator:'Fastned',kind:'DC',powerKw:300};
const electraSelected=new Set(['electra-smart']);
const unrelatedOffers=engine.declaredOffersForStation(unrelated,electraSelected);
assert.ok(!unrelatedOffers.some(x=>x.id==='electra-smart'),'runtime-bound Electra subscription must not leak into generic station matching');
assert.ok(unrelatedOffers.some(x=>x.id==='fastned-standard'),'Fastned direct offer must match Fastned station');

console.log(`V8 tariff registry OK: ${ids.size} sources, ${engine.offers.length} declarative offers, ${engine.subscriptions.length} subscriptions + direct pipeline contract.`);
