from pathlib import Path

CATALOG=Path('assets/france-catalog-v8.js')
PAGES=Path('.github/workflows/pages.yml')
TEST=Path('scripts/test_powerdot_v8_runtime.mjs')
SYNC=Path('.github/workflows/sync-powerdot-direct-v8.yml')

s=CATALOG.read_text(encoding='utf-8')

old="// Tesla Charge Companion V8 — catalogue national France enrichi E55C + Belib' + IONITY + Atlante."
if old in s:
    s=s.replace(old,"// Tesla Charge Companion V8 — catalogue national France enrichi E55C + Belib' + IONITY + Atlante + Powerdot.",1)

old="  const ATLANTE_URL='data/atlante_direct_stations_france.json.gz';\n"
if 'const POWERDOT_URL=' not in s:
    assert old in s,'Ancre ATLANTE_URL absente'
    s=s.replace(old,old+"  const POWERDOT_URL='data/powerdot_direct_france.json.gz';\n",1)

old="  let manifestPromise=null,statusPromise=null,e55cPromise=null,belibPromise=null,belibLivePromise=null,belibLiveLoadedAt=0,ionityPromise=null,atlantePromise=null;"
if 'powerdotPromise=null' not in s:
    assert old in s,'Ancre promises absente'
    s=s.replace(old,"  let manifestPromise=null,statusPromise=null,e55cPromise=null,belibPromise=null,belibLivePromise=null,belibLiveLoadedAt=0,ionityPromise=null,atlantePromise=null,powerdotPromise=null;",1)

loader=r'''  async function loadPowerdotCatalog(){
    if(!powerdotPromise)powerdotPromise=readStandaloneGzip(POWERDOT_URL,'Powerdot').then(data=>{
      if(data?.dataset!=='powerdot-direct-cpo-france')throw new Error('Dataset Powerdot inattendu');
      if(data?.source?.pricingContext!=='direct CPO / adhoc / emspCode empty')throw new Error('Contexte tarifaire Powerdot invalide');
      if(!Array.isArray(data?.chargers)||Number(data?.counts?.apiSuccessChargers)!==data.chargers.length||data.chargers.length<2200)throw new Error('Inventaire Powerdot incomplet');
      if(Number(data?.counts?.pricedConnectors)<7000||Number(data?.counts?.coveredIrveStations)<1000)throw new Error('Couverture Powerdot insuffisante');
      if(data.chargers.some(entry=>entry?.location?.countryCode!=='FR'))throw new Error('Station Powerdot hors France');
      if(data.chargers.some(entry=>(entry?.charger?.connectors||[]).some(connector=>connector?.tariff?.subscriptionActive===true)))throw new Error('Tarif abonné présent dans la base Powerdot directe');
      window.TCC_POWERDOT_DIRECT_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base Powerdot directe ignorée :',error?.message||error);
      return {chargers:[],counts:{}};
    });
    return powerdotPromise;
  }

'''
anchor="  async function readGzipJson(file,version=''){"
if 'async function loadPowerdotCatalog()' not in s:
    assert anchor in s,'Ancre readGzipJson absente'
    s=s.replace(anchor,loader+anchor,1)

merge_meta="      if(config.atlanteConnectorIds)existing.atlanteConnectorIds=[...new Set([...(existing.atlanteConnectorIds||[]),...config.atlanteConnectorIds])];\n"
if 'if(config.powerdotIrvePdcIds)' not in s:
    assert merge_meta in s,'Ancre mergeConfigurations Atlante absente'
    s=s.replace(merge_meta,merge_meta+"      if(config.powerdotIrvePdcIds)existing.powerdotIrvePdcIds=[...new Set([...(existing.powerdotIrvePdcIds||[]),...config.powerdotIrvePdcIds])];\n      if(config.powerdotChargerNames)existing.powerdotChargerNames=[...new Set([...(existing.powerdotChargerNames||[]),...config.powerdotChargerNames])];\n      if(config.powerdotTariffIds)existing.powerdotTariffIds=[...new Set([...(existing.powerdotTariffIds||[]),...config.powerdotTariffIds])];\n",1)

