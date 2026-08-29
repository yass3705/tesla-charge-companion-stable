(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.nationalCompact=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const uniq=values=>[...new Set((values||[]).map(text).filter(Boolean))];
  const toMin=v=>{if(v==='24:00')return 1440;const m=text(v).match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):0;};
  const toHHMM=m=>{m=Math.max(0,Math.min(1440,Math.round(m)));return m===1440?'24:00':`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;};

  function providerFromLabel(label){const s=text(label),i=s.indexOf('·');return(i>=0?s.slice(0,i):s).trim()||'National';}
  function pricingFromRows(rows,dayIndex){
    const rules=(rows||[]).filter(r=>!Array.isArray(r?.[11])||r[11].includes(dayIndex)).map(r=>({
      scope:r[0]||'allDay',start:r[1]||'00:00',end:r[2]||'24:00',billing:r[3]||'kwh',currency:text(r[4]||'EUR').toUpperCase(),
      pricePerKwh:Number(r[5]||0),chargePerMinute:Number(r[6]||0),connectionFee:Number(r[7]||0),idlePerMinute:Number(r[8]||0),
      afterMinutesRate:Number(r[9]||0),afterMinutesThreshold:Number(r[10]||0),days:Array.isArray(r[11])?r[11]:null,
      ocpiDurationBands:Array.isArray(r[12])?clone(r[12]):[]
    }));
    return{type:'rules',rules};
  }

  function franceAccess(rows){
    if(!Array.isArray(rows)||!rows.length)return{kind:'unknown',limited:false,raw:clone(rows)||[]};
    const days={};for(let i=0;i<7;i++)days[String(i)]=[];
    for(const r of rows){const d=Number(r?.[0]);if(Number.isInteger(d)&&d>=0&&d<=6)days[String(d)].push([r[1]||'00:00',r[2]||'24:00']);}
    return{kind:'weekly',limited:true,days,raw:clone(rows)};
  }

  const amsterdamFmt=typeof Intl!=='undefined'?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):null;
  function localParts(iso){
    const d=new Date(iso);if(!amsterdamFmt||!Number.isFinite(d.getTime()))return null;const p={};for(const x of amsterdamFmt.formatToParts(d))if(x.type!=='literal')p[x.type]=x.value;
    return{date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
  }
  function mergeIntervals(xs){const a=(xs||[]).map(x=>[Math.max(0,Number(x[0])),Math.min(1440,Number(x[1]))]).filter(x=>x[1]>x[0]).sort((a,b)=>a[0]-b[0]),out=[];for(const x of a){const p=out[out.length-1];if(p&&x[0]<=p[1])p[1]=Math.max(p[1],x[1]);else out.push(x.slice());}return out;}
  function subtractIntervals(base,cuts){let out=mergeIntervals(base);for(const cut of mergeIntervals(cuts)){const next=[];for(const x of out){if(cut[1]<=x[0]||cut[0]>=x[1])next.push(x);else{if(cut[0]>x[0])next.push([x[0],cut[0]]);if(cut[1]<x[1])next.push([cut[1],x[1]]);}}out=next;}return out;}
  function exceptionSlice(begin,end,dateStr){const a=localParts(begin),b=localParts(end);if(!a||!b||dateStr<a.date||dateStr>b.date)return null;const s=dateStr===a.date?toMin(a.time):0,e=dateStr===b.date?toMin(b.time):1440;return e>s?[s,e]:null;}
  function netherlandsAccess(compact,dateStr){
    if(!Array.isArray(compact)||!compact.length)return{kind:'unknown',limited:false,raw:clone(compact)||[]};
    const mode=Number(compact[0]||0),regular=Array.isArray(compact[1])?compact[1]:[],exceptions=Array.isArray(compact[2])?compact[2]:[],parkingType=compact[3]||'',parkingRestrictions=Array.isArray(compact[4])?compact[4]:[];
    if(mode===0)return{kind:'unknown',limited:false,parkingType,parkingRestrictions,raw:clone(compact)};
    const d=new Date(`${dateStr}T12:00:00`),day=Number.isFinite(d.getTime())?d.getDay():new Date().getDay();
    let intervals=mode===2?[[0,1440]]:regular.filter(r=>Number(r?.[0])===day).map(r=>[toMin(r[1]),toMin(r[2])]);
    const opens=[],closes=[];for(const ex of exceptions){const slice=exceptionSlice(ex?.[1],ex?.[2],dateStr);if(!slice)continue;(Number(ex[0])===1?opens:closes).push(slice);}
    intervals=mergeIntervals([...subtractIntervals(intervals,closes),...opens]);
    const shown=intervals.map(x=>[toHHMM(x[0]),toHHMM(x[1])]);
    return{kind:'ocpi',limited:!(shown.length===1&&shown[0][0]==='00:00'&&shown[0][1]==='24:00'),date:dateStr,intervals:shown,parkingType,parkingRestrictions,raw:clone(compact)};
  }

  function statusFromValue(value,sourceId,updatedAt){const v=text(value).toUpperCase();return{state:v==='IN_SERVICE'||v==='AVAILABLE'?'available':v==='OUT_OF_SERVICE'||v==='INOPERATIVE'||v==='OUTOFORDER'?'out_of_service':'unknown',sourceId,updatedAt:updatedAt||null};}

  function normalizeRow(row,{countryCode,sourceId,schemaVersion=1,queryDate}={}){
    if(!Array.isArray(row)||!row[0])return null;
    const cc=text(countryCode).toUpperCase(),isNl=cc==='NL',isFr=cc==='FR';
    const dateStr=queryDate||new Date().toISOString().slice(0,10),d=new Date(`${dateStr}T12:00:00`),dayIndex=Number.isFinite(d.getTime())?d.getDay():new Date().getDay();
    const stationId=text(row[0]),configs=row[8]||[],evses=[],offers=[];
    for(const [index,c] of configs.entries()){
      const cfgId=text(c?.[0])||`${stationId}:cfg:${index}`,label=text(c?.[1]),provider=providerFromLabel(label),pricing=pricingFromRows(c?.[5],dayIndex),pdcIds=uniq(Array.isArray(c?.[6])?c[6]:[]);
      const evseAliases=isFr?pdcIds.map(id=>`irve-pdc:${id}`):[];
      evses.push({id:cfgId,aliases:evseAliases,pdcIds:isFr?pdcIds:undefined,label,stalls:Number(c?.[4]||0),connectors:[{id:`${cfgId}:connector`,kind:text(c?.[2]||'AC').toUpperCase(),powerKw:Number(c?.[3]||11)}]});
      if(pricing.rules.length)offers.push({id:`${sourceId}:${stationId}:${cfgId}`,provider,kind:'national_fallback',subscriptionId:null,countries:[countryCode],currency:pricing.rules[0]?.currency||'EUR',evseIds:uniq([cfgId,...pdcIds]),pricing});
    }
    const aliases=[`${sourceId}:${stationId}`,`national:${cc}:${stationId}`];if(isFr)aliases.push(`irve-station:${stationId}`);
    const networkBrand=isFr?text(row[10]||row[5]):text(row[5]);
    return{
      canonicalId:`${cc}:national:${stationId}`,
      aliases,
      sourceStationId:stationId,countryCode:cc,name:text(row[1]||row[2])||`Station ${countryCode}`,address:text(row[2]),
      latitude:Number(row[3]),longitude:Number(row[4]),physicalOperator:{name:text(row[5])||'Unknown'},networkBrand,
      evses,access:isNl?netherlandsAccess(row[7],dateStr):franceAccess(row[7]),
      status:isNl?statusFromValue(row[10],sourceId,row[9]):{state:'unknown',sourceId,updatedAt:row[9]||null},
      offers,updatedAt:row[9]||null,legacy:{schemaVersion,stalls:Number(row[6]||0)}
    };
  }

  function intersects(tile,lat,lon,radiusKm){if(!(radiusKm>0))return true;const latDelta=radiusKm/110.574,cos=Math.max(.15,Math.cos(lat*Math.PI/180)),lonDelta=radiusKm/(111.320*cos);return tile.maxLat>=lat-latDelta&&tile.minLat<=lat+latDelta&&tile.maxLon>=lon-lonDelta&&tile.minLon<=lon+lonDelta;}
  async function readJsonMaybeGzip(response){
    if(!response.ok)throw new Error(`catalogue fragment unavailable (${response.status})`);
    const bytes=new Uint8Array(await response.arrayBuffer());let raw;
    if(bytes[0]===0x1f&&bytes[1]===0x8b){if(typeof DecompressionStream!=='function')throw new Error('gzip decompression unavailable');raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}
    else raw=new TextDecoder().decode(bytes);
    return JSON.parse(raw);
  }

  function createLoader({base,countryCode,sourceId,fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for national adapter');
    base=text(base);if(base&&!base.endsWith('/'))base+='/';let manifestPromise=null;const fragmentCache=new Map();
    const manifest=()=>manifestPromise||(manifestPromise=f(`${base}manifest.json`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`manifest unavailable (${r.status})`);return r.json();}));
    async function fragment(file,version){const key=`${file}|${version||''}`;if(!fragmentCache.has(key))fragmentCache.set(key,f(`${base}${file}${version?`?v=${encodeURIComponent(version)}`:''}`,{cache:'force-cache'}).then(readJsonMaybeGzip).catch(e=>{fragmentCache.delete(key);throw e;}));return fragmentCache.get(key);}
    return async function(query={}){
      const m=await manifest(),origin=query.origin||{},lat=Number(origin.lat??origin.latitude),lon=Number(origin.lon??origin.longitude),radius=Number(query.radiusKm||0),version=m.generatedAt||m.allSha256||'';
      let rows;
      if(Number.isFinite(lat)&&Number.isFinite(lon)&&radius>0){const tiles=(m.tiles||[]).filter(t=>intersects(t,lat,lon,radius));rows=(await Promise.all(tiles.map(t=>fragment(t.file,version)))).flat();}
      else rows=await fragment(m.allFile,version);
      return rows.map(row=>normalizeRow(row,{countryCode,sourceId,schemaVersion:m.schemaVersion,queryDate:query.date})).filter(Boolean);
    };
  }

  return{providerFromLabel,pricingFromRows,franceAccess,netherlandsAccess,statusFromValue,normalizeRow,createLoader,intersects};
});