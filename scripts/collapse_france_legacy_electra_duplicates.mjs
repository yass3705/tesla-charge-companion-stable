import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import { gunzipSync, createGzip } from 'node:zlib';
import { once } from 'node:events';

const input=process.argv[2], output=process.argv[3], summaryFile=process.argv[4];
if(!input||!output) throw new Error('Usage: node collapse_france_legacy_electra_duplicates.mjs input.json.gz output.json.gz [summary.json]');
const norm=x=>String(x??'').trim();
const textKey=x=>norm(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const addressKey=s=>`${textKey(s?.postalCode)}|${textKey(s?.city)}|${textKey(s?.address)}`;
const nameKey=s=>`${textKey(s?.postalCode)}|${textKey(s?.city)}|${textKey(s?.name)}`;
const uniq=xs=>[...new Set((xs||[]).map(norm).filter(Boolean))];
const num=x=>Number.isFinite(Number(x))?Number(x):null;
const globalEvse=id=>/^[A-Z]{2}\*?[A-Z0-9]{3}\*?E[A-Z0-9*.-]+$/i.test(id)||/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
function distanceM(a,b){const la1=num(a?.latitude),lo1=num(a?.longitude),la2=num(b?.latitude),lo2=num(b?.longitude);if([la1,lo1,la2,lo2].some(v=>v===null))return null;const R=6371000,p1=la1*Math.PI/180,p2=la2*Math.PI/180,dp=(la2-la1)*Math.PI/180,dl=(lo2-lo1)*Math.PI/180;const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function mergeOffers(target,source){const out=[...(target||[])];const byKey=new Map(out.map((o,i)=>[`${o?.source||''}|${o?.offerId||''}`,i]));for(const incoming of source||[]){const key=`${incoming?.source||''}|${incoming?.offerId||''}`;if(!incoming?.offerId||!byKey.has(key)){out.push(incoming);if(incoming?.offerId)byKey.set(key,out.length-1);continue;}const existing=out[byKey.get(key)];for(const field of ['sourceLocationIds','connectorIds','evseIds']) if(existing?.[field]||incoming?.[field]) existing[field]=uniq([...(existing?.[field]||[]),...(incoming?.[field]||[])]);}return out;}
function mergeStation(target,source){target.sourceIds=target.sourceIds||{};target.sourceIds.electra=uniq([...(target.sourceIds.electra||[]),...(source.sourceIds?.electra||[])]);target.operatorNames=uniq([...(target.operatorNames||[]),...(source.operatorNames||[])]);target.connectorTypes=uniq([...(target.connectorTypes||[]),...(source.connectorTypes||[])]);target.maxPowerKw=Math.max(Number(target.maxPowerKw)||0,Number(source.maxPowerKw)||0);target.evseIdentifiers=target.evseIdentifiers||{};target.evseIdentifiers.electra=uniq([...(target.evseIdentifiers.electra||[]),...(source.evseIdentifiers?.electra||[])]);const cMap=new Map((target.connectors||[]).map(c=>[c?.connectorId||JSON.stringify(c),c]));for(const c of source.connectors||[]){const k=c?.connectorId||JSON.stringify(c);if(!cMap.has(k)){cMap.set(k,c);(target.connectors||(target.connectors=[])).push(c);}}target.offers=mergeOffers(target.offers,source.offers);}

const data=JSON.parse(gunzipSync(fs.readFileSync(input)).toString('utf8'));
if(data?.schemaVersion!=='1.1.0'||!Array.isArray(data?.stations))throw new Error('Unexpected source dataset');
const stations=data.stations;const evIndex=new Map();
for(let i=0;i<stations.length;i++){const s=stations[i];if(!s?.sourceIds?.electroverse)continue;for(const token of s?.evseIdentifiers?.electroverse||[]){const t=norm(token);if(!globalEvse(t))continue;if(!evIndex.has(t))evIndex.set(t,new Set());evIndex.get(t).add(i);}}
const uniqueEv=new Map([...evIndex].filter(([,ids])=>ids.size===1).map(([t,ids])=>[t,[...ids][0]]));
const mergeMap=new Map();const removed=new Set();const examples=[];let maxDistance=0,sharedTokens=0;
for(let i=0;i<stations.length;i++){
  const s=stations[i];if(!norm(s?.stationId).startsWith('electra-only:'))continue;
  const candidates=new Map();
  for(const token of s?.evseIdentifiers?.electra||[]){const t=norm(token);if(!globalEvse(t)||!uniqueEv.has(t))continue;const j=uniqueEv.get(t);if(j===i)continue;if(!candidates.has(j))candidates.set(j,[]);candidates.get(j).push(t);}
  if(candidates.size!==1)continue;
  const [j,tokens]=[...candidates.entries()][0];const target=stations[j];const d=distanceM(s.coordinates,target?.coordinates);if(d===null||d>100)continue;
  const exactAddress=!!textKey(s?.address)&&addressKey(s)===addressKey(target);const exactName=!!textKey(s?.name)&&nameKey(s)===nameKey(target);const strong=d<=15||exactAddress||exactName;if(!strong)continue;
  removed.add(i);if(!mergeMap.has(j))mergeMap.set(j,[]);mergeMap.get(j).push(i);maxDistance=Math.max(maxDistance,d);sharedTokens+=tokens.length;
  if(examples.length<25)examples.push({from:s.stationId,to:stations[j].stationId,distanceMeters:Number(d.toFixed(2)),sharedEvse:tokens,name:s.name,targetName:stations[j].name});
}
for(const [targetIndex,sourceIndexes] of mergeMap){const target=stations[targetIndex];for(const i of sourceIndexes)mergeStation(target,stations[i]);}
const corrected=stations.filter((_,i)=>!removed.has(i));
data.stations=corrected;
data.legacyElectraOnlyCorrection={appliedAt:new Date().toISOString(),policy:'Collapse electra-only station only when a globally structured EVSE/reference resolves uniquely to one current Electroverse station, coordinates are within 100 m, and either distance is <=15 m or normalized address/name corroborates the match.',collapsedStations:removed.size,targetStations:mergeMap.size,maxDistanceMeters:Number(maxDistance.toFixed(3)),sharedStructuredReferences:sharedTokens};
const summary={schemaVersion:data.schemaVersion,beforeStations:stations.length,afterStations:corrected.length,collapsedLegacyElectraOnlyStations:removed.size,targetElectroverseStations:mergeMap.size,remainingElectraOnlyStations:corrected.filter(s=>norm(s?.stationId).startsWith('electra-only:')).length,maxDistanceMeters:Number(maxDistance.toFixed(3)),examples};
async function writeGzip(){const ws=createWriteStream(output),gz=createGzip({level:9});gz.pipe(ws);const prefix=JSON.stringify({...data,stations:[]});const marker='"stations":[]',idx=prefix.indexOf(marker);const write=async s=>{if(!gz.write(s))await once(gz,'drain');};await write(prefix.slice(0,idx)+'"stations":[');for(let i=0;i<corrected.length;i++){if(i)await write(',');await write(JSON.stringify(corrected[i]));}await write(']'+prefix.slice(idx+marker.length));gz.end();await once(ws,'close');}
await writeGzip();if(summaryFile)fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
