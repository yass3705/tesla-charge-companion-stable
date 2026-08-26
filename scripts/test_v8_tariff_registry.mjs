import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const registry=JSON.parse(fs.readFileSync('data/v8_tariff_sources.json','utf8'));
assert.equal(registry.schemaVersion,1);
assert.equal(registry.contractVersion,'v8-tariff-engine-1');
assert.equal(registry.policy?.subscriptionsAreOptIn,true);
assert.equal(registry.policy?.subscriptionFixedFeesExcludedFromSessions,true);
assert.equal(registry.policy?.failOnMissingRequiredArtifact,true);

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

const ids=new Set();
for(const source of registry.sources||[]){
  assert.ok(source.id, 'every source must have an id');
  assert.ok(!ids.has(source.id), `duplicate source id: ${source.id}`);
  ids.add(source.id);
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

console.log(`V8 tariff registry OK: ${ids.size} sources, ${engine.offers.length} declarative offers, ${engine.subscriptions.length} subscriptions.`);
