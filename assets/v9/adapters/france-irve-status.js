(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.franceIrveStatus=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const lower=v=>text(v).toLowerCase();

  function stateOf(value){
    const v=lower(value).replace(/[\s-]+/g,'_');
    if(['en_service','available','in_service','operative'].includes(v))return'available';
    if(['hors_service','out_of_service','outoforder','out_of_order','inoperative'].includes(v))return'out_of_service';
    return'unknown';
  }
  function updatedAtOf(raw,fallback){return raw?.updatedAt||raw?.last_updated||raw?.date_maj||raw?.dateMaj||fallback||null;}
  function stationKey(raw){return text(raw?.id_station_itinerance||raw?.idStationItinerance||raw?.stationId||raw?.station_id);}
  function pdcKey(raw){return text(raw?.id_pdc_itinerance||raw?.idPdcItinerance||raw?.evseId||raw?.pdcId);}

  function normalizePayload(payload,{maxAgeMinutes=120,now=Date.now()}={}){
    const rows=Array.isArray(payload)?payload:(payload?.records||payload?.data||payload?.results||[]);
    const generatedAt=payload?.generatedAt||payload?.updatedAt||null;
    const groups=new Map();
    for(const raw of rows){
      const sid=stationKey(raw),pid=pdcKey(raw);if(!sid&&!pid)continue;
      const updatedAt=updatedAtOf(raw,generatedAt),ts=updatedAt?Date.parse(updatedAt):NaN;
      if(Number.isFinite(ts)&&Number.isFinite(maxAgeMinutes)&&maxAgeMinutes>=0&&now-ts>maxAgeMinutes*60000)continue;
      const key=sid||`pdc:${pid}`,g=groups.get(key)||{sid,pdcs:[],updatedAt:null};
      const state=stateOf(raw?.etat_pdc??raw?.etatPdc??raw?.status);
      g.pdcs.push({id:pid||null,state,updatedAt});
      if(updatedAt&&(!g.updatedAt||String(updatedAt)>String(g.updatedAt)))g.updatedAt=updatedAt;
      groups.set(key,g);
    }
    const stationFragments=[];
    for(const g of groups.values()){
      const known=g.pdcs.filter(p=>p.state!=='unknown');
      const state=known.some(p=>p.state==='available')?'available':known.length&&known.every(p=>p.state==='out_of_service')?'out_of_service':'unknown';
      const aliases=[];
      if(g.sid)aliases.push(`irve-station:${g.sid}`);
      for(const p of g.pdcs)if(p.id)aliases.push(`irve-pdc:${p.id}`);
      stationFragments.push({
        aliases,
        sourceStationId:g.sid||g.pdcs[0]?.id||'',
        status:{state,sourceId:'france-irve-dynamic',updatedAt:g.updatedAt,pdcs:g.pdcs},
        updatedAt:g.updatedAt
      });
    }
    return{stationFragments,metadata:{generatedAt,maxAgeMinutes,recordCount:rows.length,stationCount:stationFragments.length}};
  }

  function createLoader({url,fetchImpl,maxAgeMinutes=120}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for France IRVE status adapter');
    return async function(){
      const r=await f(url,{cache:'no-cache'});if(!r.ok)throw new Error(`France IRVE dynamic status unavailable (${r.status})`);
      return normalizePayload(await r.json(),{maxAgeMinutes});
    };
  }
  return{stateOf,normalizePayload,createLoader};
});