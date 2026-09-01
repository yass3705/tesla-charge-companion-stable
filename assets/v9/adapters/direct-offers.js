(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.directOffers=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const normOperator=v=>text(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const operatorIds=raw=>[...new Set((raw.operatorIds||raw.operatorAliases||[]).map(normOperator).filter(Boolean))];
  const networkIds=raw=>[...new Set((raw.networkIds||raw.networkAliases||[]).map(normOperator).filter(Boolean))];
  const countries=(raw,country)=>[...new Set([...(raw.countries||[]).map(c=>text(c).toUpperCase()),text(country).toUpperCase()].filter(Boolean))];
  const connectorKinds=raw=>[...new Set([...(raw.connectorKinds||[]),...(raw.kind?[raw.kind]:[])].map(v=>text(v).toUpperCase()).filter(Boolean))];
  const ids=(...values)=>[...new Set(values.flat().map(text).filter(Boolean))];
  function evseIdentityVariants(...values){
    const out=[];
    for(const raw of ids(...values)){
      out.push(raw);
      const compact=raw.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(compact&&compact!==raw)out.push(compact);
    }
    return[...new Set(out)];
  }

  function pricing(raw){
    if(raw.pricing&&typeof raw.pricing==='object')return clone(raw.pricing);
    if(raw.pricePerKwh!=null)return{type:'kwh',pricePerKwh:Number(raw.pricePerKwh||0)};
    return{type:'unknown'};
  }

  function common(raw,country){
    const physicalOnly=raw.directOperatorOnly===true;
    const exactEvses=evseIdentityVariants(raw.evseIds||[],raw.evseId,raw.idPdcItinerance,raw.id_pdc_itinerance);
    const exactEvseScope=exactEvses.length>0&&text(raw.verifiedScope).toLowerCase()==='exact_evse';
    return{
      id:text(raw.id||raw.selectionId),provider:text(raw.provider),
      operatorIds:operatorIds(raw),operatorAliases:Array.isArray(raw.operatorAliases)?clone(raw.operatorAliases):[],
      networkIds:physicalOnly?[]:networkIds(raw),networkAliases:physicalOnly?[]:(Array.isArray(raw.networkAliases)?clone(raw.networkAliases):[]),
      stationIds:ids(raw.stationIds||[],raw.stationId,raw.sourceStationId),
      evseIds:exactEvses,
      connectorKinds:connectorKinds(raw),countries:countries(raw,country),
      currency:text(raw.currency||raw.pricing?.currency||'EUR').toUpperCase(),pricing:pricing(raw),
      validFrom:text(raw.validFrom)||null,validThrough:text(raw.validThrough)||null,validityBasis:text(raw.validityBasis)||null,
      minPowerKw:exactEvseScope?undefined:(raw.minPowerKw==null?undefined:raw.minPowerKw),maxPowerKw:exactEvseScope?undefined:(raw.maxPowerKw==null?undefined:raw.maxPowerKw),
      directOperatorOnly:physicalOnly,priority:Number(raw.priority??95),sourceId:text(raw.sourceId||raw.source)||'direct-offers',
      metadata:{source:raw.source||null,note:raw.note||null,monthlyFeeEur:raw.monthlyFeeEur??null,monthlyFeeLabel:raw.monthlyFeeLabel||null,annualFeeEur:raw.annualFeeEur??null,promotionEnd:raw.monthlyFeePromotionEnd||null,defaultSelected:raw.defaultSelected===true,runtime:raw.runtime||null,customerProfile:raw.customerProfile||null,parkingPolicy:clone(raw.parkingPolicy)||null,verifiedScope:raw.verifiedScope||null,exactEvsePowerConstraintSuppressed:exactEvseScope,...(clone(raw.metadata)||{})}
    };
  }

  function directRule(raw,country){return{...common(raw,country),kind:'direct',offerKind:'direct',subscriptionId:null};}
  function subscriptionRule(raw,country){return{...common(raw,country),kind:'subscription',offerKind:'subscription',subscriptionId:text(raw.selectionId||raw.id),priority:Number(raw.priority??100)};}
  function emspRule(raw,country){return{...common(raw,country),kind:'emsp',offerKind:'emsp',subscriptionId:null,directOperatorOnly:false,priority:Number(raw.priority??80)};}

  function isIonityExactSnapshot(payload){
    return payload?.failClosed===true&&text(payload?.source).includes('adhoc-bff.ionity.cloud')&&Array.isArray(payload?.stations);
  }
  function normalizeIonityExactSnapshot(payload){
    if(Number(payload?.evseCount)!==1853||Number(payload?.resolvedEvseCount)!==1850||Number(payload?.failureCount)!==3||Number(payload?.missingPriceCount)!==0)throw new Error('IONITY exact snapshot integrity guard failed');
    const expected=new Set(['FR*IOY*E1','FR*IOY*E2','FRTSLE2IOYGE']);
    const failures=new Set((payload?.failures||[]).filter(x=>x?.stage==='resolve').map(x=>text(x?.evseId)));
    if(failures.size!==expected.size||[...expected].some(x=>!failures.has(x)))throw new Error('IONITY exact snapshot unresolved EVSE guard failed');
    const groups=new Map();let mapped=0;
    for(const station of payload.stations){
      for(const c of station?.connectors||[]){
        if(c?.blockingFee!=null)throw new Error(`IONITY blocking fee is not mapped for ${text(c?.sourceEvseId)||text(c?.connectorUuid)}`);
        const evse=text(c?.sourceEvseId);if(!evse)continue;
        const p=c?.adhocPrice||{};
        if(text(p.unit).toLowerCase()!=='kwh'||text(p.currency).toUpperCase()!=='EUR'||!Number.isFinite(Number(p.amount)))throw new Error(`IONITY exact price invalid for ${evse}`);
        const amount=Number(p.amount),key=String(amount);
        if(!groups.has(key))groups.set(key,{amount,evses:[]});
        groups.get(key).evses.push(evse);mapped++;
      }
    }
    if(mapped!==1850)throw new Error(`IONITY exact snapshot mapped EVSE guard failed (${mapped}/1850)`);
    const offerRules=[];
    for(const {amount,evses} of [...groups.values()].sort((a,b)=>a.amount-b.amount)){
      offerRules.push(directRule({
        id:`ionity-direct-fr-exact-${String(amount).replace('.','-')}`,
        selectionId:`ionity-direct-fr-exact-${String(amount).replace('.','-')}`,
        provider:'IONITY Direct',operatorAliases:['IONITY'],countries:['FR'],evseIds:evses,
        currency:'EUR',priority:130,pricing:{type:'kwh',pricePerKwh:amount},
        source:'data-lab/data/operator_direct/ionity_exact_france.json',directOperatorOnly:true,verifiedScope:'exact_evse',
        metadata:{consumerPriceSource:'IONITY public adhoc runtime',sourceEndpoint:payload.source,sourceGeneratedAt:payload.generatedAt,networkWideGeneralization:false,exactEvseRequired:true}
      },'FR'));
    }
    return{offerRules,metadata:{schemaVersion:payload?.schemaVersion||1,country:'FR',generatedAt:payload?.generatedAt||null,mode:'verified_exact_evse_runtime_snapshot',policy:{networkWideGeneralization:false,exactEvseRequired:true,noNationalFallback:true,failClosed:true},sourceEvidence:{panEvseCount:1853,resolvedEvseCount:1850,physicalLocationCount:payload?.locationCount,knownUnresolvedEvseIds:[...expected]}}};
  }
  function normalizePayload(payload){
    if(isIonityExactSnapshot(payload))return normalizeIonityExactSnapshot(payload);
    const country=text(payload?.country).toUpperCase();if(!country)throw new Error('direct offer payload country missing');
    const direct=payload?.directOffers||payload?.operatorOffers||[],subscriptions=payload?.subscriptionOffers||payload?.subscriptions||[],emsp=payload?.emspOffers||[];
    return{offerRules:[...direct.map(x=>directRule(x,country)),...subscriptions.map(x=>subscriptionRule(x,country)),...emsp.map(x=>emspRule(x,country))],metadata:{schemaVersion:payload?.schemaVersion||1,country,generatedAt:payload?.generatedAt||null,policy:payload?.policy||{},mode:payload?.mode||null}};
  }
  function createLoader({url,fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable for direct offer adapter');let promise=null;
    return async function(){if(!promise)promise=f(url,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`direct offers unavailable (${r.status})`);return r.json();}).then(normalizePayload).catch(e=>{promise=null;throw e;});return promise;};
  }
  return{directRule,subscriptionRule,emspRule,normalizePayload,normalizeIonityExactSnapshot,isIonityExactSnapshot,evseIdentityVariants,createLoader};
});