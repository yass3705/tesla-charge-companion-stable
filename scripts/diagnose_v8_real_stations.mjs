import fs from 'node:fs';
import zlib from 'node:zlib';

const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const contains=(value,needle)=>norm(value).includes(norm(needle));

function readLocalGzip(path){return JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString('utf8'));}
async function readRemoteGzip(url){
  const response=await fetch(url,{headers:{'User-Agent':'TeslaChargeCompanionV8-RegressionDiagnostic/1.0'}});
  if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
  return JSON.parse(zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
}

function summarizeBump(data){
  const targets=['meyerbeer','malesherbes'];
  return targets.map(target=>{
    const matches=(data.stations||[]).filter(st=>contains(st.name,target)||contains(st.address,target));
    return {target,matches:matches.map(st=>({
      stationId:st.stationId,name:st.name,address:st.address,
      points:(st.points||[]).map(p=>({id:p.idPdcItinerance,powerKw:p.powerKw,rankable:p.rankable,status:p.status,components:p.components,rules:p.rules}))
    }))};
  });
}

function summarizePowerdot(data){
  const entries=[];
  for(const entry of data.chargers||[]){
    const loc=entry.location||entry.charger?.location||{};
    const hay=[entry.name,entry.locationName,loc.name,loc.address,entry.address,entry.city,loc.city].filter(Boolean).join(' | ');
    if(!contains(hay,'orgeval')&&!contains(hay,'marche frais'))continue;
    entries.push({id:entry.id||entry.uid,name:entry.name||entry.locationName||loc.name,address:entry.address||loc.address,city:entry.city||loc.city,chargerName:entry.chargerName||entry.charger?.chargerName,connectors:(entry.charger?.connectors||[]).map(c=>({maxPowerKw:c.maxPowerKw,type:c.type,tariffId:c.tariff?.id,tariff:c.tariff}))});
  }
  return entries;
}

function summarizeFreshmile(data){
  const matches=(data.stations||[]).filter(st=>contains([st.name,st.address].filter(Boolean).join(' | '),'saint germain')||contains([st.name,st.address].filter(Boolean).join(' | '),'marche saint germain'));
  return matches.map(st=>({stationId:st.stationId,name:st.name,address:st.address,latitude:st.latitude,longitude:st.longitude,configurations:(st.configurations||[]).map(c=>({kind:c.kind,powerKw:c.powerKw,stalls:c.stalls,offerProvider:c.offerProvider,label:c.label,exact:c.pricing?.freshmileExact}))}));
}

const bump=readLocalGzip('data/bump_direct_tariffs_tcc_france.json.gz');
const [powerdot,freshmile]=await Promise.all([
  readRemoteGzip('https://raw.githubusercontent.com/yass3705/tesla-charge-companion-stable/main/data/powerdot_direct_france.json.gz'),
  readRemoteGzip('https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/national/freshmile_direct_tcc_v8.json.gz')
]);

console.log(JSON.stringify({
  bump:summarizeBump(bump),
  powerdot:summarizePowerdot(powerdot),
  freshmile:summarizeFreshmile(freshmile)
},null,2));
