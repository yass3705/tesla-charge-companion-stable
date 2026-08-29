const fs=require('node:fs');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const readGzip=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
const plainNorm=v=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const nameNorm=v=>plainNorm(v).replace(/\bionity\b/g,' ').replace(/\bgmbh\b/g,' ').trim().replace(/\s+/g,' ');
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
  const nearby=ranked.filter(x=>x.d<=0.01);
  const srcName=nameNorm(src.name);
  const nameMatches=nearby.filter(x=>srcName&&nameNorm(x.n.name)===srcName);
  const srcAddress=plainNorm(`${src.address} ${src.city}`);
  const addressMatches=nearby.filter(x=>{const n=plainNorm(x.n.address);return srcAddress&&n&&(srcAddress.includes(n)||n.includes(srcAddress));});
  const selected=nameMatches.length===1?nameMatches[0]:addressMatches.length===1?addressMatches[0]:null;
  const nearest=ranked[0]||null;
  candidates.push({
    uuid:src.uuid,locationId:src.locationId,sourceName:src.name,
    nationalId:selected?.n.stationId||null,nationalName:selected?.n.name||null,distanceM:selected?Math.round(selected.d*1000):null,
    nearbyCount:nearby.length,nameMatchCount:nameMatches.length,addressMatchCount:addressMatches.length,
    nearestNationalId:nearest?.n.stationId||null,nearestNationalName:nearest?.n.name||null,nearestDistanceM:nearest?Math.round(nearest.d*1000):null,
    strictCandidate:!!selected,match:selected?(nameMatches.length===1?'exact_normalized_name_within_10m':'exact_address_within_10m'):null
  });
}
const strict=candidates.filter(x=>x.strictCandidate);
const groupedNational=new Map(),groupedSource=new Map();
for(const c of strict){const n=groupedNational.get(c.nationalId)||[];n.push(c);groupedNational.set(c.nationalId,n);const s=groupedSource.get(c.locationId)||[];s.push(c);groupedSource.set(c.locationId,s);}
const duplicateNational=[...groupedNational.entries()].filter(([,v])=>v.length>1).map(([nationalId,v])=>({nationalId,count:v.length,sourceIds:v.map(x=>x.locationId)}));
const duplicateSource=[...groupedSource.entries()].filter(([,v])=>v.length>1).map(([locationId,v])=>({locationId,count:v.length,nationalIds:v.map(x=>x.nationalId)}));
const badNational=new Set(duplicateNational.map(x=>x.nationalId)),badSource=new Set(duplicateSource.map(x=>x.locationId));
const strictUnique=strict.filter(x=>!badNational.has(x.nationalId)&&!badSource.has(x.locationId));
const result={
  nationalIonityStations:national.length,sourceIonityLocations:sources.length,
  nearestUnder10m:candidates.filter(x=>x.nearestDistanceM!=null&&x.nearestDistanceM<=10).length,
  exactNameWithin10m:candidates.filter(x=>x.nameMatchCount===1).length,
  exactAddressWithin10m:candidates.filter(x=>x.nameMatchCount!==1&&x.addressMatchCount===1).length,
  strictCandidates:strict.length,strictUniqueCandidates:strictUnique.length,
  unresolved:candidates.filter(x=>!x.strictCandidate).length,duplicateNational,duplicateSource,
  strictSamples:strictUnique.slice(0,20),unresolvedSamples:candidates.filter(x=>!x.strictCandidate).slice(0,30)
};
console.log(JSON.stringify(result,null,2));
assert.equal(sources.length,181,'IONITY source location count changed; review crosswalk audit assumptions');
assert(national.length>100,'national IRVE should expose a substantial IONITY station population');
assert.equal(candidates.filter(x=>x.nearestDistanceM!=null&&x.nearestDistanceM<=10).length,181,'every current IONITY source location should remain spatially represented in IRVE');
