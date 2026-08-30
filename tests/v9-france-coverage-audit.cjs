const fs=require('node:fs');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const LegacyStations=require('../assets/v9/adapters/legacy-direct-stations.js');
const Emsp=require('../assets/v9/adapters/france-emsp-compact.js');

const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const readGzipJson=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
const norm=v=>String(v==null?'':v).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const pdcNorm=v=>String(v==null?'':v).trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const operatorId=value=>{
  const n=norm(value);if(!n)return'unknown';
  if(n==='tesla'||n.startsWith('tesla-'))return'tesla';
  if(n.includes('ionity'))return'ionity';
  if(n.includes('fastned'))return'fastned';
  if(n.includes('powerdot')||n.includes('power-dot'))return'powerdot';
  if(n.includes('atlante'))return'atlante';
  if(n.includes('lidl'))return'lidl';
  if(n.includes('electroverse'))return'electroverse';
  if(n==='electra'||n.startsWith('electra-'))return'electra';
  if(n.includes('izivia'))return'izivia';
  if(n.includes('freshmile'))return'freshmile';
  if(n.includes('qovoltis'))return'qovoltis';
  if(n.includes('e-totem')||n.includes('etotem'))return'etotem';
  if(n.includes('electric-55'))return'e55c';
  if(n.includes('totalenergies'))return'totalenergies';
  if(n.includes('driveco'))return'driveco';
  if(n.includes('bouygues-energies'))return'bouygues-energies-services';
  if(n.includes('easycharge'))return'easycharge';
  if(n.includes('groupe-indigo')||n==='indigo')return'indigo';
  if(n.includes('allego'))return'allego';
  if(n.includes('spie-citynetworks'))return'spie-citynetworks';
  if(n.includes('citeos'))return'citeos';
  if(n.includes('leclerc'))return'e-leclerc';
  return n;
};

const registry=readJson('data/v9/source-registry.json');
const nationalManifest=readJson('data/v9/france-static/manifest.json');
const nationalRows=readGzipJson(`data/v9/france-static/${nationalManifest.allFile}`);
const emspManifest=readJson('data/non_tesla_france/manifest.json');
const emspRows=(emspManifest.tiles||[]).flatMap(tile=>readGzipJson(`data/non_tesla_france/${tile.file}`));
const providerCrosswalk=readJson('data/v9/france-provider-crosswalk.json');

const aliasesByStation=new Map();
for(const entry of providerCrosswalk.entries||[]){
  const stationId=String(entry.canonicalId||'').replace(/^FR:national:/,'');
  if(stationId)aliasesByStation.set(stationId,uniq(entry.aliases||[]));
}

const directRules=[];
for(const source of registry.sources.filter(s=>s.active!==false&&s.countries?.includes('FR'))){
  if(source.adapter==='direct-offer-json'&&source.path&&fs.existsSync(source.path)){
    const normalized=Direct.normalizePayload(readJson(source.path));
    for(const rule of normalized.offerRules.filter(r=>!r.subscriptionId))directRules.push({...rule,_sourceId:source.id});
  }
  if(source.adapter==='direct-station-gzip'&&source.path&&fs.existsSync(source.path)){
    const normalized=LegacyStations.normalizePayload(readGzipJson(source.path),source);
    for(const rule of normalized.offerRules.filter(r=>!r.subscriptionId))directRules.push({...rule,_sourceId:source.id});
  }
}

const emspRules=Emsp.offerRulesFromRows(emspRows,{priority:{tariff:80}});
const emspByPdc=new Map(),emspByNormalizedPdc=new Map();
for(const rule of emspRules){
  for(const pdc of rule.evseIds||[]){
    const key=String(pdc);if(!key)continue;
    if(!emspByPdc.has(key))emspByPdc.set(key,new Set());
    emspByPdc.get(key).add(operatorId(rule.provider));
    const nk=pdcNorm(key);if(nk){if(!emspByNormalizedPdc.has(nk))emspByNormalizedPdc.set(nk,new Set());emspByNormalizedPdc.get(nk).add(operatorId(rule.provider));}
  }
}

const directByPdc=new Map(),directStationRules=[],directScopedRules=[];
for(const rule of directRules){
  const pdcs=uniq(rule.evseIds||[]),stations=uniq(rule.stationIds||[]);
  if(pdcs.length){for(const pdc of pdcs){if(!directByPdc.has(pdc))directByPdc.set(pdc,[]);directByPdc.get(pdc).push(rule);}}
  else if(stations.length)directStationRules.push(rule);else directScopedRules.push(rule);
}

