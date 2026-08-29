(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9BrowserLoaders=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const join=(base,path)=>`${String(base||'').replace(/\/$/,'')}/${String(path||'').replace(/^\//,'')}`;

  async function fetchJson(url,fetchImpl){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);
    if(!f)throw new Error('fetch unavailable');
    const res=await f(url,{cache:'no-cache'});
    if(!res.ok)throw new Error(`resource unavailable (${res.status}): ${url}`);
    if(!/\.gz(?:$|\?)/i.test(url))return res.json();
    if(typeof DecompressionStream==='undefined')throw new Error('gzip browser decompression unavailable');
    const stream=res.body.pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  function boundsFromQuery(query={}){
    const lat=num(query?.origin?.lat??query?.origin?.latitude),lon=num(query?.origin?.lon??query?.origin?.longitude);
    if(lat==null||lon==null)return null;
    const radius=Math.max(1,num(query.radiusKm)??num(query.maxDistanceKm)??20);
    const dLat=radius/111.32,dLon=radius/(111.32*Math.max(0.2,Math.cos(lat*Math.PI/180)));
    return{minLat:lat-dLat,maxLat:lat+dLat,minLon:lon-dLon,maxLon:lon+dLon};
  }
  function tileIntersects(tile,bounds){
    if(!bounds)return true;
    return Number(tile.maxLat)>=bounds.minLat&&Number(tile.minLat)<=bounds.maxLat&&Number(tile.maxLon)>=bounds.minLon&&Number(tile.minLon)<=bounds.maxLon;
  }
  function selectTiles(manifest,query={}){
    const tiles=Array.isArray(manifest?.tiles)?manifest.tiles:[];
    const bounds=boundsFromQuery(query);
    if(!bounds)return [];
    return tiles.filter(t=>tileIntersects(t,bounds));
  }

  function createNationalLoader({source,basePath='..',adapter,fetchImpl}={}){
    if(!source?.manifest||!source?.root)throw new Error('national source manifest/root missing');
    if(!adapter?.normalizeRow)throw new Error('national adapter missing');
    let manifestPromise=null;
    return async function(query={}){
      manifestPromise=manifestPromise||fetchJson(join(basePath,source.manifest),fetchImpl);
      const manifest=await manifestPromise;
      const tiles=selectTiles(manifest,query);
      const payloads=await Promise.all(tiles.map(t=>fetchJson(join(basePath,`${source.root}${t.file}`),fetchImpl)));
      const rows=payloads.flatMap(p=>Array.isArray(p)?p:(p?.stations||p?.rows||[]));
      return rows.map(row=>adapter.normalizeRow(row,{countryCode:(source.countries||[]).find(x=>x!=='*')||query.countryCode,sourceId:source.id,schemaVersion:manifest.schemaVersion,queryDate:query.date})).filter(Boolean);
    };
  }

  function createRegistryLoaders({registry,basePath='..',adapters={},fetchImpl}={}){
    const loaders={};
    for(const source of registry?.sources||[]){
      if(source.active===false)continue;
      if(source.adapter==='tesla-json'&&adapters.teslaJson?.createLoader){
        loaders[source.id]=adapters.teslaJson.createLoader({url:join(basePath,source.path),fetchImpl});
      }else if(source.adapter==='direct-offer-json'&&adapters.directOffers?.createLoader&&source.path){
        loaders[source.id]=adapters.directOffers.createLoader({url:join(basePath,source.path),fetchImpl});
      }else if(source.adapter==='direct-tariff-gzip'&&adapters.legacyDirectTariffs?.createLoader&&source.path){
        loaders[source.id]=adapters.legacyDirectTariffs.createLoader({url:join(basePath,source.path),fetchImpl,source});
      }else if(source.adapter==='direct-station-gzip'&&adapters.legacyDirectStations?.createLoader&&source.path){
        loaders[source.id]=adapters.legacyDirectStations.createLoader({url:join(basePath,source.path),fetchImpl,source});
      }else if(source.adapter==='france-crosswalk-json'&&adapters.franceCrosswalk?.createLoader&&source.path){
        loaders[source.id]=adapters.franceCrosswalk.createLoader({url:join(basePath,source.path),fetchImpl});
      }else if(source.adapter==='france-irve-status-json'&&adapters.franceIrveStatus?.createLoader&&source.path){
        loaders[source.id]=adapters.franceIrveStatus.createLoader({url:join(basePath,source.path),fetchImpl,maxAgeMinutes:num(source.freshnessMaxMinutes)??120});
      }else if(/^national-compact-v\d+$/.test(source.adapter)&&adapters.nationalCompact){
        loaders[source.id]=createNationalLoader({source,basePath,adapter:adapters.nationalCompact,fetchImpl});
      }
    }
    return loaders;
  }

  return{fetchJson,boundsFromQuery,tileIntersects,selectTiles,createNationalLoader,createRegistryLoaders};
});