#!/usr/bin/env python3
from pathlib import Path
import argparse

PARSER_JS = r'''
  async function loadEtotemCatalog(){
    if(!etotemPromise)etotemPromise=readStandaloneGzip(ETOTEM_URL,'e-Totem').then(data=>{
      if(data?.scope?.physicalCpoDirectOnly!==true||data?.scope?.roamingIncluded!==false||data?.scope?.noGuessedFallback!==true)throw new Error('Périmètre e-Totem direct invalide');
      if(!Array.isArray(data?.stations)||Number(data?.counts?.inventoryStations)!==data.stations.length||data.stations.length<600)throw new Error('Inventaire e-Totem incomplet');
      if(Number(data?.counts?.resolvedStations)<500||Number(data?.counts?.resolvedWithTariffText)<450)throw new Error('Couverture tarifaire e-Totem insuffisante');
      if(data.stations.some(record=>record?.resolved&&(String(record?.api?.bOcpi??0)!=='0'||String(record?.api?.bGireve??0)!=='0'||String(record?.api?.bItinerance??0)!=='0')))throw new Error('Station e-Totem itinérante présente dans la base directe');
      window.TCC_ETOTEM_DIRECT_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base e-Totem directe ignorée :',error?.message||error);
      return {stations:[],counts:{},coverageByFamily:{}};
    });
    return etotemPromise;
  }
'''