function stationTokens(stationId){return new Set([stationId,`FR:national:${stationId}`,`irve-station:${stationId}`,`national:FR:${stationId}`,...(aliasesByStation.get(stationId)||[])]);}
function exactStationRuleMatches(rule,tokens){return (rule.stationIds||[]).some(id=>tokens.has(String(id)));}
function scopedRuleMatches(rule,{operator,network,kind,power}){
  const op=operatorId(operator),net=operatorId(network);
  const ops=[...(rule.operatorIds||[]),...(rule.operatorAliases||[])].map(operatorId).filter(v=>v&&v!=='unknown');
  const nets=[...(rule.networkIds||[]),...(rule.networkAliases||[])].map(operatorId).filter(v=>v&&v!=='unknown');
  if(ops.length||nets.length){if(!ops.includes(op)&&!nets.includes(net))return false;}
  const kinds=(rule.connectorKinds||[]).map(x=>String(x).toUpperCase());if(kinds.length&&!kinds.includes(kind))return false;
  const min=Number(rule.minPowerKw),max=Number(rule.maxPowerKw);if(Number.isFinite(min)&&power<min)return false;if(Number.isFinite(max)&&power>max)return false;return true;
}
function directMatches(stationId,pdc,ctx){
  const exact=(directByPdc.get(pdc)||[]).filter(r=>scopedRuleMatches(r,ctx)).map(r=>({...r,_matchScope:'pdc'}));if(exact.length)return exact;
  const tokens=stationTokens(stationId),station=directStationRules.filter(r=>exactStationRuleMatches(r,tokens)&&scopedRuleMatches(r,ctx)).map(r=>({...r,_matchScope:'station'}));if(station.length)return station;
  return directScopedRules.filter(r=>scopedRuleMatches(r,ctx)).map(r=>({...r,_matchScope:'operator_or_network'}));
}

const stats={stations:nationalRows.length,pdcs:0,nonTeslaPdcs:0,teslaPdcs:0,withDirect:0,withDirectExact:0,withDirectScoped:0,withElectroverse:0,withElectra:0,withAnyEmsp:0,withNormalizedEmspIdentity:0,withDirectAndEmsp:0,withFallbackOnly:0,withoutAnyKnownTariff:0};
const operatorStats=new Map(),sourceHits=new Map(),nationalPdcSamples=[];
for(const row of nationalRows){
  const stationId=String(row?.[0]||''),operator=String(row?.[5]||'Unknown'),network=String(row?.[10]||row?.[5]||'Unknown'),configs=row?.[8]||[],canonicalOperator=operatorId(operator);
  for(const cfg of configs){
    const kind=String(cfg?.[2]||'AC').toUpperCase(),power=Number(cfg?.[3]||0),pricing=cfg?.[5]||[],pdcs=uniq(Array.isArray(cfg?.[6])?cfg[6].map(String):[]);
    for(const pdc of pdcs){
      stats.pdcs++;if(nationalPdcSamples.length<12)nationalPdcSamples.push(pdc);
      if(canonicalOperator==='tesla'){stats.teslaPdcs++;continue;}
      stats.nonTeslaPdcs++;
      const direct=directMatches(stationId,pdc,{operator,network,kind,power}),providers=emspByPdc.get(pdc)||new Set(),normalizedProviders=emspByNormalizedPdc.get(pdcNorm(pdc))||new Set();
      const hasDirect=direct.length>0,hasDirectExact=direct.some(r=>r._matchScope==='pdc'||r._matchScope==='station'),hasDirectScoped=direct.some(r=>r._matchScope==='operator_or_network'),hasEv=providers.has('electroverse'),hasElectra=providers.has('electra'),hasEmsp=hasEv||hasElectra,hasNormalizedEmsp=normalizedProviders.size>0,hasFallback=pricing.length>0;
      if(hasDirect)stats.withDirect++;if(hasDirectExact)stats.withDirectExact++;if(hasDirectScoped)stats.withDirectScoped++;if(hasEv)stats.withElectroverse++;if(hasElectra)stats.withElectra++;if(hasEmsp)stats.withAnyEmsp++;if(hasNormalizedEmsp)stats.withNormalizedEmspIdentity++;if(hasDirect&&hasEmsp)stats.withDirectAndEmsp++;
      if(!hasDirect&&!hasEmsp&&hasFallback)stats.withFallbackOnly++;if(!hasDirect&&!hasEmsp&&!hasFallback)stats.withoutAnyKnownTariff++;
      for(const r of direct){const sid=r._sourceId||r.sourceId||'direct';sourceHits.set(sid,(sourceHits.get(sid)||0)+1);}
      const key=canonicalOperator||'unknown',s=operatorStats.get(key)||{operatorId:key,labels:new Set(),pdcs:0,direct:0,directExact:0,directScoped:0,emsp:0,fallbackOnly:0,none:0};s.labels.add(operator||'Unknown');s.pdcs++;if(hasDirect)s.direct++;if(hasDirectExact)s.directExact++;if(hasDirectScoped)s.directScoped++;if(hasEmsp)s.emsp++;if(!hasDirect&&!hasEmsp&&hasFallback)s.fallbackOnly++;if(!hasDirect&&!hasEmsp&&!hasFallback)s.none++;operatorStats.set(key,s);
    }
  }
}

