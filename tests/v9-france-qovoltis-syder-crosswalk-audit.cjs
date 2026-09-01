'use strict';
const fs=require('node:fs');
const zlib=require('node:zlib');
const manifest=JSON.parse(fs.readFileSync('data/v9/france-static/manifest.json','utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(`data/v9/france-static/${manifest.allFile}`)).toString('utf8'));
const norm=v=>String(v??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const uniq=a=>[...new Set(a.filter(Boolean))];
const counts=(items,key)=>Object.fromEntries([...items.reduce((m,x)=>m.set(key(x),(m.get(key(x))||0)+1),new Map()).entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))));
const q=rows.filter(r=>norm(r?.[5]).includes('QOVOLTIS')).map(r=>{
  const configs=Array.isArray(r?.[8])?r[8]:[];
  const pdcs=uniq(configs.flatMap(c=>Array.isArray(c?.[6])?c[6].map(String):[]));
  const powers=uniq(configs.map(c=>Number(c?.[3])).filter(Number.isFinite)).sort((a,b)=>a-b);
  const address=String(r?.[2]||'');
  const postal=[...address.matchAll(/\b(\d{5})\b/g)].map(m=>m[1]).at(-1)||'';
  return {id:String(r?.[0]||''),name:String(r?.[1]||''),address,postal,pdcs,powers};
});
const r69=q.filter(x=>x.postal.startsWith('69'));
const report={
  panGeneratedAt:manifest.generatedAt,
  qovoltisNational:{stations:q.length,pdcs:uniq(q.flatMap(x=>x.pdcs)).length},
  qovoltis69:{stations:r69.length,pdcs:uniq(r69.flatMap(x=>x.pdcs)).length},
  prefix6:counts(r69,x=>x.id.slice(0,6)),
  prefix8:counts(r69,x=>x.id.slice(0,8)),
  prefix10:counts(r69,x=>x.id.slice(0,10)),
  prefix12:counts(r69,x=>x.id.slice(0,12)),
  legacySyder:{stations:r69.filter(x=>/^FRS69SYD/i.test(x.id)).length,pdcs:uniq(r69.filter(x=>/^FRS69SYD/i.test(x.id)).flatMap(x=>x.pdcs)).length},
  families:Object.entries(counts(r69,x=>x.id.slice(0,10))).slice(0,30).map(([prefix,stations])=>({prefix,stations,samples:r69.filter(x=>x.id.startsWith(prefix)).slice(0,6)})),
  all69:r69.map(x=>({id:x.id,name:x.name,address:x.address,powers:x.powers,pdcCount:x.pdcs.length}))
};
console.log(JSON.stringify(report,null,2));
if(!r69.length) throw new Error('No Qovoltis Rhône rows found');
