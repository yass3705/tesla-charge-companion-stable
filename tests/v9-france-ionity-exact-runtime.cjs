'use strict';
const fs=require('node:fs');
const direct=require('../assets/v9/adapters/direct-offers.js');

const payload=JSON.parse(fs.readFileSync('data/v9/france-ionity-offers.json','utf8'));
const registry=JSON.parse(fs.readFileSync('data/v9/source-registry.json','utf8'));
if(payload.country!=='FR'||payload.mode!=='verified_exact_evse_runtime_snapshot')throw new Error('IONITY compiled layer metadata invalid');
if(payload.policy?.networkWideGeneralization!==false||payload.policy?.exactEvseRequired!==true||payload.policy?.noNationalFallback!==true||payload.policy?.failClosed!==true)throw new Error('IONITY fail-closed policy invalid');
const raw=payload.directOffers||[];
const canonical=new Set(raw.flatMap(r=>r.evseIds||[]));
if(canonical.size!==1850)throw new Error(`Expected 1850 exact EVSEs, got ${canonical.size}`);
for(const bad of ['FR*IOY*E1','FR*IOY*E2','FRTSLE2IOYGE'])if(canonical.has(bad))throw new Error(`Malformed PAN EVSE leaked: ${bad}`);
const byPrice=new Map(raw.map(r=>[Number(r.pricing?.pricePerKwh),new Set(r.evseIds||[])]));
for(const p of [.35,.39,.48,.55,.62])if(!byPrice.has(p))throw new Error(`Expected IONITY price group ${p} missing`);
if(!byPrice.get(.55).has('FR*IOY*E469411'))throw new Error('Agde HPC 0.55 mapping missing');
if(!byPrice.get(.35).has('FR*IOY*E469452'))throw new Error('Agde legacy CCS 0.35 mapping missing');
const normalized=direct.normalizePayload(payload);
for(const r of normalized.offerRules){
  if(r.priority!==130)throw new Error('IONITY priority must be 130');
  if(r.metadata.verifiedScope!=='exact_evse')throw new Error('IONITY rule must be exact_evse');
  if(r.networkIds.length||r.stationIds.length)throw new Error('IONITY exact rule leaked a network/station fallback');
}
const exact=registry.sources.find(x=>x.id==='france-ionity-offers');
const legacy=registry.sources.find(x=>x.id==='ionity-direct-france');
if(!exact?.active||exact.adapter!=='direct-offer-json'||exact.path!=='data/v9/france-ionity-offers.json'||exact.priority?.tariff!==130)throw new Error('IONITY exact source registry entry invalid');
if(legacy?.active!==false)throw new Error('IONITY legacy source remains active');
console.log('V9 France IONITY exact layer OK:',canonical.size,'EVSEs,',raw.length,'price groups');
