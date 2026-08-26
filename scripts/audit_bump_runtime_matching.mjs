import fs from 'node:fs';
import zlib from 'node:zlib';

function readGzipJson(path){return JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString('utf8'));}
const bump=readGzipJson('data/bump_direct_tariffs_tcc_france.json.gz');
const france=readGzipJson('data/non_tesla_france/all.json.gz');
const terms=['meyerbeer','malesherbes'];
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const signature=p=>JSON.stringify({components:p?.components||null,rules:p?.rules||null});
function distanceKm(aLat,aLon,bLat,bLon){
  const R=6371,toRad=x=>Number(x)*Math.PI/180;
  const p1=toRad(aLat),p2=toRad(bLat),dp=toRad(Number(bLat)-Number(aLat)),dl=toRad(Number(bLon)-Number(aLon));
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
function physicalGroups(records){
  const groups=new Map();
  for(const st of records)for(const p of st.points||[]){
    const key=String(Number(p.powerKw||0));
    if(!groups.has(key))groups.set(key,{powerKw:Number(p.powerKw||0),points:0,rankable:0,signatures:new Set(),ids:[]});
    const g=groups.get(key);g.points++;if(p.rankable===true)g.rankable++;if(p.rankable===true)g.signatures.add(signature(p));if(p.idPdcItinerance)g.ids.push(p.idPdcItinerance);
  }
  return [...groups.values()].map(g=>({...g,signatures:g.signatures.size,ids:g.ids.slice(0,8)})).sort((a,b)=>a.powerKw-b.powerKw);
}

for(const term of terms){
  const bumpHits=(bump.stations||[]).filter(st=>norm(`${st.name} ${st.address}`).includes(term));
  if(!bumpHits.length){console.log(JSON.stringify({term,error:'no Bump hit'}));continue;}
  const site=bumpHits[0],lat=Number(site.latitude??site.coordinates?.[0]),lon=Number(site.longitude??site.coordinates?.[1]);
  const nearby=(france||[]).map(row=>({row,distanceKm:distanceKm(lat,lon,row?.[3],row?.[4])})).filter(x=>Number.isFinite(x.distanceKm)&&x.distanceKm<=.20).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,12).map(({row,distanceKm})=>({
    distanceM:Math.round(distanceKm*1000),catalogStationId:row?.[0],name:row?.[1],address:row?.[2],operator:row?.[5],
    configurations:(row?.[8]||[]).map(c=>({id:c?.[0],label:c?.[1],kind:c?.[2],powerKw:Number(c?.[3]),stalls:Number(c?.[4])}))
  }));
  console.log(JSON.stringify({
    term,
    bumpSite:{name:site.name,address:site.address,latitude:lat,longitude:lon,records:bumpHits.length,groups:physicalGroups(bumpHits)},
    exactNameCatalog:(france||[]).filter(row=>norm(row?.[1])===norm(site.name)).length,
    exactAddressCatalog:(france||[]).filter(row=>norm(row?.[2])===norm(site.address)).length,
    nearbyCatalog:nearby
  },null,2));
}
