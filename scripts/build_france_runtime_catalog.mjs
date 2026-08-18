import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const input = process.argv[2] || 'france_non_tesla_final.json.gz';
const outDir = process.argv[3] || 'data/non_tesla_france';
const TILE = 0.5;
const GENERATED_FALLBACK = new Date().toISOString();
const WEEKDAY = {SUNDAY:0,MONDAY:1,TUESDAY:2,WEDNESDAY:3,THURSDAY:4,FRIDAY:5,SATURDAY:6};

function cleanText(v){return String(v ?? '').trim();}
function n(v){const x=Number(v); return Number.isFinite(x)?x:null;}
function round(v,d=6){const x=Number(v); return Number.isFinite(x)?Number(x.toFixed(d)):null;}
function normTime(v, fallback='00:00'){
  const s=cleanText(v); if(!s)return fallback;
  const m=s.match(/^(\d{1,2}):(\d{2})/); if(!m)return fallback;
  return `${String(Math.min(23,Number(m[1]))).padStart(2,'0')}:${m[2]}`;
}
function normPower(v){let x=n(v);if(x==null||x<=0)return null;if(x>1000)x/=1000;return round(x,1);}
function parseMoney(text){
  const s=cleanText(text).replace(/\u00a0/g,' ').replace(',', '.');
  const m=s.match(/(?:€|EUR|CHF|£|GBP|MAD|USD|\$)?\s*(-?\d+(?:\.\d+)?)/i);
  return m?Number(m[1]):null;
}
function componentKind(type){
  const t=String(type||'').toUpperCase();
  if(t.includes('CONSUMPTION')||t==='ENERGY')return 'energy';
  if(t==='TIME'||t.includes('TIMERATE'))return 'time';
  if(t==='PARKING_TIME'||t.includes('PARKINGTIMERATE'))return 'parking';
  if(t==='FLAT'||t.includes('CONNECTIONFEE'))return 'flat';
  return null;
}
function electroverseComponentValue(c){return parseMoney(c?.formattedValue);}
function emptyRate(){return {energy:0,time:0,parking:0,flat:0};}
function addRate(target,kind,value){if(kind&&Number.isFinite(value))target[kind]+=value;}
function baseEvRate(offer){
  const r=emptyRate();
  for(const c of offer.simplePriceComponents||[]) addRate(r,componentKind(c?.__typename),electroverseComponentValue(c));
  return r;
}
function evRestrictionRate(restriction){
  const r=emptyRate(); const present=new Set();
  for(const c of restriction?.priceComponents||[]){const k=componentKind(c?.__typename);const v=electroverseComponentValue(c);if(k&&Number.isFinite(v)){r[k]+=v;present.add(k);}}
  return {rate:r,present};
}
function electraComponentRate(components){
  const r=emptyRate(); const present=new Set();
  for(const c of components||[]){const k=componentKind(c?.type);let v=n(c?.price);if(!k||v==null)continue;
    if(k==='time'||k==='parking')v/=60;
    r[k]+=v;present.add(k);
  }
  return {rate:r,present};
}
function compactRule({scope='allDay',start='00:00',end='24:00',currency='EUR',rate,afterRate=0,afterThreshold=0,days=null}){
  const billing = rate.energy>0 ? 'kwh' : (rate.time>0 ? 'minute' : 'kwh');
  return [scope,start,end,billing,currency||'EUR',round(rate.energy,6)||0,round(rate.time,6)||0,round(rate.flat,6)||0,round(rate.parking,6)||0,round(afterRate,6)||0,Math.max(0,Math.round(afterThreshold||0)),days?.length?days:null];
}
function evPricing(offer){
  const currency=offer.currency||'EUR';
  const base=baseEvRate(offer);
  const baseRule={scope:'allDay',start:'00:00',end:'24:00',currency,rate:{...base},afterRate:0,afterThreshold:0,days:null};
  const windows=new Map();
  const durationCandidates=[];
  for(const rr of offer.restrictions||[]){
    const {rate:restricted,present}=evRestrictionRate(rr);
    if(!present.size)continue;
    const tr=rr.timeRestrictions||null;
    const dr=rr.durationRestrictions||null;
    const wr=rr.weekdayRestrictions?.daysOfWeek||null;
    const days=Array.isArray(wr)?wr.map(x=>WEEKDAY[x]).filter(Number.isInteger):null;
    const minSec=n(dr?.minDurationSeconds), threshold=minSec!=null?Math.max(0,minSec/60):0;
    if(tr){
      const start=normTime(tr.startTime,'00:00'), end=normTime(tr.endTime,'24:00');
      const key=`${start}|${end}|${(days||[]).join(',')}`;
      let w=windows.get(key);if(!w){w={scope:'timeWindow',start,end,currency,rate:{...base},afterRate:0,afterThreshold:0,days};windows.set(key,w);}
      if(threshold>0){
        let delta=0;
        if(present.has('time'))delta+=Math.max(0,restricted.time-base.time);
        if(present.has('parking'))delta+=Math.max(0,restricted.parking-base.parking);
        if(delta>0&&(w.afterThreshold===0||threshold<w.afterThreshold)){w.afterThreshold=threshold;w.afterRate=delta;}
      }else{
        for(const k of present)w.rate[k]=restricted[k];
      }
    }else if(threshold>0){
      let delta=0;
      if(present.has('time'))delta+=Math.max(0,restricted.time-base.time);
      if(present.has('parking'))delta+=Math.max(0,restricted.parking-base.parking);
      if(delta>0)durationCandidates.push({threshold,delta});
    }
  }
  if(durationCandidates.length){durationCandidates.sort((a,b)=>a.threshold-b.threshold);baseRule.afterThreshold=durationCandidates[0].threshold;baseRule.afterRate=durationCandidates[0].delta;}
  return [compactRule(baseRule),...Array.from(windows.values()).map(compactRule)];
}
function electraPricing(offer){
  const currency=offer.currency||'EUR';
  const base=emptyRate();
  const windows=new Map();
  const durationCandidates=[];
  for(const el of offer.elements||[]){
    const {rate,present}=electraComponentRate(el?.priceComponents);
    const rr=el?.restrictions||{};
    const hasWindow=!!(rr.startTime||rr.endTime);
    const minDur=n(rr.minDuration);
    const threshold=minDur!=null?Math.max(0,minDur/60):0;
    const days=Array.isArray(rr.dayOfWeek)&&rr.dayOfWeek.length?rr.dayOfWeek.map(x=>WEEKDAY[x]).filter(Number.isInteger):null;
    if(hasWindow){
      const start=normTime(rr.startTime,'00:00'),end=normTime(rr.endTime,'24:00');
      const key=`${start}|${end}|${(days||[]).join(',')}`;
      let w=windows.get(key);if(!w){w={scope:'timeWindow',start,end,currency,rate:null,add:emptyRate(),afterRate:0,afterThreshold:0,days};windows.set(key,w);}
      if(threshold>0){const surcharge=rate.time+rate.parking;if(surcharge>0&&(w.afterThreshold===0||threshold<w.afterThreshold)){w.afterThreshold=threshold;w.afterRate=surcharge;}}
      else for(const k of present)w.add[k]+=rate[k];
    }else if(threshold>0){
      const surcharge=rate.time+rate.parking;if(surcharge>0)durationCandidates.push({threshold,delta:surcharge});
    }else{
      for(const k of present)base[k]+=rate[k];
    }
  }
  if(base.energy===0&&n(offer.currentPricePerKwh)!=null)base.energy=Number(offer.currentPricePerKwh);
  const baseRule={scope:'allDay',start:'00:00',end:'24:00',currency,rate:{...base},afterRate:0,afterThreshold:0,days:null};
  if(durationCandidates.length){durationCandidates.sort((a,b)=>a.threshold-b.threshold);baseRule.afterThreshold=durationCandidates[0].threshold;baseRule.afterRate=durationCandidates[0].delta;}
  const rules=[compactRule(baseRule)];
  for(const w of windows.values()){
    w.rate={...base}; for(const k of Object.keys(w.add))w.rate[k]+=w.add[k]; rules.push(compactRule(w));
  }
  return rules;
}
function kindForConnector(c){
  const s=String(c?.standard||'').toLowerCase();
  if(s.includes('type 2')||s.includes('type2')||s.includes('schuko'))return 'AC';
  if(s.includes('ccs')||s.includes('combo')||s.includes('chademo'))return 'DC';
  const p=normPower(c?.powerKw);return p!=null&&p>43?'DC':'AC';
}
function connectorGroupsForOffer(st,offer){
  let connectors=st.connectors||[];
  if(offer.source==='electroverse'&&Array.isArray(offer.connectorIds)&&offer.connectorIds.length){
    const ids=new Set(offer.connectorIds.map(String));
    const selected=connectors.filter(c=>c.source==='electroverse'&&ids.has(String(c.sourceConnectorId)));
    if(selected.length)connectors=selected;
  }
  let usable=connectors.map(c=>({kind:kindForConnector(c),power:normPower(c.powerKw),evse:cleanText(c.sourceEvseId)})).filter(c=>c.power!=null&&c.power>0);
  if(!usable.length){const power=normPower(st.maxPowerKw)||22;usable=[{kind:power>43?'DC':'AC',power,evse:''}];}
  const groups=new Map();
  for(const c of usable){const key=`${c.kind}|${c.power}`;let g=groups.get(key);if(!g){g={kind:c.kind,power:c.power,evses:new Set(),count:0};groups.set(key,g);}g.count++;if(c.evse)g.evses.add(c.evse);}
  return [...groups.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.power-b.power).map(g=>({kind:g.kind,power:g.power,stalls:g.evses.size||g.count||0}));
}
function physicalStalls(st){
  const bySource=new Map();let anon=0;
  for(const c of st.connectors||[]){const src=c.source||'unknown';let set=bySource.get(src);if(!set){set=new Set();bySource.set(src,set);}if(c.sourceEvseId)set.add(String(c.sourceEvseId)); else set.add(String(c.connectorId||`anon-${anon++}`));}
  return Math.max(0,...[...bySource.values()].map(s=>s.size));
}
function accessCompact(st){
  const hrs=st.openingHours?.regularHours;if(!Array.isArray(hrs)||!hrs.length)return 0;
  const days=[];
  for(const h of hrs){const day=WEEKDAY[h.weekday];if(!Number.isInteger(day))continue;days.push([day,normTime(h.periodBegin,'00:00'),normTime(h.periodEnd,'24:00')]);}
  return days.length?days:0;
}
function stationName(st){return cleanText(st.name)||[cleanText(st.address),cleanText(st.city)].filter(Boolean).join(' · ')||`Borne ${st.stationId}`;}
function fullAddress(st){return [cleanText(st.address),cleanText(st.postalCode),cleanText(st.city)].filter(Boolean).join(', ');}
function operatorName(st){return (st.operatorNames||[]).map(cleanText).find(Boolean)||cleanText(st.offers?.[0]?.operator)||'Autre';}
function configRows(st){
  const out=[];const seen=new Set();
  for(const offer of st.offers||[]){
    const provider=cleanText(offer.provider)|| (offer.source==='electra'?'Electra':offer.source==='electroverse'?'Electroverse':cleanText(offer.source)||'Tarif');
    const rules=offer.source==='electra'?electraPricing(offer):evPricing(offer);
    for(const g of connectorGroupsForOffer(st,offer)){
      const sig=JSON.stringify([provider,g.kind,g.power,rules]);if(seen.has(sig))continue;seen.add(sig);
      const id=`${offer.source||'offer'}-${String(offer.offerId||out.length).replace(/[^a-zA-Z0-9_-]/g,'').slice(-32)}-${g.kind.toLowerCase()}-${String(g.power).replace('.','_')}`;
      const label=`${provider} · ${g.kind} ${g.power} kW`;
      out.push([id,label,g.kind,g.power,g.stalls,rules]);
    }
  }
  if(!out.length){
    const p=normPower(st.maxPowerKw)||22,kind=p>43?'DC':'AC';
    out.push(['catalog-default',`Tarif à compléter · ${kind} ${p} kW`,kind,p,physicalStalls(st),[]]);
  }
  return out;
}
function stationRow(st,generatedAt){
  const lat=n(st.coordinates?.latitude),lon=n(st.coordinates?.longitude);if(lat==null||lon==null)return null;
  return [String(st.stationId),stationName(st),fullAddress(st),round(lat,6),round(lon,6),operatorName(st),physicalStalls(st),accessCompact(st),configRows(st),String(generatedAt).slice(0,10)];
}
function tileId(lat,lon){
  const a=Math.floor(lat/TILE)*TILE,b=Math.floor(lon/TILE)*TILE;
  const fmt=x=>String(Math.round(x*2)).replace('-','m');
  return `t_${fmt(a)}_${fmt(b)}`;
}
function sha256(buf){return crypto.createHash('sha256').update(buf).digest('hex');}

fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const compressed=fs.readFileSync(input);const raw=zlib.gunzipSync(compressed);const data=JSON.parse(raw.toString('utf8'));
if(data.schemaVersion!=='1.1.0')throw new Error(`Unexpected source schema ${data.schemaVersion}`);
if(!Array.isArray(data.stations)||data.stations.length!==43416)throw new Error(`Unexpected station count ${data.stations?.length}`);
const generatedAt=data.generatedAt||GENERATED_FALLBACK;
const tiles=new Map();let configurationCount=0,skipped=0;
for(const st of data.stations){const row=stationRow(st,generatedAt);if(!row){skipped++;continue;}configurationCount+=row[8].length;const id=tileId(row[3],row[4]);let arr=tiles.get(id);if(!arr){arr=[];tiles.set(id,arr);}arr.push(row);}
const manifestTiles=[];const all=[];
for(const [id,rows] of [...tiles.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
  rows.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));all.push(...rows);
  const latBase=Math.floor(rows[0][3]/TILE)*TILE,lonBase=Math.floor(rows[0][4]/TILE)*TILE;
  const json=Buffer.from(JSON.stringify(rows));const gz=zlib.gzipSync(json,{level:9});const file=`${id}.json.gz`;fs.writeFileSync(path.join(outDir,file),gz);
  manifestTiles.push({id,file,minLat:latBase,maxLat:latBase+TILE,minLon:lonBase,maxLon:lonBase+TILE,count:rows.length,bytes:gz.length,sha256:sha256(gz)});
}
const allGz=zlib.gzipSync(Buffer.from(JSON.stringify(all)),{level:9});fs.writeFileSync(path.join(outDir,'all.json.gz'),allGz);
const manifest={schemaVersion:1,dataset:'france-non-tesla-runtime',generatedAt,sourceSchemaVersion:data.schemaVersion,sourceRuns:data.sourceRuns,stationCount:all.length,configurationCount,skippedWithoutCoordinates:skipped,tileSizeDegrees:TILE,tileCount:manifestTiles.length,allFile:'all.json.gz',allBytes:allGz.length,allSha256:sha256(allGz),tiles:manifestTiles};
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({stationCount:all.length,configurationCount,tileCount:manifestTiles.length,allBytes:allGz.length,skipped},null,2));
