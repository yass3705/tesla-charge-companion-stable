const fs=require('node:fs');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const LegacyStations=require('../assets/v9/adapters/legacy-direct-stations.js');

const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const readGzip=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
const pdcNorm=v=>String(v==null?'':v).trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const uniq=a=>[...new Set((a||[]).map(String).filter(Boolean))];

const registry=readJson('data/v9/source-registry.json');
const manifest=readJson('data/v9/france-static/manifest.json');
const rows=readGzip(`data/v9/france-static/${manifest.allFile}`);
const crosswalk=readJson('data/v9/france-provider-crosswalk.json');

const nationalPdcs=new Set(),normalizedPdcs=new Set(),stationTokens=new Set();
for(const row of rows){
  const stationId=String(row?.[0]||'');
  if(stationId){stationTokens.add(stationId);stationTokens.add(`FR:national:${stationId}`);stationTokens.add(`irve-station:${stationId}`);stationTokens.add(`national:FR:${stationId}`);}
  for(const cfg of row?.[8]||[])for(const pdc of cfg?.[6]||[]){const id=String(pdc);if(!id)continue;nationalPdcs.add(id);normalizedPdcs.add(pdcNorm(id));}
}
for(const entry of crosswalk.entries||[]){
  if(entry.canonicalId)stationTokens.add(String(entry.canonicalId));
  for(const alias of entry.aliases||[])stationTokens.add(String(alias));
}

function rulesFor(source){
  if(!source.path||!fs.existsSync(source.path))return[];
  if(source.adapter==='direct-offer-json')return Direct.normalizePayload(readJson(source.path)).offerRules||[];
  if(source.adapter==='direct-station-gzip')return LegacyStations.normalizePayload(readGzip(source.path),source).offerRules||[];
  return[];
}
function summarize(source){
  const rules=rulesFor(source).filter(r=>!r.subscriptionId),evseIds=uniq(rules.flatMap(r=>r.evseIds||[])),stationIds=uniq(rules.flatMap(r=>r.stationIds||[]));
  const exactEvse=evseIds.filter(id=>nationalPdcs.has(id)),normalizedEvse=evseIds.filter(id=>normalizedPdcs.has(pdcNorm(id))),exactStations=stationIds.filter(id=>stationTokens.has(id));
  return{
    sourceId:source.id,adapter:source.adapter,ruleCount:rules.length,
    evseIdentityCount:evseIds.length,exactEvseOverlap:exactEvse.length,separatorInsensitiveEvseOverlap:normalizedEvse.length,
    stationIdentityCount:stationIds.length,exactStationAliasOverlap:exactStations.length,
    samples:{evseIds:evseIds.slice(0,5),exactEvse:exactEvse.slice(0,5),normalizedOnly:normalizedEvse.filter(id=>!nationalPdcs.has(id)).slice(0,5),stationIds:stationIds.slice(0,5),exactStations:exactStations.slice(0,5)}
  };
}

const audited=registry.sources.filter(s=>s.active!==false&&s.countries?.includes('FR')&&['direct-offer-json','direct-station-gzip'].includes(s.adapter));
const result={national:{stations:manifest.stationCount,manifestPdcCount:manifest.pdcCount,uniquePdcCount:nationalPdcs.size,stationTokenCount:stationTokens.size},sources:audited.map(summarize)};
console.log(JSON.stringify(result,null,2));
assert(result.sources.some(x=>x.exactEvseOverlap>0||x.exactStationAliasOverlap>0||x.evseIdentityCount===0),'at least one direct source identity must overlap national data');
