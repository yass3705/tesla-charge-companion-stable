const fs=require('node:fs');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const LegacyStations=require('../assets/v9/adapters/legacy-direct-stations.js');

const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const readGzip=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
const pdcNorm=v=>String(v==null?'':v).trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const uniq=a=>[...new Set((a||[]).map(String).filter(Boolean))];
const norm=v=>String(v==null?'':v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-');

const registry=readJson('data/v9/source-registry.json');
const manifest=readJson('data/v9/france-static/manifest.json');
const rows=readGzip(`data/v9/france-static/${manifest.allFile}`);
const crosswalk=readJson('data/v9/france-provider-crosswalk.json');

const nationalPdcs=new Set(),normalizedPdcs=new Set(),stationTokens=new Set(),operatorStations=new Map(),pdcContexts=new Map();
for(const row of rows){
  const stationId=String(row?.[0]||''),operator=String(row?.[5]||'Unknown');
  if(stationId){stationTokens.add(stationId);stationTokens.add(`FR:national:${stationId}`);stationTokens.add(`irve-station:${stationId}`);stationTokens.add(`national:FR:${stationId}`);}
  const opKey=norm(operator),list=operatorStations.get(opKey)||[];if(list.length<8)list.push({stationId,name:row?.[1]||'',operator,lat:row?.[3]??null,lon:row?.[4]??null});operatorStations.set(opKey,list);
  for(const cfg of row?.[8]||[])for(const pdc of cfg?.[6]||[]){const id=String(pdc);if(!id)continue;nationalPdcs.add(id);normalizedPdcs.add(pdcNorm(id));if(!pdcContexts.has(id))pdcContexts.set(id,{stationId,name:row?.[1]||'',operator,network:row?.[10]||null,kind:cfg?.[2]||null,powerKw:cfg?.[3]??null,configLabel:cfg?.[1]||null});}
}
for(const entry of crosswalk.entries||[]){if(entry.canonicalId)stationTokens.add(String(entry.canonicalId));for(const alias of entry.aliases||[])stationTokens.add(String(alias));}

function payloadFor(source){if(!source.path||!fs.existsSync(source.path))return null;return source.adapter==='direct-offer-json'?readJson(source.path):readGzip(source.path);}
function rulesFor(source,payload){if(!payload)return[];if(source.adapter==='direct-offer-json')return Direct.normalizePayload(payload).offerRules||[];if(source.adapter==='direct-station-gzip')return LegacyStations.normalizePayload(payload,source).offerRules||[];return[];}
function rawDiagnostic(source,payload,rules){
  if(!payload)return null;
  if(source.id==='france-e55c-offers'){
    const exact=(rules||[]).flatMap(r=>r.evseIds||[]).find(id=>nationalPdcs.has(id));
    return{exactNationalEvse:exact||null,nationalContext:exact?pdcContexts.get(exact)||null:null,operatorIds:(rules?.[0]?.operatorIds||[]),minPowerKw:rules?.[0]?.minPowerKw??null,maxPowerKw:rules?.[0]?.maxPowerKw??null};
  }
  if(source.id==='powerdot-direct-france'){
    const first=(payload.chargers||[])[0]||null,connector=first?.charger?.connectors?.[0]||null,tariff=connector?.tariff||null;
    return{rootKeys:Object.keys(payload).sort(),source:payload.source||null,irveSource:payload.irveSource||null,sourceType:payload.sourceType||null,operator:payload.operator||null,chargerCount:Array.isArray(payload.chargers)?payload.chargers.length:null,firstChargerKeys:first?Object.keys(first).sort():[],firstLocationKeys:first?.location?Object.keys(first.location).sort():[],firstNestedChargerKeys:first?.charger?Object.keys(first.charger).sort():[],firstIrvePdcIds:first?.irvePdcIds||null,firstBrand:first?.charger?.brand||null,firstConnectorKeys:connector?Object.keys(connector).sort():[],firstTariffKeys:tariff?Object.keys(tariff).sort():[],firstTariff:tariff};
  }
  if(source.id==='ionity-direct-france'){
    const first=(payload.locations||[])[0]||null;
    return{rootKeys:Object.keys(payload).sort(),locationCount:Array.isArray(payload.locations)?payload.locations.length:null,firstLocation:first?{keys:Object.keys(first).sort(),uuid:first.uuid||null,locationId:first.locationId||null,name:first.name||first.displayName||null,lat:first.latitude??first.lat??null,lon:first.longitude??first.lon??null,city:first.city||null,address:first.address||null}:null,nationalIonitySamples:operatorStations.get('ionity')||[]};
  }
  return null;
}
function summarize(source){
  const payload=payloadFor(source),rules=rulesFor(source,payload).filter(r=>!r.subscriptionId),evseIds=uniq(rules.flatMap(r=>r.evseIds||[])),stationIds=uniq(rules.flatMap(r=>r.stationIds||[]));
  const exactEvse=evseIds.filter(id=>nationalPdcs.has(id)),normalizedEvse=evseIds.filter(id=>normalizedPdcs.has(pdcNorm(id))),exactStations=stationIds.filter(id=>stationTokens.has(id));
  return{sourceId:source.id,adapter:source.adapter,ruleCount:rules.length,evseIdentityCount:evseIds.length,exactEvseOverlap:exactEvse.length,separatorInsensitiveEvseOverlap:normalizedEvse.length,stationIdentityCount:stationIds.length,exactStationAliasOverlap:exactStations.length,samples:{evseIds:evseIds.slice(0,5),exactEvse:exactEvse.slice(0,5),normalizedOnly:normalizedEvse.filter(id=>!nationalPdcs.has(id)).slice(0,5),stationIds:stationIds.slice(0,5),exactStations:exactStations.slice(0,5)},rawDiagnostic:rawDiagnostic(source,payload,rules)};
}

const audited=registry.sources.filter(s=>s.active!==false&&s.countries?.includes('FR')&&['direct-offer-json','direct-station-gzip'].includes(s.adapter));
const result={national:{stations:manifest.stationCount,manifestPdcCount:manifest.pdcCount,uniquePdcCount:nationalPdcs.size,stationTokenCount:stationTokens.size},sources:audited.map(summarize)};
console.log(JSON.stringify(result,null,2));
assert(result.sources.some(x=>x.exactEvseOverlap>0||x.exactStationAliasOverlap>0||x.evseIdentityCount===0),'at least one direct source identity must overlap national data');
