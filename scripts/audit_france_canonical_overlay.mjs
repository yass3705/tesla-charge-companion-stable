import fs from 'node:fs';
import zlib from 'node:zlib';

const canonicalPath=process.argv[2]||'/tmp/france_public_charging_canonical.json';
const runtimePath=process.argv[3]||'data/non_tesla_france/all.json.gz';
const manifestPath=process.argv[4]||'data/non_tesla_france/manifest.json';
const outputPath=process.argv[5]||'diagnostics/france_canonical_overlay_preview.json';

function readJson(path){return JSON.parse(fs.readFileSync(path,'utf8'));}
function readRuntime(path){return JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString('utf8'));}
function text(v){return String(v??'').trim();}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function norm(v){return text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(saint|sainte)\b/g,'st').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function uniq(values){return [...new Set(values.filter(Boolean))];}
function containsUseful(a,b){return a.length>=8&&b.length>=8&&(a.includes(b)||b.includes(a));}
function km(lat1,lon1,lat2,lon2){
  const R=6371,p=Math.PI/180,dLat=(lat2-lat1)*p,dLon=(lon2-lon1)*p;
  const x=Math.sin(dLat/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function get(obj,path){return path.split('.').reduce((v,k)=>v&&v[k]!==undefined?v[k]:null,obj);}
function firstNumber(obj,paths){for(const p of paths){const v=n(get(obj,p));if(v!=null)return v;}return null;}
function collectStrings(obj,keyRe,out=[],path=''){
  if(obj==null)return out;
  if(Array.isArray(obj)){obj.forEach((v,i)=>collectStrings(v,keyRe,out,`${path}[${i}]`));return out;}
  if(typeof obj!=='object')return out;
  for(const [k,v] of Object.entries(obj)){
    const p=path?`${path}.${k}`:k;
    if(keyRe.test(k)&&typeof v==='string'&&text(v))out.push({path:p,value:text(v)});
    if(v&&typeof v==='object')collectStrings(v,keyRe,out,p);
  }
  return out;
}
function collectMoneySignals(obj,out=[],path=''){
  if(obj==null)return out;
  if(Array.isArray(obj)){obj.forEach((v,i)=>collectMoneySignals(v,out,`${path}[${i}]`));return out;}
  if(typeof obj!=='object')return out;
  for(const [k,v] of Object.entries(obj)){
    const p=path?`${path}.${k}`:k;
    if(typeof v==='number'&&/(eur|price|fee|rate|kwh|minute|hour|preauthor|minimum|session|parking|tariff)/i.test(k))out.push({path:p,value:v});
    if(v&&typeof v==='object'&&!/(sourceEvidence|hash|sha)/i.test(k))collectMoneySignals(v,out,p);
  }
  return out.slice(0,80);
}
function stationIdentity(item){
  const p=item.payload||{};
  const s=p.station||{};
  const c=p.candidate||{};
  const names=uniq([
    s.name,s.officialPlannedName,s.nameDisplayed,s.locationDisplayed,s.legacyLabel,
    c.name,c.legacyLabel,p.stationName,p.name,p.locationDisplayed
  ].map(text));
  const addresses=uniq([s.address,s.officialAddress,c.address,p.address].map(text));
  const cities=uniq([s.city,c.city,p.city].map(text));
  const lat=firstNumber(s,['latitude','lat','coordinates.latitude'])??firstNumber(p,['latitude','lat','coordinates.latitude']);
  const lon=firstNumber(s,['longitude','lon','lng','coordinates.longitude'])??firstNumber(p,['longitude','lon','lng','coordinates.longitude']);
  const evse=uniq(collectStrings(p,/(evse|point).*id|id.*(evse|point)/i).map(x=>x.value));
  const operator=text(item.operator||p.operator||p.network||p.serviceOperator||p?.tccDecision?.currentOperatorObserved);
  return {names,addresses,cities,lat,lon,evse,operator};
}
function tariffApplicable(item){
  const p=item.payload||{},d={...(p.decision||{}),...(p.tccDecision||{})},s=p.station||{};
  const trueBlockers=['doNotUseForTariffValidation','excludeAsLiveStationWitness','keepAsRolloutReferenceOnly','doNotApplyPassPassTariff'];
  if(trueBlockers.some(k=>d[k]===true))return false;
  const falseBlockers=['useAsCurrentLiveStationWitness','stationTariffRankable','rankableForThisStationConnector','directTariffVerified','treatAsLiveVerifiedStation','useAsPassPassWitness'];
  if(falseBlockers.some(k=>d[k]===false))return false;
  if(s.operatorAppVisible===false)return false;
  if(/negative/.test(String(item.dataset||'').toLowerCase()))return false;
  return true;
}
function runtimeStation(row){
  const configs=Array.isArray(row?.[8])?row[8]:[];
  const energy=[],minute=[],flat=[],parking=[],after=[];
  for(const c of configs){for(const r of (Array.isArray(c?.[5])?c[5]:[])){
    const push=(arr,v)=>{v=n(v);if(v!=null&&v>0)arr.push(v);};
    push(energy,r?.[5]);push(minute,r?.[6]);push(flat,r?.[7]);push(parking,r?.[8]);push(after,r?.[9]);
  }}
  return {
    id:text(row?.[0]),name:text(row?.[1]),address:text(row?.[2]),lat:n(row?.[3]),lon:n(row?.[4]),operator:text(row?.[5]),
    configurationCount:configs.length,
    priceSignals:{energyEurPerKwh:uniq(energy.map(String)).map(Number),minuteEur:uniq(minute.map(String)).map(Number),flatEur:uniq(flat.map(String)).map(Number),parkingEurPerMinute:uniq(parking.map(String)).map(Number),afterThresholdEurPerMinute:uniq(after.map(String)).map(Number)}
  };
}
function operatorMatches(a,b){a=norm(a);b=norm(b);return a&&b&&(a===b||containsUseful(a,b));}
function matchScore(ev,r){
  let score=0,reason=[];
  if(ev.lat!=null&&ev.lon!=null&&r.lat!=null&&r.lon!=null){const d=km(ev.lat,ev.lon,r.lat,r.lon);if(d<=0.08){score=Math.max(score,110);reason.push(`coordinates_${Math.round(d*1000)}m`);}else if(d<=0.18){score=Math.max(score,100);reason.push(`coordinates_${Math.round(d*1000)}m`);}}
  const rn=norm(r.name),ra=norm(r.address),rc=norm(`${r.name} ${r.address}`);
  for(const a0 of ev.addresses){const a=norm(a0);if(!a)continue;if(a===ra||containsUseful(a,ra)){score=Math.max(score,98);reason.push('address');}else if(rc.includes(a)&&a.length>=10){score=Math.max(score,94);reason.push('address_in_station_text');}}
  for(const name0 of ev.names){const name=norm(name0);if(!name)continue;if(name===rn){score=Math.max(score,92);reason.push('name');}else if(containsUseful(name,rn)){const cityHit=!ev.cities.length||ev.cities.some(c=>rc.includes(norm(c)));if(cityHit){score=Math.max(score,86);reason.push('name_city');}}}
  if(score>=80&&operatorMatches(ev.operator,r.operator)){score+=3;reason.push('operator');}
  return {score,reason:uniq(reason).join('+')};
}
function canonicalEnergySignals(money){return uniq(money.filter(x=>/(energy.*kwh|eurPerKwh|pricePerKwh)/i.test(x.path)).map(x=>String(x.value))).map(Number);}
function overlap(a,b,tol=0.0006){return a.some(x=>b.some(y=>Math.abs(x-y)<=tol));}

const canonical=readJson(canonicalPath),manifest=readJson(manifestPath),rows=readRuntime(runtimePath);
if(canonical.dataset!=='france-public-charging-canonical')throw new Error(`Unexpected canonical dataset ${canonical.dataset}`);
if(!Array.isArray(canonical.stationVerifications))throw new Error('Canonical stationVerifications missing');
if(!Array.isArray(rows)||rows.length!==Number(manifest.stationCount))throw new Error(`Runtime row count mismatch ${rows.length} != ${manifest.stationCount}`);

const runtime=rows.map(runtimeStation);
const matches=[],unmatched=[],ambiguous=[];
let applicableCount=0,negativeCount=0,energyMatchCount=0,energyConflictCount=0;
for(const item of canonical.stationVerifications){
  const identity=stationIdentity(item),applicable=tariffApplicable(item),money=collectMoneySignals(item.payload||{});
  if(applicable)applicableCount++;else negativeCount++;
  const scored=[];
  for(const r of runtime){const m=matchScore(identity,r);if(m.score>=80)scored.push({r,...m});}
  scored.sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id));
  const top=scored[0];
  if(!top){unmatched.push({sourcePath:item.sourcePath,dataset:item.dataset,operator:identity.operator,identity,tariffApplicable:applicable});continue;}
  const tied=scored.filter(x=>x.score>=top.score-1);
  if(tied.length>1){ambiguous.push({sourcePath:item.sourcePath,dataset:item.dataset,operator:identity.operator,identity,tariffApplicable:applicable,candidates:tied.slice(0,8).map(x=>({score:x.score,reason:x.reason,station:x.r}))});continue;}
  const canonicalEnergy=canonicalEnergySignals(money),runtimeEnergy=top.r.priceSignals.energyEurPerKwh;
  let comparison='not_comparable';
  if(!applicable)comparison='canonical_tariff_not_applicable';
  else if(canonicalEnergy.length&&runtimeEnergy.length){if(overlap(canonicalEnergy,runtimeEnergy)){comparison='energy_overlap';energyMatchCount++;}else{comparison='potential_energy_conflict';energyConflictCount++;}}
  else if(canonicalEnergy.length&&!runtimeEnergy.length)comparison='canonical_energy_only';
  else if(!canonicalEnergy.length&&runtimeEnergy.length)comparison='runtime_energy_only';
  matches.push({
    sourcePath:item.sourcePath,dataset:item.dataset,region:item.region||item.payload?.region||'',department:item.department||item.payload?.department||'',operator:identity.operator,
    tariffApplicable:applicable,match:{score:top.score,reason:top.reason},canonicalStation:identity,runtimeStation:top.r,
    canonicalPriceSignals:money,canonicalEnergyEurPerKwh:canonicalEnergy,comparison
  });
}

