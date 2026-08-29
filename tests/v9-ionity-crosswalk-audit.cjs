const fs=require('node:fs');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const readGzip=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
const plainNorm=v=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const nameNorm=v=>plainNorm(v).replace(/\bionity\b/g,' ').trim().replace(/\s+/g,' ');
const rad=x=>x*Math.PI/180;
const distanceKm=(a,b)=>{const R=6371,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),p1=rad(a.lat),p2=rad(b.lat);const h=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};

const manifest=readJson('data/v9/france-static/manifest.json');
const rows=readGzip(`data/v9/france-static/${manifest.allFile}`);
const ionity=readGzip('data/ionity_direct_stations_france.json.gz');
const national=rows.filter(r=>plainNorm(r?.[5])==='ionity').map(r=>({stationId:String(r[0]),name:String(r[1]||''),address:String(r[2]||''),lat:Number(r[3]),lon:Number(r[4])})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
const sources=(ionity.locations||[]).map(x=>({uuid:String(x.uuid||''),locationId:String(x.locationId||''),name:String(x.name||''),address:String(x.address||''),city:String(x.city||''),postalCode:String(x.postalCode||''),lat:Number(x.latitude),lon:Number(x.longitude)})).filter(x=>x.uuid&&Number.isFinite(x.lat)&&Number.isFinite(x.lon));

const candidates=[];
for(const src of sources){
  const ranked=national.map(n=>({n,d:distanceKm(src,n)})).sort((a,b)=>a.d-b.d);
  const first=ranked[0],second=ranked[1];if(!first)continue;
  const srcName=nameNorm(src.name),natName=nameNorm(first.n.name),exactName=srcName&&srcName===natName;
  const srcAddress=plainNorm(`${src.address} ${src.city}`),natAddress=plainNorm(first.n.address),addressOverlap=srcAddress&&natAddress&&(srcAddress.includes(natAddress)||natAddress.includes(srcAddress));
  candidates.push({uuid:src.uuid,locationId:src.locationId,sourceName:src.name,nationalId:first.n.stationId,nationalName:first.n.name,distanceM:Math.round(first.d*1000),secondDistanceM:second?Math.round(second.d*1000):null,exactName,addressOverlap,strictCandidate:first.d<=0.03&&(exactName||addressOverlap)&&(second==null||second.d>first.d*3)});
}
const buckets={under10m:0,under25m:0,under50m:0,under100m:0,under250m:0,under1km:0,exactNameNearest:0,strictCandidates:0};
for(const c of candidates){if(c.distanceM<=10)buckets.under10m++;if(c.distanceM<=25)buckets.under25m++;if(c.distanceM<=50)buckets.under50m++;if(c.distanceM<=100)buckets.under100m++;if(c.distanceM<=250)buckets.under250m++;if(c.distanceM<=1000)buckets.under1km++;if(c.exactName)buckets.exactNameNearest++;if(c.strictCandidate)buckets.strictCandidates++;}
const strict=candidates.filter(x=>x.strictCandidate);
const grouped=new Map();for(const c of strict){const arr=grouped.get(c.nationalId)||[];arr.push(c);grouped.set(c.nationalId,arr);}
const duplicateNational=[...grouped.entries()].filter(([,v])=>v.length>1).map(([nationalId,v])=>({nationalId,count:v.length,sourceIds:v.map(x=>x.locationId)}));
const duplicateIds=new Set(duplicateNational.map(x=>x.nationalId));
const strictUnique=strict.filter(x=>!duplicateIds.has(x.nationalId));
const result={nationalIonityStations:national.length,sourceIonityLocations:sources.length,buckets,strictUniqueCandidates:strictUnique.length,duplicateNational,strictSamples:strictUnique.slice(0,20),nearestSamples:candidates.slice().sort((a,b)=>a.distanceM-b.distanceM).slice(0,20),worstNearest:candidates.slice().sort((a,b)=>b.distanceM-a.distanceM).slice(0,12)};
console.log(JSON.stringify(result,null,2));
assert.equal(sources.length,181,'IONITY source location count changed; review crosswalk audit assumptions');
assert(national.length>100,'national IRVE should expose a substantial IONITY station population');
