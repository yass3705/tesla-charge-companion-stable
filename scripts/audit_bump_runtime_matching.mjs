import fs from 'node:fs';
import zlib from 'node:zlib';

function readGzipJson(path){return JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString('utf8'));}
const bump=readGzipJson('data/bump_direct_tariffs_tcc_france.json.gz');
const france=readGzipJson('data/non_tesla_france/all.json.gz');
const terms=['meyer','malesh'];
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

for(const term of terms){
  const bumpHits=(bump.stations||[]).filter(st=>norm(`${st.name} ${st.address}`).includes(term)).map(st=>({
    stationId:st.stationId,name:st.name,address:st.address,latitude:st.latitude,longitude:st.longitude,coordinates:st.coordinates,
    points:(st.points||[]).map(p=>({idPdcItinerance:p.idPdcItinerance,powerKw:p.powerKw,status:p.status,rankable:p.rankable,components:p.components,rules:p.rules}))
  }));
  const catalogHits=(france||[]).filter(row=>norm(`${row?.[1]} ${row?.[2]}`).includes(term)).map(row=>({
    catalogStationId:row?.[0],name:row?.[1],address:row?.[2],latitude:row?.[3],longitude:row?.[4],operator:row?.[5],
    configurations:(row?.[8]||[]).map(c=>({id:c?.[0],label:c?.[1],kind:c?.[2],powerKw:c?.[3],stalls:c?.[4]}))
  }));
  console.log(JSON.stringify({term,bumpHits,catalogHits},null,2));
}