MERGE_JS = r'''
  function isEtotemOperator(station){
    const value=norm(station?.operator);
    return value.includes('e totem')||value.includes('etotem')||value==='semob'||value.includes('saint etienne metropole');
  }
  function etotemNormTariff(value){return text(value).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
  function etotemNumber(value){const n=Number(String(value||'').replace(',','.'));return Number.isFinite(n)?n:null;}
  function etotemSections(value){
    const source=etotemNormTariff(value),marks=[];
    for(const match of source.matchAll(/(?:^|[\n;])\s*(AC|DC)\s*(?=[:\-–—]|\d|\s)/gi))marks.push({kind:match[1].toUpperCase(),index:match.index+(match[0].length-match[0].trimStart().length)});
    if(!marks.length){for(const match of source.matchAll(/\b(AC|DC)\b\s*[:\-–—]/gi))marks.push({kind:match[1].toUpperCase(),index:match.index});}
    marks.sort((a,b)=>a.index-b.index);const out={};
    for(let i=0;i<marks.length;i++){const mark=marks[i],end=marks[i+1]?.index??source.length;if(!out[mark.kind])out[mark.kind]=source.slice(mark.index,end).trim();}
    return {source,...out};
  }
  function etotemPriceCandidates(segment){
    const s=etotemNormTariff(segment),items=[];
    for(const match of s.matchAll(/(\d+(?:[.,]\d+)?)\s*€\s*(?:\/|par)?\s*kwh/gi)){
      const price=etotemNumber(match[1]);if(!(price>0))continue;
      const before=s.slice(Math.max(0,match.index-130),match.index),after=s.slice(match.index+match[0].length,Math.min(s.length,match.index+match[0].length+50));
      const context=(before+' '+after).toLowerCase();
      const eco=/\b(?:mode|tarif|offre)?\s*eco\b/.test(before.slice(-70).toLowerCase());
      let min=null,max=null;
      const ranges=[...(before.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|à|a)\s*(\d+(?:[.,]\d+)?)\s*kw/gi))];
      if(ranges.length){const r=ranges.at(-1);min=etotemNumber(r[1]);max=etotemNumber(r[2]);}
      if(min==null){const upto=[...(before.matchAll(/jusqu(?:'|’|\s)*(?:a|à)?\s*(\d+(?:[.,]\d+)?)\s*kw/gi))];if(upto.length){min=0;max=etotemNumber(upto.at(-1)[1]);}}
      if(min==null){const single=[...(before.matchAll(/(\d+(?:[.,]\d+)?)\s*kw/gi))];if(single.length){const p=etotemNumber(single.at(-1)[1]);if(p!=null){min=Math.max(0,p-.6);max=p+.6;}}}
      items.push({price,eco,minKw:min,maxKw:max,context});
    }
    return items;
  }
  function etotemDefaultEnergyPrice(record,kind,powerKw){
    const sections=etotemSections(record?.tariffText||''),segment=sections[kind]||sections.source;
    let candidates=etotemPriceCandidates(segment).filter(item=>!item.eco);
    if(!candidates.length&&segment!==sections.source)candidates=etotemPriceCandidates(sections.source).filter(item=>!item.eco);
    if(!candidates.length)return null;
    const powerMatches=candidates.filter(item=>item.minKw!=null&&item.maxKw!=null&&powerKw>=item.minKw-1e-9&&powerKw<=item.maxKw+1e-9);
    if(powerMatches.length===1)return powerMatches[0].price;
    const unbounded=candidates.filter(item=>item.minKw==null&&item.maxKw==null);
    const unique=[...new Set(unbounded.map(item=>item.price.toFixed(6)))];
    if(unique.length===1)return Number(unique[0]);
    if(candidates.length===1)return candidates[0].price;
    return null;
  }
  function etotemPostChargePolicy(record,kind){
    const sections=etotemSections(record?.tariffText||''),segment=sections[kind]||sections.source,lower=segment.toLowerCase();
    if(/sans[^.;]{0,40}post[- ]charge/.test(lower))return {idlePerMinute:0,idleGraceMinutes:0,idleCap:0,idleCapStart:'00:00',idleCapEnd:'24:00'};
    if(!/(?:post[- ]charge|une fois[^.;]{0,45}v[eé]hicule[^.;]{0,30}(?:charg[eé]|recharg[eé])|apr[eè]s[^.;]{0,30}(?:fin de )?charge)/i.test(segment))return {idlePerMinute:0,idleGraceMinutes:0,idleCap:0,idleCapStart:'00:00',idleCapEnd:'24:00'};
    const graceMatch=segment.match(/(\d+)\s*min(?:ute)?s?\s+gratuite?s?/i);const grace=graceMatch?Number(graceMatch[1]):0;
    const fees=[...segment.matchAll(/(\d+(?:[.,]\d+)?)\s*€\s*(?:\/|par\s+(?:tranche[^0-9]{0,25})?)\s*(\d+)\s*min/gi)].map(m=>({eur:etotemNumber(m[1]),minutes:Number(m[2])})).filter(x=>x.eur>=0&&x.minutes>0);
    const unique=[...new Map(fees.map(x=>[`${x.eur}|${x.minutes}`,x])).values()];
    const rate=unique.length===1?unique[0].eur/unique[0].minutes:0;
    let idleCap=0,idleCapStart='00:00',idleCapEnd='24:00';
    const cap=segment.match(/plafonn?[eé][^0-9]{0,12}(\d+(?:[.,]\d+)?)\s*€(?:[^0-9]{0,25}(\d{1,2})h(?:\d{2})?[^0-9]{0,15}(\d{1,2})h(?:\d{2})?)?/i);
    if(cap){idleCap=etotemNumber(cap[1])||0;if(cap[2]&&cap[3]){idleCapStart=`${cap[2].padStart(2,'0')}:00`;idleCapEnd=`${cap[3].padStart(2,'0')}:00`;}}
    return {idlePerMinute:rate,idleGraceMinutes:grace,idleCap,idleCapStart,idleCapEnd};
  }
  function etotemPdcGroups(record){
    const groups=new Map();
    for(const pdc of record?.pdcs||[]){
      const connectors=(pdc?.connectors||[]).map(x=>text(x).toUpperCase());const power=Number(pdc?.powerKw||0);if(!(power>0))continue;
      const kind=connectors.some(x=>x.includes('CCS')||x.includes('CHADEMO'))?'DC':'AC';const key=`${kind}|${power.toFixed(3)}`;
      if(!groups.has(key))groups.set(key,{kind,power,stalls:0,pdcIds:[]});const group=groups.get(key);group.stalls++;if(pdc?.id)group.pdcIds.push(pdc.id);
    }
    return [...groups.values()];
  }
  function etotemDirectConfigurations(record){
    return etotemPdcGroups(record).map((group,index)=>{
      const price=etotemDefaultEnergyPrice(record,group.kind,group.power),post=etotemPostChargePolicy(record,group.kind),verified=price!=null;
      const rule=verified?{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:price,chargePerMinute:0,connectionFee:0,idlePerMinute:Number(post.idlePerMinute||0),idleGraceMinutes:Number(post.idleGraceMinutes||0),idleCap:Number(post.idleCap||0),idleCapStart:post.idleCapStart||'00:00',idleCapEnd:post.idleCapEnd||'24:00',afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'}:null;
      const provider=verified?'e-Totem direct':'e-Totem direct (tarif non structuré)';
      return {id:`etotem-direct-${record.stationId}-${index}`,label:`${provider} · ${group.kind} ${group.power} kW`,kind:group.kind,powerKw:group.power,stalls:group.stalls,pricing:{type:'rules',rules:rule?[rule]:[]},offerProvider:provider,offerType:'operator_direct',etotemDirect:true,etotemVerified:verified,etotemStationId:record.stationId,etotemApiStationId:record?.api?.sIdPool||'',etotemNetwork:record?.api?.sNomReseau||'',etotemPdcIds:[...group.pdcIds],etotemTariffText:record.tariffText||'',etotemMatchMethod:record.matchMethod||'',etotemMatchDistanceM:Number(record.matchDistanceM||0)};
    });
  }
  function etotemNameScore(record,station){
    const a=norm(record?.name),b=norm(station?.name);if(!a||!b)return 0;const words=[...new Set(a.split(' ').filter(w=>w.length>=4&&!['totem','borne','station','recharge'].includes(w)))];return words.filter(w=>b.includes(w)).length;
  }
  function mergedEtotemStation(record,data,matches=[]){
    const direct=etotemDirectConfigurations(record),existing=matches.flatMap(station=>station.chargingConfigurations||[]),configurations=mergeConfigurations([...direct,...existing]);
    const first=direct.find(config=>config.etotemVerified)||configurations[0]||{kind:Number(record.maxPowerKw)>22.5?'DC':'AC',powerKw:Number(record.maxPowerKw||11),pricing:{type:'rules',rules:[]}};
    const base=matches.length?{...primaryStation(matches)}:{id:`france-catalog:etotem:${record.stationId}`,catalogStationId:`etotem:${record.stationId}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires e-Totem à vérifier sur la fiche de la station.'}};
    const verifiedCount=direct.filter(config=>config.etotemVerified).reduce((sum,config)=>sum+Number(config.stalls||0),0);
    const merged={...base,name:record.name||base.name,address:record.address||base.address,latitude:Number(record.latitude),longitude:Number(record.longitude),operator:'e-Totem',stalls:Number(record.pdcCount||0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,lastUpdated:String(data.generatedAt||'').slice(0,10),etotemStrictCpo:true,etotemStationId:record.stationId,etotemApiStationId:record?.api?.sIdPool||'',etotemNetwork:record?.api?.sNomReseau||'',etotemSourceCatalogStationIds:matches.map(station=>station.catalogStationId).filter(Boolean),etotemStatusJoinedExternally:matches.length>0,etotemResolved:true,etotemDirectCalculatedPoints:verifiedCount,etotemDirectUnparsedPoints:Math.max(0,Number(record.pdcCount||0)-verifiedCount),etotemRawTariffText:record.tariffText||''};
    return mergeStatus(merged,matches);
  }
  function mergeEtotemCatalog(catalog,data,origin={lat:0,lon:0},radiusKm=0){
    if(!Array.isArray(data?.stations)||!data.stations.length)return catalog;
    const records=data.stations.filter(record=>record?.resolved&&record?.tariffText&&Number.isFinite(Number(record.latitude))&&Number.isFinite(Number(record.longitude))&&(!(radiusKm>0)||geoDistanceKm(origin.lat,origin.lon,record.latitude,record.longitude)<=radiusKm+.12));
    const assignments=new Map(),consumed=new Set();
    for(const record of records){
      const candidates=[];
      for(let index=0;index<catalog.length;index++){
        if(consumed.has(index))continue;const station=catalog[index];if(!Number.isFinite(Number(station.latitude))||!Number.isFinite(Number(station.longitude)))continue;
        const distance=geoDistanceKm(record.latitude,record.longitude,station.latitude,station.longitude);if(distance>.08+1e-9)continue;
        const operatorLike=isEtotemOperator(station),nameScore=etotemNameScore(record,station);if(!operatorLike&&distance>.02&&nameScore<2)continue;
        candidates.push({index,station,distance,operatorLike,nameScore});
      }
      candidates.sort((a,b)=>(Number(b.operatorLike)-Number(a.operatorLike))||(b.nameScore-a.nameScore)||(a.distance-b.distance));
      if(candidates.length){const best=candidates[0];if(best.operatorLike||best.nameScore>=2||best.distance<=.012){assignments.set(record.stationId,[best.station]);consumed.add(best.index);}}
    }
    let matched=0,added=0,directCalculatedPoints=0,directUnparsedPoints=0;
    const merged=records.map(record=>{const matches=assignments.get(record.stationId)||[];if(matches.length)matched++;else added++;const station=mergedEtotemStation(record,data,matches);directCalculatedPoints+=Number(station.etotemDirectCalculatedPoints||0);directUnparsedPoints+=Number(station.etotemDirectUnparsedPoints||0);return station;});
    const output=[...catalog.filter((_,index)=>!consumed.has(index)),...merged];
    window.TCC_ETOTEM_MERGE_STATS={inventoryStations:Number(data?.counts?.inventoryStations||0),resolvedStations:Number(data?.counts?.resolvedStations||0),resolvedWithTariffText:Number(data?.counts?.resolvedWithTariffText||0),inAreaStations:records.length,matched,added,directCalculatedPoints,directUnparsedPoints,coverageByFamily:data?.coverageByFamily||{},outputStations:output.length};
    return output;
  }
'''


