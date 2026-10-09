(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.ukPcpr=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const str=x=>String(x==null?'':x).trim();
  const num=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
  const norm=x=>str(x).toLowerCase().replace(/[^a-z0-9]/g,'');
  const reject=reason=>{throw new Error('Allego V9 PCPR rejected: '+reason);};
  const COMPONENTS=new Set(['ENERGY','TIME','PARKING_TIME','FLAT']);

  function pricingFromTariff(t){
    if(!t||t.country_code!=='GB'||t.currency!=='GBP'||t.tccPriceBasis!=='GBP_including_public_UK_VAT')return null;
    if(['start_date_time','end_date_time'].some(k=>t[k]))return null;
    if(!Array.isArray(t.elements)||!t.elements.length)return null;
    const r={scope:'allDay',currency:'GBP'};
    let components=0;
    const stepValues={};
    for(const element of t.elements){
      if(!element||!Array.isArray(element.price_components)||!element.price_components.length)return null;
      const restrictions=element.restrictions||{},keys=Object.keys(restrictions);
      if(keys.some(k=>!['start_date','min_duration'].includes(k)))return null;
      if(restrictions.start_date&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(str(restrictions.start_date)))return null;
      const minDuration=restrictions.min_duration==null?null:num(restrictions.min_duration);
      if(minDuration!=null&&(!Number.isInteger(minDuration)||minDuration<0))return null;
      for(const c of element.price_components){
        if(minDuration!=null&&c.type!=='PARKING_TIME')return null;
        const kind=str(c.type),price=num(c.price),step=num(c.step_size??1);
        if(!COMPONENTS.has(kind)||price==null||price<0||step==null||step<0||c.vat!=null)return null;
        if(kind!=='FLAT'&&step<=0)return null;
        if(kind==='PARKING_TIME'&&step!==1)return null; // V9 cannot round parking intervals exactly.
        if(stepValues[kind]!=null&&stepValues[kind]!==step)return null;
        stepValues[kind]=step;
        components++;
        if(kind==='ENERGY')r.pricePerKwh=(r.pricePerKwh||0)+price;
        if(kind==='TIME')r.chargePerMinute=(r.chargePerMinute||0)+price/60; // OCPI TIME is GBP/hour.
        if(kind==='PARKING_TIME'){
          if(minDuration!=null){
            r.idlePerMinute=r.idlePerMinute||0;
            r.ocpiDurationBands=r.ocpiDurationBands||[];
            r.ocpiDurationBands.push(['PARKING_TIME',minDuration,null,price/60]);
            r.parkingIsCongestion=true;
          }else r.idlePerMinute=(r.idlePerMinute||0)+price/60;
        }
        if(kind==='FLAT')r.connectionFee=(r.connectionFee||0)+price;
      }
    }
    if(!components)return null;
    if(stepValues.ENERGY>1)r.energyStepWh=stepValues.ENERGY;
    if(stepValues.TIME>1)r.chargingTimeStepSeconds=stepValues.TIME;
    return{type:'rules',rules:[r]};
  }

  function tariffValidFrom(t){
    const dates=(t?.elements||[]).map(el=>str(el?.restrictions?.start_date)).filter(Boolean);
    return dates.length?dates.sort().at(-1):null;
  }

  function connectorKind(c){
    const standard=str(c.standard).toUpperCase(),type=str(c.power_type).toUpperCase();
    if(standard.includes('CHADEMO')||standard.includes('NEMA')||standard.includes('DOMESTIC'))return null;
    if(standard.includes('COMBO')||standard.includes('CCS')||type.includes('DC'))return 'DC';
    if(standard.includes('T2')||standard.includes('TYPE_2')||type.includes('AC'))return 'AC';
    return null;
  }

  function normalizePayload(doc,audit,source={}){
    if(doc?.country!=='GB'||doc?.sources?.length!==1||doc.sources[0]?.id!=='allego-uk-pcpr-direct')reject('source identity');
    if(doc.integrationStatus!=='cpo_direct_exact_connector_vat_inclusive_staged')reject('source not validated staging');
    if(audit?.validatedForV9!==true||audit?.sourceId!=='allego-uk-pcpr-direct'||audit?.status!=='validated_public_exact_connector'||audit?.collectedAt!==doc.collectedAt)reject('independent audit missing or stale');
    if(audit?.scope!=='strict_declared_Allego_CPO_public_only'||audit?.publicConnectors!==audit?.exactPricedConnectors||audit?.unpricedPublicConnectors!==0)reject('incomplete source-level audit');
    const src=doc.sources[0],tariffIndex=new Map();
    for(const t of src.tariffs||[]){
      const k=[t.country_code,t.party_id,str(t.id)].join('|');
      if(tariffIndex.has(k))reject('duplicate tariff');
      tariffIndex.set(k,t);
    }
    const result=[],stationIds=new Set(),connKeys=new Set(),usedTariffs=new Set();
    let count=0,priced=0,unpriced=0;
    for(const loc of src.locations||[]){
      if(loc.country_code!=='GB'||loc.publish!==true||!norm(loc.operator?.name).startsWith('allego'))reject('foreign/private CPO location');
      const lat=num(loc.coordinates?.latitude),lon=num(loc.coordinates?.longitude);
      if(lat==null||lon==null||lat<49||lat>61||lon< -9||lon>3)reject('invalid UK coordinates');
      if(/PRIVATE|STAFF|EMPLOYEE|FLEET|RESIDENT_ONLY/i.test([loc.parking_type,loc.access,loc.access_type].join('|')))reject('restricted access');
      const stationId=str(loc.id),party=str(loc.party_id);
      if(!stationId||!party||stationIds.has(stationId))reject('duplicate or missing station id');
      stationIds.add(stationId);
      const evses=[],offers=[];
      for(const e of loc.evses||[]){
        const evseId=str(e.evse_id||e.uid);
        if(!evseId)reject('missing EVSE id');
        const conns=[];
        for(const c of e.connectors||[]){
          const cid=str(c.id),connectorId='allego:'+stationId+':'+evseId+':'+cid;
          if(!cid||connKeys.has(connectorId))reject('duplicate or missing connector');
          connKeys.add(connectorId);
          count++;
          const powerWatts=num(c.max_electric_power),powerKw=powerWatts!=null?powerWatts/1000:null;
          const kind=connectorKind(c);
          conns.push({id:connectorId,kind:kind||'OTHER',powerKw,plugName:str(c.standard),metadata:{nativeConnectorId:cid,sourceTariffIds:c.sourceTariffIds||[],tariffScope:'exact_connector'}});
          const ids=c.tariff_ids||[];
          if(!Array.isArray(ids)||ids.length!==1||!kind||!powerKw||powerKw<=0){unpriced++;continue;}
          const key=['GB',party,str(ids[0])].join('|'),tariff=tariffIndex.get(key);
          if(!tariff||!(c.sourceTariffIds||[]).map(str).includes(str(ids[0])))reject('tariff CPO/connector reference mismatch');
          usedTariffs.add(key);
          const pricing=pricingFromTariff(tariff);
          if(!pricing){unpriced++;continue;}
          offers.push({id:'allego-direct:'+stationId+':'+evseId+':'+cid,provider:'Allego direct',kind:'direct',offerKind:'direct',
            countries:['GB'],currency:'GBP',operatorIds:['allego'],directOperatorOnly:true,evseIds:[evseId],connectorIds:[connectorId],
            connectorKinds:[kind],minPowerKw:powerKw,maxPowerKw:powerKw,pricing,
            validFrom:tariffValidFrom(tariff),priority:Number(source?.priority?.tariff||130),
            metadata:{pcprExactConnector:true,sourceTariffId:str(ids[0]),sourcePartyId:party,sourceConnectorId:cid,
              timeZone:'Europe/London',tccPriceBasis:'GBP_including_public_UK_VAT',sourceId:source.id,verified:true}});
          priced++;
        }
        if(conns.length)evses.push({id:evseId,evseId,connectors:conns});
      }
      if(!evses.length)reject('empty audited public station');
      result.push({canonicalId:'GB:allego:'+stationId,sourceStationId:stationId,countryCode:'GB',
        name:str(loc.name)||'Allego',address:[str(loc.address),str(loc.city),str(loc.postal_code)].filter(Boolean).join(', '),
        latitude:lat,longitude:lon,physicalOperator:{id:'allego',name:'Allego'},networkBrand:'Allego',
        access:{kind:'public',limited:false},status:{state:'unknown',sourceId:source.id,updatedAt:doc.collectedAt},
        evses,offers,updatedAt:doc.collectedAt});
    }
    if(result.length!==audit.publicLocations||count!==audit.publicConnectors)reject('independent audit count mismatch');
    if(!result.length||!priced)reject('no usable exact connector offers');
    // Unsupported tariff structures remain visible without an invented price.
    return{stations:result,metadata:{country:'GB',provider:'Allego',sourceId:source.id,
      collectedAt:doc.collectedAt,publicStations:result.length,auditedConnectors:count,
      comparableConnectorOffers:priced,notComparableConnectors:unpriced,tariffs:usedTariffs.size}};
  }

  async function readGzip(response){
    if(!response.ok)reject('dataset HTTP '+response.status);
    if(typeof DecompressionStream!=='function')reject('gzip decompression unsupported');
    return JSON.parse(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text());
  }
  function createLoader({source,fetchImpl}={}){
    if(!source?.url||!source?.auditUrl)reject('dataset/audit URL missing');
    const fetcher=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);
    if(!fetcher)reject('fetch unavailable');
    let cache=null;
    return async function(){
      if(!cache)cache=Promise.all([fetcher(source.url,{cache:'no-cache'}).then(readGzip),
        fetcher(source.auditUrl,{cache:'no-cache'}).then(r=>{if(!r.ok)reject('validation report HTTP '+r.status);return r.json();})])
        .then(([doc,audit])=>normalizePayload(doc,audit,source)).catch(err=>{cache=null;throw err;});
      return cache;
    };
  }
  return{pricingFromTariff,connectorKind,normalizePayload,createLoader};
});