block=r'''  function isPowerdotOperator(station){
    const value=norm(station?.operator);
    return value==='powerdot'||value==='power dot'||value.startsWith('powerdot ')||value.startsWith('power dot ');
  }
  function powerdotPricing(tariff){
    const rule={scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:(text(tariff?.currencyCode)||'EUR').toUpperCase(),pricePerKwh:0,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'};
    let hasPrice=false;
    for(const element of tariff?.elements||[]){
      const restrictions=element?.restrictions||{};
      for(const component of element?.priceComponents||[]){
        const type=text(component?.type).toUpperCase(),price=Number(component?.pricePerUnit);
        if(!Number.isFinite(price)||price<0)continue;
        if(type==='ENERGY'&&price>0){rule.pricePerKwh=price;hasPrice=true;}
        else if(type==='FLAT'&&price>0){rule.connectionFee=price;hasPrice=true;}
        else if(type==='PARKING_TIME'&&price>0){rule.idlePerMinute=price;hasPrice=true;}
        else if(type==='TIME'&&price>0){
          const thresholdSec=Number(restrictions?.minDurationSec||0);
          if(thresholdSec>0){rule.afterMinutesRate=price;rule.afterMinutesThreshold=thresholdSec/60;}
          else rule.chargePerMinute=price;
          hasPrice=true;
        }
      }
    }
    return hasPrice?{type:'rules',rules:[rule]}:{type:'rules',rules:[]};
  }
  function powerdotLocations(data){
    const map=new Map();
    for(const entry of data?.chargers||[]){
      const location=entry?.location||{},latitude=Number(location.latitude),longitude=Number(location.longitude);
      if(location.countryCode!=='FR'||!Number.isFinite(latitude)||!Number.isFinite(longitude))continue;
      const key=text(location.id)||text(location.uid)||`${latitude.toFixed(6)}|${longitude.toFixed(6)}|${norm(location.name)}`;
      if(!map.has(key))map.set(key,{id:key,uid:text(location.uid),name:text(location.name),address:text(location.address),zipcode:text(location.zipcode),city:text(location.city),latitude,longitude,countryCode:'FR',chargers:[],irvePdcIds:[]});
      const target=map.get(key);
      target.chargers.push(entry);
      target.irvePdcIds=[...new Set([...target.irvePdcIds,...(entry.irvePdcIds||[])])];
    }
    return [...map.values()];
  }
  function powerdotConnectorKind(connector){
    const type=Number(connector?.type||0);
    if(type===2)return 'AC';
    if(type===1)return 'DC';
    return Number(connector?.maxPowerKw||0)<=22.5?'AC':'DC';
  }
  function powerdotDirectConfigurations(location){
    const groups=new Map(),powerVariants=new Map();
    for(const entry of location.chargers||[]){
      const chargerName=text(entry?.chargerName)||text(entry?.charger?.chargerName);
      for(const connector of entry?.charger?.connectors||[]){
        const power=Number(connector?.maxPowerKw),kind=powerdotConnectorKind(connector),pricing=powerdotPricing(connector?.tariff);
        if(!(power>0)||!pricing.rules.length||!pricing.rules.some(rule=>Number(rule.pricePerKwh)>0||Number(rule.chargePerMinute)>0||Number(rule.connectionFee)>0||Number(rule.idlePerMinute)>0||Number(rule.afterMinutesRate)>0))continue;
        const powerKey=`${kind}|${power.toFixed(3)}`,signature=pricingSignature(pricing),key=`${powerKey}|${signature}`;
        if(!groups.has(key))groups.set(key,{kind,power,pricing,connectors:[],chargerNames:new Set(),irvePdcIds:new Set(),tariffIds:new Set()});
        const group=groups.get(key);group.connectors.push(connector);if(chargerName)group.chargerNames.add(chargerName);
        for(const id of entry.irvePdcIds||[])group.irvePdcIds.add(id);
        if(connector?.tariff?.id)group.tariffIds.add(connector.tariff.id);
        if(!powerVariants.has(powerKey))powerVariants.set(powerKey,new Set());powerVariants.get(powerKey).add(signature);
      }
    }
    return [...groups.values()].map((group,index)=>{
      const refs=[...new Set(group.connectors.map(connector=>text(connector.physicalReference)||String(connector.connectorNumber||'')).filter(Boolean))];
      const powerKey=`${group.kind}|${group.power.toFixed(3)}`;
      const provider=powerVariants.get(powerKey)?.size>1&&refs.length?`Powerdot direct (bornes ${refs.join(', ')})`:'Powerdot direct';
      return {id:`powerdot-direct-${location.id}-${index}`,label:`${provider} · ${group.kind} ${group.power} kW`,kind:group.kind,powerKw:group.power,stalls:group.connectors.length,pricing:group.pricing,offerProvider:provider,offerType:'operator_direct',powerdotDirect:true,powerdotVerified:true,powerdotLocationId:location.id,powerdotLocationUid:location.uid,powerdotChargerNames:[...group.chargerNames],powerdotIrvePdcIds:[...group.irvePdcIds],powerdotTariffIds:[...group.tariffIds],powerdotPhysicalReferences:refs};
    });
  }
  function mergedPowerdotStation(location,data,matches=[]){
    const direct=powerdotDirectConfigurations(location);
    const existing=matches.flatMap(station=>station.chargingConfigurations||[]);
    const configurations=mergeConfigurations([...direct,...existing]);
    const first=direct[0]||configurations[0]||{kind:'DC',powerKw:50,pricing:{type:'rules',rules:[]}};
    const base=matches.length?{...primaryStation(matches)}:{id:`france-catalog:powerdot:${location.id}`,catalogStationId:`powerdot:${location.id}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la base tarifaire Powerdot — accès à vérifier.'}};
    const directConnectorCount=direct.reduce((sum,config)=>sum+Number(config.stalls||0),0);
    const merged={...base,name:location.name||base.name,address:[location.address,location.zipcode,location.city].filter(Boolean).join(', ')||base.address,latitude:Number(location.latitude),longitude:Number(location.longitude),operator:'Powerdot',stalls:directConnectorCount,kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,lastUpdated:String(data.generatedAt||'').slice(0,10),powerdotStrictCpo:true,powerdotDirectPricingContext:'adhoc_emsp_empty',powerdotLocationId:location.id,powerdotLocationUid:location.uid,powerdotIrvePdcIds:[...location.irvePdcIds],powerdotSourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),powerdotStatusJoinedExternally:matches.length>0,powerdotDirectConnectorCount:directConnectorCount};
    return mergeStatus(merged,matches);
  }
  function mergePowerdotCatalog(catalog,data,origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.chargers)||!data.chargers.length)return catalog;
    const allLocations=powerdotLocations(data).filter(location=>powerdotDirectConfigurations(location).length>0);
    const locations=allLocations.filter(location=>!(radiusKm>0)||geoDistanceKm(origin.lat,origin.lon,location.latitude,location.longitude)<=radiusKm+.10);
    const assignments=new Map(),consumed=new Set();
    for(let index=0;index<catalog.length;index++){
      const station=catalog[index];
      if(!isPowerdotOperator(station)||!Number.isFinite(Number(station.latitude))||!Number.isFinite(Number(station.longitude)))continue;
      let best=null;
      for(const location of locations){const distance=geoDistanceKm(station.latitude,station.longitude,location.latitude,location.longitude);if(distance<=.08+1e-9&&(!best||distance<best.distance))best={location,distance};}
      if(!best)continue;
      if(!assignments.has(best.location.id))assignments.set(best.location.id,[]);
      assignments.get(best.location.id).push({index,station});consumed.add(index);
    }
    let matched=0,added=0,collapsed=0,directConnectors=0;
    const merged=locations.map(location=>{const matches=assignments.get(location.id)||[];if(matches.length){matched++;collapsed+=Math.max(0,matches.length-1);}else added++;const station=mergedPowerdotStation(location,data,matches.map(match=>match.station));directConnectors+=Number(station.powerdotDirectConnectorCount||0);return station;});
    const output=[...catalog.filter((_,index)=>!consumed.has(index)),...merged];
    window.TCC_POWERDOT_MERGE_STATS={sourceChargers:data.chargers.length,directLocations:allLocations.length,inAreaLocations:locations.length,matched,added,collapsedSourceDuplicates:collapsed,directConnectors,unresolvedIrveStations:Number(data?.counts?.uniqueIrveStations||0)-Number(data?.counts?.coveredIrveStations||0),outputStations:output.length};
    return output;
  }

'''
anchor='  async function rowsNear(lat,lon,radiusKm){'
if 'function mergePowerdotCatalog(' not in s:
    assert anchor in s,'Ancre rowsNear absente'
    s=s.replace(anchor,block+anchor,1)

