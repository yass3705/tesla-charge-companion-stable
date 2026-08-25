#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

const dataPath=process.argv[2]||'data/fastned_direct_stations_france.json.gz';
if(!fs.existsSync(dataPath))throw new Error(`Fastned fixture missing: ${dataPath}`);
const inventory=JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath)).toString('utf8'));
const code=fs.readFileSync('assets/v8-fastned-station-overlay.js','utf8');

const sandbox={
  console,
  fetch:()=>new Promise(()=>{}),
  setTimeout:()=>0,
  document:{readyState:'complete',getElementById:()=>null,addEventListener:()=>{}},
  Blob:globalThis.Blob,
  Response:globalThis.Response,
  DecompressionStream:globalThis.DecompressionStream,
  window:{}
};
sandbox.window=sandbox;sandbox.window.window=sandbox;
vm.createContext(sandbox);vm.runInContext(code,sandbox);
const api=sandbox.TCCV8FastnedStationOverlay;
if(!api)throw new Error('Fastned V8 overlay API missing');
api.validateData(inventory);

const first=inventory.locations[0];
if(!first)throw new Error('Fastned inventory empty');
const baseConfig={
  id:'runtime-config',label:'Electroverse · DC 300 kW',kind:'DC',powerKw:300,stalls:4,
  pricing:{type:'rules',rules:[{scope:'allDay',billing:'kwh',currency:'EUR',pricePerKwh:.70}]},
  offerProvider:'Electroverse'
};
const prepared={
  origin:{lat:Number(first.latitude),lon:Number(first.longitude),label:'test'},
  maxDistanceKm:.001,
  stations:[
    {
      id:'runtime-fastned-a',catalogStationId:'electroverse:fastned-a',operator:'Fastned',countryCode:'FR',
      name:'runtime A',address:'runtime address',latitude:Number(first.latitude),longitude:Number(first.longitude),
      source:'franceNationalCatalog',liveStatus:'AVAILABLE',temporarilyUnavailable:false,
      chargingConfigurations:[baseConfig],_airKm:0
    },
    {
      id:'runtime-fastned-b',catalogStationId:'electroverse:fastned-b',operator:'Fastned',countryCode:'FR',
      name:'runtime B',latitude:Number(first.latitude)+0.00002,longitude:Number(first.longitude),
      source:'franceNationalCatalog',chargingConfigurations:[baseConfig],_airKm:.002
    },
    {
      id:'other-network',catalogStationId:'electroverse:other',operator:'Other CPO',countryCode:'FR',
      name:'Other CPO same place',latitude:Number(first.latitude),longitude:Number(first.longitude),
      source:'franceNationalCatalog',chargingConfigurations:[baseConfig],_airKm:0
    }
  ]
};

const out=api.mergePrepared(prepared,inventory);
if(out.fastnedStationOverlayApplied!==true)throw new Error('Fastned applied marker missing');
if(out.fastnedStationOverlayStats.officialNationalCount!==inventory.locations.length)throw new Error('national count mismatch');
if(out.fastnedStationOverlayStats.officialInPreparedArea!==1)throw new Error(`area selection mismatch: ${JSON.stringify(out.fastnedStationOverlayStats)}`);
if(out.fastnedStationOverlayStats.matchedRuntimeSites!==1)throw new Error('runtime Fastned match missing');
if(out.fastnedStationOverlayStats.collapsedRuntimeDuplicates!==1)throw new Error('Fastned duplicate was not collapsed');
if(out.fastnedStationOverlayStats.addedOfficialSites!==0)throw new Error('matched site should not be added as synthetic');
if(out.stations.length!==2)throw new Error(`unexpected physical station count: ${out.stations.length}`);
const fastned=out.stations.find(x=>x._fastnedOfficial);
const other=out.stations.find(x=>x.id==='other-network');
if(!fastned||!other)throw new Error('Fastned merge touched unrelated CPO or lost canonical site');
if(fastned.id!=='runtime-fastned-a'||fastned.catalogStationId!=='electroverse:fastned-a')throw new Error('runtime canonical/live identity was not preserved');
if(fastned.liveStatus!=='AVAILABLE')throw new Error('runtime live status was not preserved');
if(fastned.name!==first.name||fastned.address!==first.address)throw new Error('official Fastned identity was not applied');
if(fastned.fastnedStationId!==first.stationId||fastned._fastnedMergedSourceCount!==2)throw new Error('Fastned provenance incomplete');
if(fastned.chargingConfigurations.length!==1)throw new Error('identical runtime configurations were not deduplicated');
const twice=api.mergePrepared(out,inventory);
if(twice.stations.length!==2||twice.fastnedStationOverlayStats.collapsedRuntimeDuplicates!==1)throw new Error('Fastned overlay is not idempotent');

const tariff=JSON.parse(fs.readFileSync('data/tariff_overlay_v1.json','utf8'));
const direct=new Map((tariff.operatorOffers||[]).map(x=>[x.id,x]));
const subs=new Map((tariff.subscriptions||[]).map(x=>[x.id,x]));
const std=direct.get('fastned-standard'),app=direct.get('fastned-app'),gold=subs.get('fastned-gold');
if(Number(std?.pricing?.rules?.[0]?.pricePerKwh)!==0.61)throw new Error('Fastned Standard V8 tariff missing');
if(Number(app?.pricing?.rules?.[0]?.pricePerKwh)!==0.549)throw new Error('Fastned App V8 tariff missing');
if(Number(gold?.pricePerKwh)!==0.43||Number(gold?.monthlyFeeEur)!==5.99||gold?.defaultSelected!==false)throw new Error('Fastned Gold V8 opt-in tariff invalid');
if(gold?.monthlyFeePromotionEnd!=='2026-09-30')throw new Error('Fastned Gold promotion end mismatch');

console.log(JSON.stringify({
  nationalStations:inventory.locations.length,
  nationalChargingPoints:inventory.counts?.franceChargingPointCount,
  candidatePages:inventory.counts?.candidateLocationPageCount,
  sample:first.stationId,
  mergeStats:out.fastnedStationOverlayStats,
  tariffs:{standard:.61,app:.549,gold:.43,goldMonthlyFee:5.99}
},null,2));
