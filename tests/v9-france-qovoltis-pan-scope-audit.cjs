'use strict';
const fs=require('node:fs');
const zlib=require('node:zlib');

const manifest=JSON.parse(fs.readFileSync('data/v9/france-static/manifest.json','utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(`data/v9/france-static/${manifest.allFile}`)).toString('utf8'));
const norm=v=>String(v==null?'':v).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const qovoltisRows=rows.filter(row=>norm(row?.[5]).includes('qovoltis'));
const networkCounts=new Map();
const postalCounts=new Map();
const pdcAll=new Set();
const stationSummaries=[];

for(const row of qovoltisRows){
  const stationId=String(row?.[0]||'');
  const name=String(row?.[1]||'');
  const address=String(row?.[2]||'');
  const operator=String(row?.[5]||'');
  const network=String(row?.[10]||row?.[5]||'');
  const configs=Array.isArray(row?.[8])?row[8]:[];
  const pdcs=uniq(configs.flatMap(cfg=>Array.isArray(cfg?.[6])?cfg[6].map(String):[]));
  const powers=uniq(configs.map(cfg=>Number(cfg?.[3])).filter(Number.isFinite)).sort((a,b)=>a-b);
  const postal=[...address.matchAll(/\b(\d{5})\b/g)].map(m=>m[1]).at(-1)||null;
  networkCounts.set(network,(networkCounts.get(network)||0)+pdcs.length);
  if(postal)postalCounts.set(postal.slice(0,2),(postalCounts.get(postal.slice(0,2))||0)+pdcs.length);
  for(const pdc of pdcs)pdcAll.add(pdc);
  stationSummaries.push({stationId,name,address,operator,network,postal,pdcCount:pdcs.length,pdcs:pdcs.slice(0,8),powers});
}

const rhone=stationSummaries.filter(x=>x.postal?.startsWith('69'));
const syderNamed=stationSummaries.filter(x=>/syder/i.test(`${x.name} ${x.address} ${x.network} ${x.operator}`));
const toSortedObject=map=>Object.fromEntries([...map.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))));
const result={
  generatedFrom:{nationalGeneratedAt:manifest.generatedAt,nationalStations:manifest.stationCount,nationalPdcCount:manifest.pdcCount},
  qovoltis:{stationCount:qovoltisRows.length,uniquePdcCount:pdcAll.size,networkPdcCounts:toSortedObject(networkCounts),departmentPrefixPdcCounts:toSortedObject(postalCounts)},
  rhonePostal69:{stationCount:rhone.length,pdcCount:new Set(rhone.flatMap(x=>x.pdcs)).size,samples:rhone.slice(0,40)},
  syderNamed:{stationCount:syderNamed.length,pdcCount:new Set(syderNamed.flatMap(x=>x.pdcs)).size,samples:syderNamed.slice(0,40)},
  qovoltisSamples:stationSummaries.slice(0,40)
};
console.log(JSON.stringify(result,null,2));
if(!qovoltisRows.length)throw new Error('Expected Qovoltis stations in France PAN baseline');
if(!pdcAll.size)throw new Error('Expected Qovoltis PDC identities in France PAN baseline');