const pct=n=>stats.nonTeslaPdcs?Math.round(n*10000/stats.nonTeslaPdcs)/100:0;
const operatorRows=[...operatorStats.values()].map(x=>({operatorId:x.operatorId,labels:[...x.labels].sort(),pdcs:x.pdcs,direct:x.direct,directExact:x.directExact,directScoped:x.directScoped,emsp:x.emsp,fallbackOnly:x.fallbackOnly,none:x.none,richCoverage:x.direct+x.emsp,gap:x.fallbackOnly+x.none}));
const topGaps=operatorRows.filter(x=>x.pdcs>=20).sort((a,b)=>b.gap-a.gap||b.pdcs-a.pdcs).slice(0,25);
const actionBuckets={
  missingDirectSource:topGaps.filter(x=>x.direct===0&&x.emsp===0),
  partialDirectCoverage:topGaps.filter(x=>x.direct>0&&x.gap>0),
  fallbackPresentButNoRichTariff:topGaps.filter(x=>x.fallbackOnly>0&&x.direct===0&&x.emsp===0),
  scopedOnlyCoverage:topGaps.filter(x=>x.directScoped>0&&x.directExact===0)
};
const result={
  generatedFrom:{nationalGeneratedAt:nationalManifest.generatedAt,emspGeneratedAt:emspManifest.generatedAt||null,nationalStations:nationalManifest.stationCount,nationalPdcCount:nationalManifest.pdcCount,emspTileCount:(emspManifest.tiles||[]).length,emspRows:emspRows.length,emspRuleCount:emspRules.length,emspExactPdcCount:emspByPdc.size},
  scope:{physicalInventory:'france-national',teslaExcludedFromNonTeslaCoverage:true,auditedNonTeslaPdcs:stats.nonTeslaPdcs,excludedTeslaPdcs:stats.teslaPdcs},
  identityDiagnostics:{nationalPdcSamples,emspPdcSamples:[...emspByPdc.keys()].slice(0,12),exactOverlap:stats.withAnyEmsp,separatorInsensitiveOverlap:stats.withNormalizedEmspIdentity},
  exactPdcAudit:{...stats,percentOfNonTesla:{direct:pct(stats.withDirect),directExact:pct(stats.withDirectExact),directScoped:pct(stats.withDirectScoped),electroverse:pct(stats.withElectroverse),electra:pct(stats.withElectra),anyEmsp:pct(stats.withAnyEmsp),separatorInsensitiveEmspIdentity:pct(stats.withNormalizedEmspIdentity),directAndEmsp:pct(stats.withDirectAndEmsp),fallbackOnly:pct(stats.withFallbackOnly),noKnownTariff:pct(stats.withoutAnyKnownTariff)}},
  directSourcePdcHits:Object.fromEntries([...sourceHits.entries()].sort((a,b)=>b[1]-a[1])),topCoverageGapsByCanonicalOperator:topGaps,actionBuckets
};

console.log(JSON.stringify(result,null,2));
assert.equal(stats.stations,nationalManifest.stationCount,'national all-file station count must match manifest');
assert(stats.pdcs>100000,'audit must cover the national PDC population, not a sample');
assert(stats.nonTeslaPdcs>100000,'audit must cover the non-Tesla national PDC population');
assert(stats.teslaPdcs>0,'Tesla rows should be explicitly identified and excluded from non-Tesla gap ranking');
assert(stats.withDirect>0,'at least one national non-Tesla PDC must receive a direct tariff');
assert(stats.withDirectExact<=stats.withDirect,'exact direct coverage cannot exceed total direct coverage');
assert(emspRows.length>1000,'eMSP tiled runtime snapshot must contain station rows');
assert.equal(emspRules.length,0,'legacy eMSP snapshot is expected to remain non-rankable until genuine tariff rules are published');
assert(stats.withFallbackOnly+stats.withoutAnyKnownTariff<=stats.nonTeslaPdcs,'fallback/unknown gap population cannot exceed audited non-Tesla PDC population');
assert(!topGaps.some(x=>x.operatorId==='tesla'),'Tesla must not appear in non-Tesla tariff gap ranking');
assert(!topGaps.some(x=>x.operatorId==='izivia'&&x.labels.length<2),'IZIVIA spelling variants should be canonicalized into one operator bucket');