def replace_once(text, old, new, label):
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f'Missing anchor for {label}')
    return text.replace(old, new, 1)


def patch_main(path: Path):
    s=path.read_text(encoding='utf-8')
    s=replace_once(s,
        "  const POWERDOT_URL='../data/powerdot_direct_france.json.gz';",
        "  const POWERDOT_URL='../data/powerdot_direct_france.json.gz';\n  const ETOTEM_URL='../data/etotem_direct_tariffs_france.json.gz';",
        'ETOTEM_URL')
    s=replace_once(s,
        '  let manifestPromise=null,statusPromise=null,e55cPromise=null,belibPromise=null,belibLivePromise=null,belibLiveLoadedAt=0,ionityPromise=null,atlantePromise=null,powerdotPromise=null;',
        '  let manifestPromise=null,statusPromise=null,e55cPromise=null,belibPromise=null,belibLivePromise=null,belibLiveLoadedAt=0,ionityPromise=null,atlantePromise=null,powerdotPromise=null,etotemPromise=null;',
        'etotemPromise')
    if 'async function loadEtotemCatalog()' not in s:
        s=replace_once(s,'  async function readGzipJson(file,version=\'\'){',PARSER_JS+'\n  async function readGzipJson(file,version=\'\'){','loader insertion')
    if 'function mergeEtotemCatalog(' not in s:
        s=replace_once(s,'  async function rowsNear(lat,lon,radiusKm){',MERGE_JS+'\n  async function rowsNear(lat,lon,radiusKm){','merge insertion')
    s=replace_once(s,
        'i:Number(rule.idlePerMinute||0),\n      ar:Number(rule.afterMinutesRate||0)',
        "i:Number(rule.idlePerMinute||0),ig:Number(rule.idleGraceMinutes||0),ic:Number(rule.idleCap||0),ics:rule.idleCapStart||'',ice:rule.idleCapEnd||'',\n      ar:Number(rule.afterMinutesRate||0)",
        'pricing signature idle fields')
    s=replace_once(s,
        'const [rows,statuses,e55c,belib,belibLive,ionity,atlante,powerdot]=await Promise.all([rowsNear(origin.lat,origin.lon,Number(maxDistanceKm)||0),loadStatusSnapshot(),loadE55cCatalog(),loadBelibCatalog(),loadBelibLive(),loadIonityCatalog(),loadAtlanteCatalog(),loadPowerdotCatalog()]);',
        'const [rows,statuses,e55c,belib,belibLive,ionity,atlante,powerdot,etotem]=await Promise.all([rowsNear(origin.lat,origin.lon,Number(maxDistanceKm)||0),loadStatusSnapshot(),loadE55cCatalog(),loadBelibCatalog(),loadBelibLive(),loadIonityCatalog(),loadAtlanteCatalog(),loadPowerdotCatalog(),loadEtotemCatalog()]);',
        'Promise.all e-Totem')
    s=replace_once(s,
        '    const catalog=mergePowerdotCatalog(atlanteCatalog,powerdot,origin,Number(maxDistanceKm)||0);',
        '    const powerdotCatalog=mergePowerdotCatalog(atlanteCatalog,powerdot,origin,Number(maxDistanceKm)||0);\n    const catalog=mergeEtotemCatalog(powerdotCatalog,etotem,origin,Number(maxDistanceKm)||0);',
        'catalog merge e-Totem')
    s=replace_once(s,
        "        result.powerdotMergeStats={...(window.TCC_POWERDOT_MERGE_STATS||{})};",
        "        result.powerdotMergeStats={...(window.TCC_POWERDOT_MERGE_STATS||{})};\n        result.etotemDirectCatalogLoaded=true;\n        result.etotemMergeStats={...(window.TCC_ETOTEM_MERGE_STATS||{})};",
        'result metadata')
    s=replace_once(s,
        'loadIonityCatalog,loadAtlanteCatalog,loadPowerdotCatalog,clearCache()',
        'loadIonityCatalog,loadAtlanteCatalog,loadPowerdotCatalog,loadEtotemCatalog,clearCache()',
        'TCCFranceCatalog export')
    s=replace_once(s,
        'powerdotPromise=null;},get cachedFragments',
        'powerdotPromise=null;etotemPromise=null;},get cachedFragments',
        'clear cache e-Totem')
    s=replace_once(s,
        'powerdotPricing,isPowerdotOperator,geoDistanceKm};',
        'powerdotPricing,isPowerdotOperator,mergeEtotemCatalog,mergedEtotemStation,etotemDirectConfigurations,etotemDefaultEnergyPrice,etotemPostChargePolicy,isEtotemOperator,geoDistanceKm};',
        'V8 export e-Totem')
    s=s.replace("E55C + Belib’ (parking exclu) + IONITY + Atlante + Powerdot.","E55C + Belib’ (parking exclu) + IONITY + Atlante + Powerdot + e-Totem direct.")
    s=s.replace('catalogue national France enrichi E55C + Belib\' + IONITY + Atlante + Powerdot.','catalogue national France enrichi E55C + Belib\' + IONITY + Atlante + Powerdot + e-Totem.')
    path.write_text(s,encoding='utf-8')


