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
    const web=raw.sucTracker||null;
    const observedAt=raw.sourceObservedAt||raw.lastUpdated||null;
    for(const [index,cfg] of configs.entries()){
      const evseId=web?`${raw.id}:${text(cfg?.id)||index}`:(text(cfg?.id)||`${raw.id}:cfg:${index}`);
      const pricing=clone(cfg?.pricing||raw?.pricing);
      const currencies=[...new Set((pricing?.rules||[]).map(r=>r.currency).filter(Boolean))];
      const webEligible=!web||(pricing?.rules?.length>0&&web.accessSource!=='unknown'&&web.lifecycle==='active'&&!web.staleSince&&currencies.length===1);
      if(web&&pricing)pricing.postChargeFeeUnknown=true;
      evses.push({
        id:evseId,
        label:text(cfg?.label)||'Tesla',
        stalls:Number(cfg?.stalls||raw?.stalls||0),
        connectors:[{id:`${evseId}:connector`,kind:text(cfg?.kind||raw?.kind||'DC').toUpperCase(),powerKw:Number(cfg?.powerKw||raw?.powerKw||0)}]
      });
      if(pricing&&webEligible)offers.push({
        id:`tesla-direct:${evseId}`,
        provider:'Tesla',kind:'direct',subscriptionId:null,countries:[text(raw?.countryCode).toUpperCase()||'*'],currency:currencies[0]||pricing?.currency||'EUR',
        evseIds:[evseId],pricing,priority:100,
        metadata:{timeZone:raw.timezone||null,sourceProvider:web?'SuC Tracker':'Tesla legacy snapshot',observedAt,
          sourceUrl:web?.url||raw.teslaUrl||null,sourceStationId:web?.sourceStationId||raw.id,
          ...(web?{datasetGeneratedAt:web.datasetGeneratedAt,feesCoverage:web.feesCoverage,postChargeFeeUnknown:true,powerScope:web.powerScope}: {})}
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
      status:{state:web?'unknown':(raw.temporarilyUnavailable===true?'out_of_service':'available'),updatedAt:web?null:raw.lastUpdated||null,sourceId:'tesla-global'},
      offers,updatedAt:observedAt,
      legacy:{source:raw.source||'teslaSupercharger'}
    };
  }

  function normalizePayload(payload){return (Array.isArray(payload)?payload:payload?.stations||[]).map(normalizeStation).filter(Boolean);}

  function createLoader({url='data/tesla_stations.json',supplementUrl=null,fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);let promise=null;
    if(!f)throw new Error('fetch unavailable for Tesla adapter');
    return async function(){
      if(!promise){
        const read=async path=>{const r=await f(path,{cache:'no-cache'});if(!r.ok)throw new Error(`Tesla catalogue unavailable (${r.status})`);return normalizePayload(await r.json());};
        promise=Promise.all([read(url),supplementUrl?read(supplementUrl):[]]).then(([primary,supplement])=>{
          const ids=new Set(primary.map(s=>s.canonicalId));
          return primary.concat(supplement.filter(s=>!ids.has(s.canonicalId)));
        }).catch(err=>{promise=null;throw err;});
      }
      return promise;
    };
  }

  return{normalizeStation,normalizePayload,createLoader};
});
