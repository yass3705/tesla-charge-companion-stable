(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.franceEmspCompact=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const uniq=values=>[...new Set((values||[]).map(text).filter(Boolean))];
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const normProvider=value=>text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const providerFromLabel=label=>{const s=text(label),i=s.indexOf('·');return(i>=0?s.slice(0,i):s).trim();};
  const providerKind=label=>{const p=normProvider(providerFromLabel(label));return p==='electroverse'?'electroverse':p==='electra'?'electra':'';};
  const pricingSignature=rows=>JSON.stringify((rows||[]).map(row=>[row?.[0]||'allDay',row?.[1]||'00:00',row?.[2]||'24:00',row?.[3]||'kwh',text(row?.[4]||'EUR').toUpperCase(),Number(row?.[5]||0),Number(row?.[6]||0),Number(row?.[7]||0),Number(row?.[8]||0),Number(row?.[9]||0),Number(row?.[10]||0),Array.isArray(row?.[11])?row[11]:null,Array.isArray(row?.[12])?row[12]:[]]));
  function pricingFromRows(rows){
    return{type:'rules',rules:(rows||[]).map(row=>({
      scope:row?.[0]||'allDay',start:row?.[1]||'00:00',end:row?.[2]||'24:00',billing:row?.[3]||'kwh',currency:text(row?.[4]||'EUR').toUpperCase(),
      pricePerKwh:Number(row?.[5]||0),chargePerMinute:Number(row?.[6]||0),connectionFee:Number(row?.[7]||0),idlePerMinute:Number(row?.[8]||0),
      afterMinutesRate:Number(row?.[9]||0),afterMinutesThreshold:Number(row?.[10]||0),days:Array.isArray(row?.[11])?clone(row[11]):null,
      ocpiDurationBands:Array.isArray(row?.[12])?clone(row[12]):[]
    }))};
  }
  function rowCandidates(row){
    if(!Array.isArray(row)||!row[0])return[];
    const stationId=text(row[0]),out=[];
    for(const [index,config] of (row[8]||[]).entries()){
      const provider=providerKind(config?.[1]);if(!provider)continue;
      const pdcIds=uniq(Array.isArray(config?.[6])?config[6]:[]);if(!pdcIds.length)continue;
      const pricingRows=Array.isArray(config?.[5])?config[5]:[];if(!pricingRows.length)continue;
      const kind=text(config?.[2]||'').toUpperCase();
      out.push({stationId,index,provider,pdcIds,kind,powerKw:Number(config?.[3]||0),stalls:Number(config?.[4]||0),pricingRows,signature:pricingSignature(pricingRows),configId:text(config?.[0]),label:text(config?.[1])});
    }
    return out;
  }
  function offerRulesFromRows(rows,source={}){
    const candidates=(rows||[]).flatMap(rowCandidates),ambiguousPdcs=new Set(),seen=new Map();
    for(const c of candidates){
      for(const pdcId of c.pdcIds){
        const key=`${c.provider}|${pdcId}`;if(!seen.has(key))seen.set(key,new Set());seen.get(key).add(c.signature);
      }
    }
    for(const [key,signatures] of seen)if(signatures.size>1)ambiguousPdcs.add(key);
    const rules=[];
    for(const c of candidates){
      const safePdcs=c.pdcIds.filter(id=>!ambiguousPdcs.has(`${c.provider}|${id}`));if(!safePdcs.length)continue;
      const provider=c.provider==='electroverse'?'Electroverse':'Electra';
      rules.push({
        id:`fr-emsp:${c.provider}:${c.stationId}:${c.configId||c.index}`,
        provider,offerKind:'roaming',subscriptionId:null,countries:['FR'],currency:text(c.pricingRows?.[0]?.[4]||'EUR').toUpperCase(),
        evseIds:safePdcs,connectorKinds:['AC','DC'].includes(c.kind)?[c.kind]:[],pricing:pricingFromRows(c.pricingRows),priority:Number(source?.priority?.tariff||80),
        metadata:{legacyDataset:'france-non-tesla-runtime',sourceStationId:c.stationId,sourceConfigId:c.configId,sourceLabel:c.label,verified:true,identityMode:'exact_irve_pdc',ambiguousPdcsSuppressed:c.pdcIds.length-safePdcs.length,stalls:c.stalls,powerKw:c.powerKw}
      });
    }
    return rules;
  }
  async function fetchJson(url,fetchImpl){
    const response=await fetchImpl(url,{cache:'no-cache'});if(!response.ok)throw new Error(`France eMSP resource unavailable (${response.status})`);
    if(!/\.gz(?:$|\?)/i.test(url))return response.json();
    const bytes=new Uint8Array(await response.arrayBuffer());let raw;
    if(bytes[0]===0x1f&&bytes[1]===0x8b){if(typeof DecompressionStream!=='function')throw new Error('gzip decompression unavailable');raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}
    else raw=new TextDecoder().decode(bytes);
    return JSON.parse(raw);
  }
  function intersects(tile,query={}){
    const origin=query.origin||{},lat=Number(origin.lat??origin.latitude),lon=Number(origin.lon??origin.longitude),radius=Number(query.radiusKm||query.maxDistanceKm||0);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||!(radius>0))return false;
    const dLat=radius/111.32,dLon=radius/(111.32*Math.max(.2,Math.cos(lat*Math.PI/180)));
    return Number(tile.maxLat)>=lat-dLat&&Number(tile.minLat)<=lat+dLat&&Number(tile.maxLon)>=lon-dLon&&Number(tile.minLon)<=lon+dLon;
  }
  function createLoader({base,manifestUrl,fetchImpl,source}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for France eMSP adapter');
    const root=String(base||'').replace(/\/$/,'')+'/',manifest=manifestUrl||`${root}manifest.json`;let manifestPromise=null;const cache=new Map();
    const load=url=>{if(!cache.has(url))cache.set(url,fetchJson(url,f).catch(e=>{cache.delete(url);throw e;}));return cache.get(url);};
    return async function(query={}){
      manifestPromise=manifestPromise||load(manifest);const m=await manifestPromise;
      const tiles=(m.tiles||[]).filter(tile=>intersects(tile,query));if(!tiles.length)return{offerRules:[],metadata:{adapter:'france-emsp-compact',tiles:0}};
      const payloads=await Promise.all(tiles.map(tile=>load(`${root}${tile.file}`))),rows=payloads.flatMap(x=>Array.isArray(x)?x:(x?.rows||x?.stations||[]));
      return{offerRules:offerRulesFromRows(rows,source||{}),metadata:{adapter:'france-emsp-compact',dataset:m.dataset||'france-non-tesla-runtime',generatedAt:m.generatedAt||null,tiles:tiles.length,rows:rows.length,mode:'exact-irve-pdc-only'}};
    };
  }
  return{providerFromLabel,providerKind,pricingFromRows,pricingSignature,rowCandidates,offerRulesFromRows,intersects,createLoader};
});