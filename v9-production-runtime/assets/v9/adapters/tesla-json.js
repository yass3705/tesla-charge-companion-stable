(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.teslaJson=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));

  function configRows(raw){
    if(Array.isArray(raw?.chargingConfigurations)&&raw.chargingConfigurations.length)return raw.chargingConfigurations;
    return [{id:`${raw?.id||'tesla'}:default`,label:'Tesla',kind:raw?.kind||'DC',powerKw:Number(raw?.powerKw||0),stalls:Number(raw?.stalls||0),pricing:raw?.pricing||null}];
  }

  function normalizeStation(raw){
    if(!raw||!text(raw.id))return null;
    const configs=configRows(raw),evses=[],offers=[];
    for(const [index,cfg] of configs.entries()){
      const evseId=text(cfg?.id)||`${raw.id}:cfg:${index}`;
      evses.push({
        id:evseId,
        label:text(cfg?.label)||'Tesla',
        stalls:Number(cfg?.stalls||raw?.stalls||0),
        connectors:[{id:`${evseId}:connector`,kind:text(cfg?.kind||raw?.kind||'DC').toUpperCase(),powerKw:Number(cfg?.powerKw||raw?.powerKw||0)}]
      });
      if(cfg?.pricing||raw?.pricing)offers.push({
        id:`tesla-direct:${evseId}`,
        provider:'Tesla',kind:'direct',subscriptionId:null,countries:[text(raw?.countryCode).toUpperCase()||'*'],currency:'EUR',
        evseIds:[evseId],pricing:clone(cfg?.pricing||raw?.pricing),priority:100
      });
    }
    return{
      canonicalId:text(raw.id),
      aliases:[`tesla:${text(raw.id)}`],
      sourceStationId:text(raw.id),
      countryCode:text(raw.countryCode).toUpperCase(),
      name:text(raw.name)||'Tesla Supercharger',address:text(raw.address),
      latitude:Number(raw.latitude),longitude:Number(raw.longitude),
      physicalOperator:{id:'tesla',name:'Tesla'},networkBrand:'Tesla Supercharger',
      evses,access:clone(raw.access)||null,
      status:{state:raw.temporarilyUnavailable===true?'out_of_service':'available',updatedAt:raw.lastUpdated||null,sourceId:'tesla-global'},
      offers,updatedAt:raw.lastUpdated||null,
      legacy:{source:raw.source||'teslaSupercharger'}
    };
  }

  function normalizePayload(payload){return (Array.isArray(payload)?payload:payload?.stations||[]).map(normalizeStation).filter(Boolean);}

  function createLoader({url='data/tesla_stations.json',fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);let promise=null;
    if(!f)throw new Error('fetch unavailable for Tesla adapter');
    return async function(){
      if(!promise)promise=f(url,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`Tesla catalogue unavailable (${r.status})`);return r.json();}).then(normalizePayload).catch(err=>{promise=null;throw err;});
      return promise;
    };
  }

  return{normalizeStation,normalizePayload,createLoader};
});
