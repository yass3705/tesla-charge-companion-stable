// Tesla Charge Companion V8 — YAWAY Connect CPO-direct station tariffs.
// Strict scope: verified physical YAWAY Connect sites only; no roaming tariffs.
(function(){
  'use strict';
  const REVISION='yaway-connect-direct-v1-20260826';
  const DATA_URL='data/yaway_connect_direct_tariffs_v1.json';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  let matrixPromise=null;

  function validateMatrix(data){
    if(data?.schemaVersion!=='1.0.0'||data?.dataset!=='yaway-connect-direct-tariffs-france'||data?.operator!=='YAWAY'||data?.country!=='FR')throw new Error('Matrice YAWAY Connect inattendue');
    const s=data?.scope||{};
    if(s.operatorDirectOnly!==true||s.roamingIncluded!==false||s.roamingTariffsPromotedToDirect!==false||s.stationSpecific!==true||s.unverifiedStationsAreRankable!==false)throw new Error('Périmètre YAWAY Connect invalide');
    if(!Array.isArray(data?.stations)||data.stations.length!==5)throw new Error('Les 5 stations YAWAY Connect vérifiées sont requises');
    return data;
  }

  async function loadMatrix(){
    if(window.TCC_YAWAY_CONNECT_DIRECT_MATRIX_V1)return validateMatrix(window.TCC_YAWAY_CONNECT_DIRECT_MATRIX_V1);
    if(!matrixPromise)matrixPromise=fetch(`${DATA_URL}?v=${REVISION}`,{cache:'no-store'})
      .then(r=>{if(!r.ok)throw new Error(`Base YAWAY Connect indisponible (${r.status})`);return r.json()})
      .then(validateMatrix)
      .then(data=>{window.TCC_YAWAY_CONNECT_DIRECT_MATRIX_V1=data;return data})
      .catch(err=>{console.warn('[TCC V8] Base YAWAY Connect ignorée :',err?.message||err);return null});
    return matrixPromise;
  }

  function corpus(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.networkName,st?.partyId,st?.cpoId,st?.id,st?.catalogStationId,st?.name,st?.address,st?._sourceAddress,st?.city,st?.municipality,st?.commune,st?.postalCode].map(text).filter(Boolean).join(' | ')}
  function operatorCorpus(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.networkName,st?.partyId,st?.cpoId,st?.id,st?.catalogStationId].map(text).filter(Boolean).join(' | ')}
  function isYawayOperator(st){
    const raw=operatorCorpus(st),n=norm(raw);
    return /FR\*?YAW/i.test(raw)||/FRYAWE/i.test(raw)||n==='yaway'||n.startsWith('yaway ')||n.includes(' yaway ')||n.includes('yaway connect');
  }

  function siteKey(st){
    if(!isYawayOperator(st))return'';
    const n=norm(corpus(st));
    if(n.includes('douains')||n.includes('escadron des cracks'))return'douains';
    if(n.includes('pont l eveque')||n.includes('rue marie curie'))return'pont-l-eveque';
    if(n.includes('bretteville sur odon')||n.includes('philippe livry level'))return'bretteville-sur-odon';
    if(n.includes('rambouillet')||n.includes('rue de clairefontaine'))return'rambouillet';
    if(n.includes('etrelles'))return'etrelles';
    return'';
  }

  function physicalGroups(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls,label:st?.name}];
    const groups=new Map();
    for(const c of src){
      if(c?.yawayConnectDirect===true)continue;
      const kind=text(c?.kind||st?.kind).toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(3)}`,stalls=Math.max(0,Number(c?.stalls||st?.stalls||0));
      const prev=groups.get(key);if(!prev||stalls>prev.stalls)groups.set(key,{kind,powerKw:power,stalls});
    }
    return [...groups.values()];
  }
  function pricing(price){return {type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(price),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}],yawayConnectExactDirect:true}}
  function providerOf(c){return norm(c?.offerProvider||text(c?.label).split('·')[0])}
  function mergeConfigurations(existing,direct){
    const kept=(existing||[]).filter(c=>!c?.yawayConnectDirect&&providerOf(c)!=='yaway connect direct');
    return [...direct,...kept];
  }
  function directConfigurations(st,site){
    const groups=physicalGroups(st),out=[];
    for(const g of groups){
      const suffix=`${g.kind.toLowerCase()}-${String(g.powerKw).replace('.','_')}`;
      out.push({id:`yaway-connect-${site.key}-${suffix}`,label:`YAWAY Connect Direct · ${g.kind} ${g.powerKw} kW`,kind:g.kind,powerKw:g.powerKw,stalls:g.stalls,pricing:pricing(site.pricePerKwh),offerProvider:'YAWAY Connect Direct',offerType:'operator_direct',yawayConnectDirect:true,yawayConnectVerified:true,yawayConnectSiteKey:site.key,yawayConnectVerifiedAt:site.verifiedAt||'',yawayConnectSource:site.source||''});
    }
    return out;
  }
  function mergeStation(st,matrix){
    if(!isYawayOperator(st))return st;
    const key=siteKey(st);if(!key)return {...st,yawayConnectPricingStatus:'unresolved',yawayConnectStrictCpo:true};
    const site=matrix?.stations?.find(x=>x.key===key);if(!site||!Number.isFinite(Number(site.pricePerKwh)))return {...st,yawayConnectPricingStatus:'unresolved',yawayConnectSiteKey:key,yawayConnectStrictCpo:true};
    const direct=directConfigurations(st,site);if(!direct.length)return {...st,yawayConnectPricingStatus:'unresolved_configuration',yawayConnectSiteKey:key,yawayConnectStrictCpo:true};
    const configs=mergeConfigurations(st.chargingConfigurations,direct),first=direct[0];
    return {...st,chargingConfigurations:configs,pricing:first.pricing,operator:st.operator||'YAWAY',yawayConnectPricingStatus:'verified',yawayConnectSiteKey:key,yawayConnectStrictCpo:true,yawayConnectDirectOfferCount:direct.length};
  }
  function overlayPrepared(prepared,matrix){
    if(!prepared||!Array.isArray(prepared.stations)||!matrix)return prepared;
    let verified=0,unresolved=0,offers=0;
    prepared.stations=prepared.stations.map(st=>{
      if(!isYawayOperator(st))return st;
      const merged=mergeStation(st,matrix);
      if(merged.yawayConnectPricingStatus==='verified'){verified++;offers+=Number(merged.yawayConnectDirectOfferCount||0)}else unresolved++;
      return merged;
    });
    prepared.yawayConnectDirectLoaded=true;
    prepared.yawayConnectMergeStats={verifiedStations:verified,unresolvedStations:unresolved,directOfferRows:offers};
    window.TCC_YAWAY_CONNECT_MERGE_STATS={...prepared.yawayConnectMergeStats};
    return prepared;
  }
  function installCandidateOverlay(){
    const current=window.candidateStations;if(typeof current!=='function')return false;if(current.__tccYawayConnectDirectV1)return true;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){
      const prepared=await current.call(this,filterMode,maxDistanceKm);if(filterMode!=='all')return prepared;
      const matrix=await loadMatrix();return overlayPrepared(prepared,matrix);
    };
    wrapped.__tccYawayConnectDirectV1=true;wrapped.__tccOriginal=current;window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}return true;
  }
  function boot(){installCandidateOverlay()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else queueMicrotask(boot);

  window.TCCYawayConnectDirectV8={revision:REVISION,loadMatrix,validateMatrix,isYawayOperator,siteKey,physicalGroups,directConfigurations,mergeStation,overlayPrepared,installCandidateOverlay,clearCache(){matrixPromise=null;delete window.TCC_YAWAY_CONNECT_DIRECT_MATRIX_V1}};
  console.info('[TCC V8] YAWAY Connect Direct : 5 sites vérifiés, itinérance exclue.');
})();
