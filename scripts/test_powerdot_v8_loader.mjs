import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

function assert(condition,message){if(!condition)throw new Error(message);}

const code=fs.readFileSync('assets/france-catalog-v8.js','utf8');
const gzip=fs.readFileSync('data/powerdot_direct_france.json.gz');
const raw=JSON.parse(zlib.gunzipSync(gzip).toString('utf8'));
const rawFrench=(raw.chargers||[]).filter(entry=>entry?.location?.countryCode==='FR');

const sandbox={
  console,
  setTimeout:()=>0,
  clearTimeout:()=>{},
  setInterval:()=>0,
  clearInterval:()=>{},
  Response,Blob,DecompressionStream,Uint8Array,Date,
  fetch:async input=>{
    if(String(input).includes('powerdot_direct_france.json.gz'))return new Response(gzip,{status:200});
    throw new Error(`fetch inattendu: ${input}`);
  },
  document:{getElementById:()=>null},
  localStorage:{getItem:()=>null},
  candidateStations:async()=>({stations:[]}),
  resolveOrigin:async()=>({lat:48.81,lon:2.07,label:'test'}),
  stations:[],window:null
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(code,sandbox);

const loaded=await sandbox.TCCFranceCatalog.loadPowerdotCatalog();
assert(loaded.chargers.length===rawFrench.length,`Filtrage France Powerdot incorrect: ${loaded.chargers.length}/${rawFrench.length}`);
assert(loaded.chargers.every(entry=>entry?.location?.countryCode==='FR'),'Une station Powerdot hors France reste dans le runtime');
assert(Number(loaded.counts?.excludedForeignChargers)===raw.chargers.length-rawFrench.length,'Comptage Powerdot hors France incohérent');

const api=sandbox.TCCFranceCatalogV8;
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const orgeval=api.powerdotLocations(loaded).find(location=>norm(location.name).includes('marche frais')&&norm(location.name).includes('orgeval'));
assert(orgeval,'Marché Frais Orgeval absent du catalogue Powerdot filtré');
const direct=api.powerdotDirectConfigurations(orgeval);
const has=(kind,power,price)=>direct.some(c=>c.kind===kind&&Math.abs(Number(c.powerKw)-power)<.01&&Math.abs(Number(c.pricing?.rules?.[0]?.pricePerKwh)-price)<1e-9);
assert(has('AC',22,.44),'Orgeval AC 22 kW Powerdot != 0,44 €/kWh');
assert(has('DC',50,.54),'Orgeval DC 50 kW Powerdot != 0,54 €/kWh');
assert(has('DC',200,.59),'Orgeval DC 200 kW Powerdot != 0,59 €/kWh');

console.log(JSON.stringify({
  rawChargers:raw.chargers.length,
  frenchChargers:loaded.chargers.length,
  excludedForeignChargers:loaded.counts.excludedForeignChargers,
  orgevalDirect:direct.map(c=>({kind:c.kind,powerKw:c.powerKw,pricePerKwh:c.pricing?.rules?.[0]?.pricePerKwh}))
},null,2));