old="    const [rows,statuses,e55c,belib,belibLive,ionity,atlante]=await Promise.all([rowsNear(origin.lat,origin.lon,Number(maxDistanceKm)||0),loadStatusSnapshot(),loadE55cCatalog(),loadBelibCatalog(),loadBelibLive(),loadIonityCatalog(),loadAtlanteCatalog()]);"
if 'loadAtlanteCatalog(),loadPowerdotCatalog()' not in s:
    assert old in s,'Ancre Promise.all absente'
    s=s.replace(old,"    const [rows,statuses,e55c,belib,belibLive,ionity,atlante,powerdot]=await Promise.all([rowsNear(origin.lat,origin.lon,Number(maxDistanceKm)||0),loadStatusSnapshot(),loadE55cCatalog(),loadBelibCatalog(),loadBelibLive(),loadIonityCatalog(),loadAtlanteCatalog(),loadPowerdotCatalog()]);",1)

old="    const catalog=mergeAtlanteCatalog(ionityCatalog,atlante,origin,Number(maxDistanceKm)||0);"
if 'const catalog=mergePowerdotCatalog(' not in s:
    assert old in s,'Ancre merge Atlante absente'
    s=s.replace(old,"    const atlanteCatalog=mergeAtlanteCatalog(ionityCatalog,atlante,origin,Number(maxDistanceKm)||0);\n    const catalog=mergePowerdotCatalog(atlanteCatalog,powerdot,origin,Number(maxDistanceKm)||0);",1)

