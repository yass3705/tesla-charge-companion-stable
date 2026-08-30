const fs=require('node:fs');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');

const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const readGzipJson=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
const text=v=>String(v==null?'':v).trim();
const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const uniq=a=>[...new Set((a||[]).filter(Boolean))];
const isIzivia=v=>{const n=norm(v);return n==='izivia'||n.startsWith('izivia-');};

const targetMatchers={
  grandLyon:/grand-lyon|metropole-de-lyon|lyon/,
  aixMarseille:/aix|marseille/,
  parisSaclay:/paris-saclay|saclay/,
  garenneColombes:/garenne-colombes/,
  express:/express/
};

const manifest=readJson('data/v9/france-static/manifest.json');
const rows=readGzipJson(`data/v9/france-static/${manifest.allFile}`);
const byNetwork=new Map(),candidateStations=[];

for(const row of rows){
  const stationId=text(row?.[0]),name=text(row?.[1]),address=text(row?.[2]),operator=text(row?.[5]),network=text(row?.[10]||row?.[5]),configs=row?.[8]||[];
  if(!isIzivia(operator)&&!isIzivia(network))continue;
  let pdcs=0;const powers=new Set(),kinds=new Set(),pdcIds=[];
  for(const cfg of configs){
    const kind=text(cfg?.[2]||'AC').toUpperCase(),power=Number(cfg?.[3]||0),ids=uniq(Array.isArray(cfg?.[6])?cfg[6].map(text):[]);
    pdcs+=ids.length;ids.forEach(x=>pdcIds.push(x));if(power>0)powers.add(power);if(kind)kinds.add(kind);
  }
  const key=network||operator||'Unknown',r=byNetwork.get(key)||{network:key,networkNorm:norm(key),stations:0,pdcs:0,powers:new Set(),kinds:new Set(),operators:new Set(),samples:[]};
  r.stations++;r.pdcs+=pdcs;for(const x of powers)r.powers.add(x);for(const x of kinds)r.kinds.add(x);r.operators.add(operator);if(r.samples.length<8)r.samples.push({stationId,name,address,operator,network,pdcs,powers:[...powers].sort((a,b)=>a-b),pdcIds:pdcIds.slice(0,8)});byNetwork.set(key,r);
  const hay=norm(`${name} ${address} ${network}`);
  const targetNames=Object.entries(targetMatchers).filter(([,rx])=>rx.test(hay)).map(([key])=>key);
  if(targetNames.length&&candidateStations.length<500)candidateStations.push({stationId,name,address,operator,network,networkNorm:norm(network),targetNames,pdcs,powers:[...powers].sort((a,b)=>a-b),kinds:[...kinds].sort(),pdcIds:pdcIds.slice(0,12)});
}

const networks=[...byNetwork.values()].map(r=>({network:r.network,networkNorm:r.networkNorm,stations:r.stations,pdcs:r.pdcs,powers:[...r.powers].sort((a,b)=>a-b),kinds:[...r.kinds].sort(),operators:[...r.operators].sort(),samples:r.samples})).sort((a,b)=>b.pdcs-a.pdcs||a.network.localeCompare(b.network));
const knownTargets=Object.fromEntries(Object.entries(targetMatchers).map(([key,rx])=>[key,networks.filter(r=>rx.test(r.networkNorm))]));
const targetSummary=Object.fromEntries(Object.keys(targetMatchers).map(key=>{
  const exact=knownTargets[key];
  const candidates=candidateStations.filter(r=>r.targetNames.includes(key));
  return [key,{
    exactNetworkCount:exact.length,
    exactNetworks:exact.map(r=>r.network),
    exactStations:exact.reduce((s,r)=>s+r.stations,0),
    exactPdcs:exact.reduce((s,r)=>s+r.pdcs,0),
    exactPowers:uniq(exact.flatMap(r=>r.powers)).sort((a,b)=>a-b),
    candidateStationCount:candidates.length,
    candidateNetworkNames:uniq(candidates.map(r=>r.network)).sort(),
    candidateSamples:candidates.slice(0,12)
  }];
}));
const summary={nationalGeneratedAt:manifest.generatedAt,iziviaNetworkCount:networks.length,iziviaStations:networks.reduce((s,r)=>s+r.stations,0),iziviaPdcs:networks.reduce((s,r)=>s+r.pdcs,0),topNetworks:networks.slice(0,40),knownTargets,targetSummary,candidateStations};
console.log(JSON.stringify(summary,null,2));
console.log('IZIVIA_TARGET_SUMMARY='+JSON.stringify(targetSummary));
assert(summary.iziviaPdcs>1000,'IZIVIA audit must cover a meaningful national population');
assert(summary.iziviaNetworkCount>0,'IZIVIA networks must exist');
assert(networks.every(r=>r.network&&r.stations>0&&r.pdcs>0),'network rows must be usable');
for(const [key,target] of Object.entries(targetSummary)){
  assert(target.exactNetworkCount===target.exactNetworks.length,`${key}: exact network count mismatch`);
  if(target.exactNetworkCount===0) assert(target.exactPdcs===0,`${key}: non-zero PDCs without exact network identity`);
}
