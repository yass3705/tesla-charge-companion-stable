'use strict';
const fs=require('node:fs');
const direct=require('../assets/v9/adapters/direct-offers.js');
const loaders=require('../assets/v9/browser-loaders.js');

function snapshot({blockingFee=null}={}){
  const connectors=[];
  for(let i=0;i<1850;i++){
    const id=`FR*IOY*E${String(100000+i)}`;
    connectors.push({
      connectorUuid:`c-${i}`,sourceEvseId:id,number:i+1,type:'CCS',maxPowerW:i%2?350000:50000,status:'AVAILABLE',
      adhocPrice:{name:'IONITY DIRECT',unit:'kWh',amount:i===0?'0.35':'0.55',currency:'EUR'},
      blockingFee:i===0?blockingFee:null
    });
  }
  return{
    schemaVersion:1,generatedAt:'2026-09-01T19:49:01Z',source:'https://adhoc-bff.ionity.cloud',failClosed:true,
    evseCount:1853,resolvedEvseCount:1850,locationCount:181,failureCount:3,missingPriceCount:0,
    stations:[{locationUuid:'loc-1',name:'IONITY test',country:'FR',connectors}],
    failures:[
      {evseId:'FR*IOY*E1',stage:'resolve'},
      {evseId:'FR*IOY*E2',stage:'resolve'},
      {evseId:'FRTSLE2IOYGE',stage:'resolve'}
    ]
  };
}

(async()=>{
  const out=direct.normalizePayload(snapshot());
  if(out.offerRules.length!==2)throw new Error(`expected two price groups, got ${out.offerRules.length}`);
  const rules=new Map(out.offerRules.map(r=>[r.pricing.pricePerKwh,r]));
  if(!rules.has(.35)||!rules.has(.55))throw new Error('mixed IONITY prices were not preserved');
  const exactCount=out.offerRules.reduce((n,r)=>n+(r.evseIds||[]).filter(x=>x.includes('*')).length,0);
  if(exactCount!==1850)throw new Error(`expected 1850 canonical exact EVSE IDs, got ${exactCount}`);
  for(const r of out.offerRules){
    if(r.priority!==130)throw new Error('IONITY exact priority must be 130');
    if(r.metadata.verifiedScope!=='exact_evse')throw new Error('IONITY offer must be exact_evse');
    if(r.networkIds.length||r.stationIds.length)throw new Error('IONITY exact offer leaked a network/station fallback');
  }
  let blocked=false;
  try{direct.normalizePayload(snapshot({blockingFee:{amount:'0.10',currency:'EUR',unit:'minute'}}));}catch(e){blocked=/blocking fee/i.test(e.message);}
  if(!blocked)throw new Error('non-null IONITY blocking fee must fail closed');

  const remote='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/operator_direct/ionity_exact_france.json';
  let requested=null;
  const registry={sources:[{id:'ionity',adapter:'direct-offer-json',url:remote,active:true}]};
  const fakeFetch=async url=>{requested=url;return{ok:true,json:async()=>snapshot()};};
  const ls=loaders.createRegistryLoaders({registry,basePath:'..',adapters:{directOffers:direct},fetchImpl:fakeFetch});
  const loaded=await ls.ionity({countryCode:'FR'});
  if(requested!==remote)throw new Error(`remote direct-offer URL mangled: ${requested}`);
  if(loaded.offerRules.length!==2)throw new Error('remote direct-offer loader did not normalize snapshot');

  const app=fs.readFileSync('v9-app/app.js','utf8');
  if(!app.includes("id:'france-ionity-exact-offers'"))throw new Error('V9 app exact IONITY source missing');
  if(!app.includes("s.id==='ionity-direct-france'"))throw new Error('V9 app legacy IONITY disable guard missing');
  if(!app.includes('legacyIonity.active=false'))throw new Error('legacy IONITY source is not disabled');
  console.log('V9 France IONITY exact runtime tests OK');
})().catch(e=>{console.error(e);process.exit(1);});