old="        result.atlanteMergeStats={...(window.TCC_ATLANTE_MERGE_STATS||{})};"
if 'result.powerdotDirectCatalogLoaded=true' not in s:
    assert old in s,'Ancre stats Atlante absente'
    s=s.replace(old,old+"\n        result.powerdotDirectCatalogLoaded=true;\n        result.powerdotMergeStats={...(window.TCC_POWERDOT_MERGE_STATS||{})};",1)

old="  window.TCCFranceCatalog={loadManifest,loadStatusSnapshot,loadE55cCatalog,loadBelibCatalog,loadBelibLive,loadIonityCatalog,loadAtlanteCatalog,clearCache(){rawCache.clear();manifestPromise=null;statusPromise=null;e55cPromise=null;belibPromise=null;belibLivePromise=null;belibLiveLoadedAt=0;ionityPromise=null;atlantePromise=null;},get cachedFragments(){return rawCache.size;}};"
if 'loadAtlanteCatalog,loadPowerdotCatalog' not in s:
    assert old in s,'Ancre TCCFranceCatalog absente'
    s=s.replace(old,"  window.TCCFranceCatalog={loadManifest,loadStatusSnapshot,loadE55cCatalog,loadBelibCatalog,loadBelibLive,loadIonityCatalog,loadAtlanteCatalog,loadPowerdotCatalog,clearCache(){rawCache.clear();manifestPromise=null;statusPromise=null;e55cPromise=null;belibPromise=null;belibLivePromise=null;belibLiveLoadedAt=0;ionityPromise=null;atlantePromise=null;powerdotPromise=null;},get cachedFragments(){return rawCache.size;}};",1)