def patch_app(path: Path):
    s=path.read_text(encoding='utf-8')
    old="""   let occupied=unplugDurationMinutes(startTime,chargeMinutes,unplugTime);\n   for(let i=Math.ceil(chargeMinutes);i<Math.ceil(occupied);i++){\n     let rule=ruleForMinute(rules,minuteOfSession(startMin,i));if(!rule)continue;\n     let currency=(rule.currency||'EUR').toUpperCase();currencies.add(currency);\n     idleCost+=fxToEur(rule.idlePerMinute||0,currency);\n   }\n"""
    new="""   let occupied=unplugDurationMinutes(startTime,chargeMinutes,unplugTime);\n   const idleByRule=new Map();\n   for(let i=Math.floor(chargeMinutes);i<Math.ceil(occupied);i++){\n     let rule=ruleForMinute(rules,minuteOfSession(startMin,i));if(!rule)continue;\n     let currency=(rule.currency||'EUR').toUpperCase();currencies.add(currency);\n     let rate=Math.max(0,Number(rule.idlePerMinute||0)),grace=Math.max(0,Number(rule.idleGraceMinutes||0));if(!(rate>0))continue;\n     let eligibleStart=chargeMinutes+grace,from=Math.max(i,eligibleStart),to=Math.min(i+1,occupied),fraction=Math.max(0,to-from);if(!(fraction>0))continue;\n     let entry=idleByRule.get(rule)||{regular:0,capped:0};\n     let cap=Math.max(0,Number(rule.idleCap||0)),capStart=rule.idleCapStart||'00:00',capEnd=rule.idleCapEnd||'24:00';\n     let inCapWindow=cap>0&&minutesInWindow(minuteOfSession(startMin,from),Math.max(.001,fraction),capStart,capEnd)>0;\n     let amount=fxToEur(rate*fraction,currency);if(inCapWindow)entry.capped+=amount;else entry.regular+=amount;idleByRule.set(rule,entry);\n   }\n   for(const [rule,entry] of idleByRule.entries()){let capped=entry.capped,cap=Math.max(0,Number(rule.idleCap||0));if(cap>0)capped=Math.min(capped,fxToEur(cap,rule.currency||'EUR'));idleCost+=entry.regular+capped;}\n"""
    s=replace_once(s,old,new,'post-charge grace pricing')
    path.write_text(s,encoding='utf-8')


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--main-root',required=True);ap.add_argument('--rc-root',required=True);args=ap.parse_args()
    main_root=Path(args.main_root);rc_root=Path(args.rc_root)
    patch_main(main_root/'assets/france-catalog-v8.js')
    patch_app(rc_root/'assets/app.js')
    print('e-Totem runtime patch applied')

if __name__=='__main__':main()
