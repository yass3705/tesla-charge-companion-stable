import assert from 'node:assert/strict';
import fs from 'node:fs';

const registry=JSON.parse(fs.readFileSync('data/v8_tariff_sources.json','utf8'));
const pipeline=fs.readFileSync('assets/v8-direct-offer-pipeline.js','utf8');
const hotfix=fs.readFileSync('assets/v8-rc48bn-runtime-hotfix.js','utf8');

assert.equal(registry.policy?.directOffersResolvedBeforeRanking,true,'direct offers must be resolved before ranking');
const byId=new Map((registry.sources||[]).map(s=>[s.id,s]));
assert.equal(byId.get('direct-offer-pipeline')?.status,'active');
assert.equal(byId.get('driveco-direct')?.status,'active','DRIVECO validated EVSE map must be active');
for(const id of ['powerdot-direct','freshmile-direct','bump-direct','driveco-direct']){
  assert.equal(byId.get(id)?.status,'active',`${id} must be active`);
  assert.match(pipeline,new RegExp(`registerPreparedEnricher\\('${id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}'`),`${id} must register a prepared enricher`);
}
for(const needle of ['await preparePrepared(prepared,{reason:\'compare\'})','const result=await current.apply(this,args)','repairSubscriptionMetadata','window.TCCV8Subscriptions?.applyAll?.(true)','window.TCCV8ReferenceOffers?.apply?.()']){
  assert.ok(pipeline.includes(needle),`missing pipeline invariant: ${needle}`);
}
assert.ok(pipeline.includes("full.endsWith(' '+p)"),'shortened subscription labels must map back to the declared plan');
assert.ok(hotfix.includes('loadDirectOfferPipeline()'),'runtime bootstrap must load the direct offer pipeline');
assert.ok(hotfix.includes('assets/v8-direct-offer-pipeline.js'),'runtime bootstrap must reference the pipeline asset');
for(const source of registry.sources||[]){
  if(source.status!=='active')continue;
  for(const module of source.runtimeModules||[])assert.ok(fs.existsSync(module),`active runtime module missing: ${source.id} -> ${module}`);
  for(const artifact of source.artifactPaths||[])assert.ok(fs.existsSync(artifact),`active artifact missing: ${source.id} -> ${artifact}`);
}
console.log('V8 unified direct offer pipeline contract OK.');