old="  window.TCCFranceCatalogV8={stationFromRow,mergeE55cCatalog,mergedE55cStation,directConfigurations,isE55cOperator,mergeBelibCatalog,mergedBelibStation,directBelibConfigurations,isBelibOperator,belibLiveStatus,mergeIonityCatalog,mergedIonityStation,ionityDirectConfigurations,isIonityOperator,mergeAtlanteCatalog,mergedAtlanteStation,atlanteDirectConfigurations,isAtlanteOperator,geoDistanceKm};"
if 'mergePowerdotCatalog,mergedPowerdotStation' not in s:
    assert old in s,'Ancre TCCFranceCatalogV8 absente'
    s=s.replace(old,"  window.TCCFranceCatalogV8={stationFromRow,mergeE55cCatalog,mergedE55cStation,directConfigurations,isE55cOperator,mergeBelibCatalog,mergedBelibStation,directBelibConfigurations,isBelibOperator,belibLiveStatus,mergeIonityCatalog,mergedIonityStation,ionityDirectConfigurations,isIonityOperator,mergeAtlanteCatalog,mergedAtlanteStation,atlanteDirectConfigurations,isAtlanteOperator,mergePowerdotCatalog,mergedPowerdotStation,powerdotDirectConfigurations,powerdotLocations,powerdotPricing,isPowerdotOperator,geoDistanceKm};",1)

old="  console.info('[TCC V8] Catalogue national France enrichi des stations et tarifs directs E55C + Belib’ (parking exclu) + IONITY + Atlante.');"
if old in s:s=s.replace(old,"  console.info('[TCC V8] Catalogue national France enrichi des stations et tarifs directs E55C + Belib’ (parking exclu) + IONITY + Atlante + Powerdot.');",1)
CATALOG.write_text(s,encoding='utf-8')

TEST.write_text(r'''import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
function assert(condition,message){if(!condition)throw new Error(message);}
const code=fs.readFileSync('assets/france-catalog-v8.js','utf8');
const powerdot=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/powerdot_direct_france.json.gz')).toString('utf8'));
const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/non_tesla_france/all.json.gz')).toString('utf8'));
const sandbox={console,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},fetch:async()=>{throw new Error('fetch interdit dans le test unitaire');},document:{getElementById:()=>null},localStorage:{getItem:()=>null},candidateStations:async()=>({stations:[]}),resolveOrigin:async()=>({lat:48.81,lon:2.07,label:'test'}),stations:[],window:null};
sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(code,sandbox);
const api=sandbox.TCCFranceCatalogV8;assert(api,'API catalogue France V8 absente');
assert(powerdot.dataset==='powerdot-direct-cpo-france','Dataset Powerdot inattendu');
assert(powerdot.source?.pricingContext==='direct CPO / adhoc / emspCode empty','Contexte CPO Powerdot invalide');
const locations=api.powerdotLocations(powerdot).filter(location=>api.powerdotDirectConfigurations(location).length>0);
const catalog=rows.map(row=>api.stationFromRow(row,1));
const nonPowerdotBefore=catalog.filter(station=>!api.isPowerdotOperator(station)).length;
const merged=api.mergePowerdotCatalog(catalog,powerdot,{lat:0,lon:0},0);
const strict=merged.filter(station=>station.powerdotStrictCpo===true),stats=sandbox.TCC_POWERDOT_MERGE_STATS;
assert(strict.length===locations.length,`Stations Powerdot directes intégrées : ${strict.length}/${locations.length}`);
assert(new Set(strict.map(station=>station.powerdotLocationId)).size===strict.length,'Location Powerdot dupliquée');
assert(strict.every(station=>station.operator==='Powerdot'&&station.powerdotDirectPricingContext==='adhoc_emsp_empty'),'Station hors périmètre Powerdot direct');
assert(merged.filter(station=>!api.isPowerdotOperator(station)).length===nonPowerdotBefore,'Une station non-Powerdot a été modifiée ou supprimée');
let directConnectors=0;
for(const station of strict){const direct=(station.chargingConfigurations||[]).filter(config=>config.powerdotDirect);assert(direct.length>0,`Tarif Powerdot direct absent : ${station.name}`);assert(direct.every(config=>config.powerdotVerified&&config.offerType==='operator_direct'),'Offre Powerdot directe non vérifiée');assert(!direct.some(config=>/electroverse|chargemap|miio|leasing social/i.test(`${config.offerProvider} ${config.label}`)),'Tarif itinérance/conditionnel injecté');directConnectors+=direct.reduce((sum,config)=>sum+Number(config.stalls||0),0);}
assert(directConnectors===powerdot.counts.pricedConnectors,`Connecteurs directs : ${directConnectors}/${powerdot.counts.pricedConnectors}`);
assert(stats.directConnectors===powerdot.counts.pricedConnectors,'Stats connecteurs Powerdot incohérentes');
const champniers=strict.find(station=>/mr\. bricolage - champniers/i.test(station.name));assert(champniers,'Champniers absent');
const champPrices=(champniers.chargingConfigurations||[]).filter(config=>config.powerdotDirect).map(config=>config.pricing?.rules?.[0]);assert(champPrices.some(rule=>Number(rule.pricePerKwh)===.47),'Champniers AC != 0,47');assert(champPrices.some(rule=>Number(rule.pricePerKwh)===.59),'Champniers DC != 0,59');
const firstGrill=strict.find(station=>/first grill 45/i.test(station.name));assert(firstGrill,'First Grill 45 absent');
const fees=(firstGrill.chargingConfigurations||[]).filter(config=>config.powerdotDirect).map(config=>({power:Number(config.powerKw),rule:config.pricing?.rules?.[0]}));assert(fees.some(x=>x.power===160&&Number(x.rule?.afterMinutesRate)===.05&&Number(x.rule?.afterMinutesThreshold)===30),'First Grill 160 kW invalide');assert(fees.some(x=>x.power===50&&Number(x.rule?.afterMinutesRate)===.05&&Number(x.rule?.afterMinutesThreshold)===60),'First Grill 50 kW invalide');assert(fees.some(x=>x.power===22&&Number(x.rule?.afterMinutesRate)===.04&&Number(x.rule?.afterMinutesThreshold)===120),'First Grill 22 kW invalide');
console.log(JSON.stringify({strictLocations:strict.length,matched:stats.matched,added:stats.added,directConnectors,unresolvedIrveStations:stats.unresolvedIrveStations},null,2));
''',encoding='utf-8')