const out={
  schemaVersion:'1.0.0',dataset:'france-canonical-overlay-preview',generatedAt:new Date().toISOString(),mode:'audit_only',activeInApp:false,
  safety:{currentRuntimeCatalogUntouched:true,teslaStationsUntouched:true,customStationsUntouched:true,canonicalEvidenceNeverGeneralizedBeyondMatchedScope:true,directCpoAndRoamingKeptSeparate:true,automaticTariffOverrideEnabled:false},
  sources:{
    canonical:{dataset:canonical.dataset,sourceSnapshotAt:canonical.sourceSnapshotAt||'',stationVerificationCount:canonical.stationVerifications.length,operatorDirectSourceCount:canonical.operatorDirectSources?.length||0,regionalCoverageSourceCount:canonical.regionalCoverageSources?.length||0},
    runtime:{dataset:manifest.dataset,generatedAt:manifest.generatedAt,stationCount:manifest.stationCount,configurationCount:manifest.configurationCount,sourceRuns:manifest.sourceRuns}
  },
  counts:{stationVerifications:canonical.stationVerifications.length,tariffApplicableVerifications:applicableCount,negativeOrReferenceOnlyVerifications:negativeCount,matched:matches.length,unmatched:unmatched.length,ambiguous:ambiguous.length,energyOverlap:energyMatchCount,potentialEnergyConflicts:energyConflictCount,remainingTrueGaps:canonical.remainingTrueGaps?.length||0},
  remainingTrueGaps:canonical.remainingTrueGaps||[],
  decision:{safeToActivateAutomatically:false,nextStep:'review exact matches and potential conflicts, then build a separate opt-in runtime tariff overlay; do not replace the existing France station catalogue'},
  matches,ambiguous,unmatched
};
const slash=outputPath.lastIndexOf('/');if(slash>=0)fs.mkdirSync(outputPath.slice(0,slash),{recursive:true});
fs.writeFileSync(outputPath,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.counts,null,2));
