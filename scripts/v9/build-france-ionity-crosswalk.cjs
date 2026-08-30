const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');

const root=path.resolve(__dirname,'../..');
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const readGzip=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,p))).toString('utf8'));
const plainNorm=v=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const nameNorm=v=>plainNorm(v).replace(/\bionity\b/g,' ').replace(/\bgmbh\b/g,' ').trim().replace(/\s+/g,' ');
const rad=x=>x*Math.PI/180;
const distanceKm=(a,b)=>{const R=6371,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),p1=rad(a.lat),p2=rad(b.lat);const h=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};

function build(){
  const manifest=readJson('data/v9/france-static/manifest.json');
  const rows=readGzip(`data/v9/france-static/${manifest.allFile}`);
  const ionity=readGzip('data/ionity_direct_stations_france.json.gz');
  const national=rows.filter(r=>plainNorm(r?.[5])==='ionity').map(r=>({stationId:String(r[0]),name:String(r[1]||''),address:String(r[2]||''),lat:Number(r[3]),lon:Number(r[4])})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
  const sources=(ionity.locations||[]).map(x=>({uuid:String(x.uuid||''),locationId:String(x.locationId||''),name:String(x.name||''),address:String(x.address||''),city:String(x.city||''),lat:Number(x.latitude),lon:Number(x.longitude)})).filter(x=>x.uuid&&x.locationId&&Number.isFinite(x.lat)&&Number.isFinite(x.lon));
  const candidates=[];
  for(const src of sources){
    const nearby=national.map(n=>({n,d:distanceKm(src,n)})).filter(x=>x.d<=0.01).sort((a,b)=>a.d-b.d||a.n.stationId.localeCompare(b.n.stationId));
    const srcName=nameNorm(src.name),nameMatches=nearby.filter(x=>srcName&&nameNorm(x.n.name)===srcName);
    const srcAddress=plainNorm(`${src.address} ${src.city}`),addressMatches=nearby.filter(x=>{const n=plainNorm(x.n.address);return srcAddress&&n&&(srcAddress.includes(n)||n.includes(srcAddress));});
    const selected=nameMatches.length===1?nameMatches[0]:addressMatches.length===1?addressMatches[0]:null;
    if(!selected)continue;
    candidates.push({source:src,target:selected.n,match:nameMatches.length===1?'exact_normalized_name_within_10m':'exact_address_within_10m',distanceM:Math.round(selected.d*1000)});
  }
  const byNational=new Map(),byLocation=new Map();
  for(const c of candidates){const a=byNational.get(c.target.stationId)||[];a.push(c);byNational.set(c.target.stationId,a);const b=byLocation.get(c.source.locationId)||[];b.push(c);byLocation.set(c.source.locationId,b);}
  const safe=candidates.filter(c=>(byNational.get(c.target.stationId)||[]).length===1&&(byLocation.get(c.source.locationId)||[]).length===1).sort((a,b)=>a.target.stationId.localeCompare(b.target.stationId));
  return{
    schemaVersion:1,
    generatedAt:manifest.generatedAt||ionity.generatedAt||null,
    generatedFrom:{nationalManifest:'data/v9/france-static/manifest.json',nationalGeneratedAt:manifest.generatedAt||null,ionitySnapshot:'data/ionity_direct_stations_france.json.gz',ionityGeneratedAt:ionity.generatedAt||null,policy:'same-operator, <=10m, unique normalized exact name; address unique fallback; ambiguous matches excluded'},
    counts:{sourceLocations:sources.length,nationalIonityStations:national.length,safeEntries:safe.length,unresolved:sources.length-safe.length},
    entries:safe.map(c=>({canonicalId:`FR:national:${c.target.stationId}`,aliases:[`ionity:${c.source.uuid}`,`ionity-location:${c.source.locationId}`],sourceStationId:c.target.stationId,updatedAt:manifest.generatedAt||null,evidence:{sourceName:c.source.name,nationalName:c.target.name,distanceM:c.distanceM,match:c.match}}))
  };
}

const out=build();
if(out.counts.safeEntries!==133)throw new Error(`unexpected safe IONITY crosswalk count ${out.counts.safeEntries}; review source changes`);
const target=process.argv[2];
const json=JSON.stringify(out,null,2)+'\n';
if(target){fs.mkdirSync(path.dirname(path.resolve(target)),{recursive:true});fs.writeFileSync(path.resolve(target),json);}
else process.stdout.write(json);
module.exports={build};