SYNC.write_text('''name: Synchroniser Powerdot Direct dans TCC V8

on:
  schedule:
    - cron: "37 11 * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: sync-powerdot-direct-v8
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Récupérer TCC
        uses: actions/checkout@v4
        with:
          ref: main
      - name: Télécharger la base Powerdot directe vérifiée
        run: |
          curl --fail --location --retry 4 --retry-delay 5 \\
            --output data/powerdot_direct_france.json.gz \\
            https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/national/powerdot_direct_france.json.gz
      - name: Valider le périmètre et les prix directs
        run: |
          node scripts/test_powerdot_v8_runtime.mjs
          node --check assets/france-catalog-v8.js
      - name: Publier uniquement en cas de changement
        shell: bash
        run: |
          if git diff --quiet -- data/powerdot_direct_france.json.gz; then
            echo "Aucun changement Powerdot Direct à publier."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/powerdot_direct_france.json.gz
          git commit -m "data(powerdot): refresh V8 Direct France station tariffs"
          git push origin HEAD:main
''',encoding='utf-8')

p=PAGES.read_text(encoding='utf-8')
atl="          cp site/data/atlante_direct_stations_france.json.gz site/v8-preview/data/atlante_direct_stations_france.json.gz\n"
pd="          cp site/data/powerdot_direct_france.json.gz site/v8-preview/data/powerdot_direct_france.json.gz\n"
if pd not in p:
    assert atl in p,'Copie Atlante absente de Pages'
    p=p.replace(atl,atl+pd,1)
test="          (cd site && node scripts/test_atlante_v8_runtime.mjs)\n"
pdtest="          (cd site && node scripts/test_powerdot_v8_runtime.mjs)\n"
if pdtest not in p:
    assert test in p,'Test Atlante absent de Pages'
    p=p.replace(test,test+pdtest,1)
p=p.replace('france-catalog.js?v=rc48-atlante-20260824','france-catalog.js?v=rc48-powerdot-20260826')
PAGES.write_text(p,encoding='utf-8')
print('Powerdot V8 patch applied')
