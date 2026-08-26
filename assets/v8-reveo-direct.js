// Tesla Charge Companion V8 — Révéo CPO-direct, fail-closed by verified territory.
// Only the Hérault direct grid (outside Montpellier Méditerranée Métropole) is rankable.
(function(){
  'use strict';
  const REVISION='reveo-direct-v1-20260826';
  const DATA_URL='data/reveo_direct_tariffs_france_v1.json';
  const SUBSCRIPTION_ID='reveo-subscription';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const METRO_COMMUNES=[
    'baillargues','beaulieu','castelnau le lez','castries','clapiers','cournonsec','cournonterral','fabregues','grabels','jacou','juvignac','lattes','laverune','le cres','montaud','montferrier sur lez','montpellier','murviel les montpellier','perols','pignan','prades le lez','restinclieres','saint bres','saint drezery','saint genies des mourgues','saint georges d orques','saint jean de vedas','saussan','sussargues','vendargues','villeneuve les maguelone'
  ];
  const UNRESOLVED=['M34','S12','M31','S48','D09','D11','D46','D65','D66'];
  let matrixPromise=null;

  function validateMatrix(data){
    if(data?.schemaVersion!=='1.0.0'||data?.dataset!=='reveo-direct-tariffs-france'||data?.operator!=='Révéo'||data?.country!=='FR')throw new Error('Matrice Révéo inattendue');
    const scope=data?.scope||{};
    if(scope.operatorDirectOnly!==true||scope.roamingIncluded!==false||scope.roamingTariffsPromotedToDirect!==false||scope.unverifiedTerritoriesAreRankable!==false||scope.subscriberOffersRequireSelection!==true)throw new Error('Périmètre Révéo invalide');
    if(JSON.stringify(scope.rankableTerritories)!==JSON.stringify(['S34']))throw new Error('Seul S34 doit être rankable');
    if(!Array.isArray(data?.territories?.S34?.public)||!Array.isArray(data?.territories?.S34?.subscriber))throw new Error('Grille Hérault Révéo absente');
    if(data?.subscription?.selectionId!==SUBSCRIPTION_ID||data?.subscription?.defaultSelected!==false)throw new Error('Abonnement Révéo invalide');
    for(const code of UNRESOLVED){
      const t=data?.territories?.[code];
      if(!t||t.public!==null||t.subscriber!==null)throw new Error(`Territoire Révéo non vérifié rendu calculable: ${code}`);
    }
    return data;
  }

  async function loadMatrix(){
    if(window.TCC_REVE0_DIRECT_MATRIX_V1)return validateMatrix(window.TCC_REVE0_DIRECT_MATRIX_V1);
    if(!matrixPromise)matrixPromise=fetch(`${DATA_URL}?v=${REVISION}`,{cache:'no-store'})
      .then(r=>{if(!r.ok)throw new Error(`Base Révéo indisponible (${r.status})`);return r.json()})
      .then(validateMatrix)
      .then(data=>{window.TCC_REVE0_DIRECT_MATRIX_V1=data;return data})
      .catch(err=>{console.warn('[TCC V8] Base Révéo Direct ignorée :',err?.message||err);return null});
    return matrixPromise;
  }

  function rawCorpus(st){
    return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.networkName,st?.partyId,st?.cpoId,st?.id,st?.catalogStationId,st?.name,st?.address,st?.city,st?.municipality,st?.commune,st?.postalCode,st?.department,st?.departmentCode].map(text).filter(Boolean).join(' | ');
  }
  function operatorCorpus(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.networkName,st?.partyId,st?.cpoId].map(text).filter(Boolean).join(' | ')}
  function isReveoOperator(st){
    const raw=operatorCorpus(st),n=norm(raw);
    return /FR\*?(?:S12|S34|S48|M31)/i.test(raw)||n==='reveo'||n.startsWith('reveo ')||n.includes(' reveo ');
  }
  function departmentOf(st){
    for(const v of [st?.department,st?.departmentCode]){
      const m=text(v).match(/(?:^|\D)(09|11|12|31|34|46|48|65|66)(?:\D|$)/);if(m)return m[1];
    }
    const raw=rawCorpus(st),pc=raw.match(/\b(09|11|12|31|34|46|48|65|66)\d{3}\b/);return pc?pc[1]:'';
  }
  function containsCommune(value){
    const padded=` ${norm(value)} `;
    return METRO_COMMUNES.some(c=>padded.includes(` ${c} `));
  }
  function isMontpellierMetro(st){
    const locality=[st?.city,st?.municipality,st?.commune].map(text).filter(Boolean).join(' ');
    if(locality)return containsCommune(locality);
    return containsCommune([st?.address,st?.name].map(text).join(' '));
  }
  function explicitParty(raw){
    if(/FR\*?S34/i.test(raw))return'S34';if(/FR\*?S12/i.test(raw))return'S12';if(/FR\*?S48/i.test(raw))return'S48';if(/FR\*?M31/i.test(raw))return'M31';return'';
  }
  function territoryForStation(st){
    if(!isReveoOperator(st))return null;
    const raw=rawCorpus(st),dep=departmentOf(st);
    if(dep==='34'&&isMontpellierMetro(st))return'M34';
    const party=explicitParty(raw);if(party)return party;
    if(dep==='34')return'S34';
    if(dep==='12')return'S12';
    if(dep==='31')return'M31';
    if(dep==='48')return'S48';
    if(['09','11','46','65','66'].includes(dep))return`D${dep}`;
    return null;
  }
  function isLongDuration(st){
    const n=norm(rawCorpus(st));
    return n.includes('longue duree')||n.includes('longue utilisation')||n.includes('long duration');
  }

  function physicalGroups(st){
    const source=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls,label:st?.name}];
    const groups=new Map();
    for(const c of source){
      if(c?.reveoDirect===true)continue;
      const kind=text(c?.kind).toUpperCase(),power=Number(c?.powerKw||0);if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(3)}`,stalls=Math.max(0,Number(c?.stalls||0));
      const current=groups.get(key);if(!current||stalls>current.stalls)groups.set(key,{kind,powerKw:power,stalls,label:text(c?.label)});
    }
    return [...groups.values()];
  }
  function bandFor(profile,group,longDuration){
    for(const band of profile||[]){
      if(text(band?.kind).toUpperCase()!==group.kind)continue;
      if(band.longDurationOnly===true&&!longDuration)continue;
      if(band.excludeLongDuration===true&&longDuration)continue;
      const min=Number(band.minPowerKwExclusive||0),max=band.maxPowerKw==null?Infinity:Number(band.maxPowerKw);
      if(group.powerKw<=min||group.powerKw>max)continue;
      return band;
    }
    return null;
  }
  function rule(price,start='00:00',end='24:00',fee=null){
    return {scope:start==='00:00'&&end==='24:00'?'allDay':'timeWindow',start,end,billing:'kwh',currency:'EUR',pricePerKwh:Number(price),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:Number(fee?.ratePerMinute||0),afterMinutesThreshold:Number(fee?.thresholdMinutes||0),afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'};
  }
  function pricingForBand(band){
    const price=Number(band?.pricePerKwh),fee=band?.durationFee||null,w=fee?.activeWindow;
    if(w?.start&&w?.end){
      const rules=[];
      if(w.start!=='00:00')rules.push(rule(price,'00:00',w.start,null));
      rules.push(rule(price,w.start,w.end,fee));
      if(w.end!=='24:00')rules.push(rule(price,w.end,'24:00',null));
      return {type:'rules',rules,reveoExactDirect:true};
    }
    return {type:'rules',rules:[rule(price,'00:00','24:00',fee)],reveoExactDirect:true};
  }
  function providerOf(c){return norm(c?.offerProvider||text(c?.label).split('·')[0])}
  function mergeConfigurations(existing,direct){
    const kept=(existing||[]).filter(c=>!c?.reveoDirect&&providerOf(c)!=='reveo direct'&&providerOf(c)!=='reveo abonne');
    return [...direct,...kept];
  }
  function directConfigurations(st,matrix){
    const territory=territoryForStation(st),t=territory?matrix?.territories?.[territory]:null;
    if(territory!=='S34'||!t||!Array.isArray(t.public))return[];
    const longDuration=isLongDuration(st),groups=physicalGroups(st),out=[];
    for(const g of groups){
      const pub=bandFor(t.public,g,longDuration);if(!pub)continue;
      const suffix=`${g.kind.toLowerCase()}-${String(g.powerKw).replace('.','_')}`;
      out.push({id:`reveo-public-${territory}-${suffix}`,label:`Révéo Direct · ${g.kind} ${g.powerKw} kW`,kind:g.kind,powerKw:g.powerKw,stalls:g.stalls,pricing:pricingForBand(pub),offerProvider:'Révéo Direct',offerType:'operator_direct',reveoDirect:true,reveoVerified:true,reveoTerritory:territory,reveoTariffKey:pub.key});
      const sub=bandFor(t.subscriber,g,longDuration);
      if(sub)out.push({id:`reveo-subscriber-${territory}-${suffix}`,label:`Révéo Abonné · ${g.kind} ${g.powerKw} kW`,kind:g.kind,powerKw:g.powerKw,stalls:g.stalls,pricing:pricingForBand(sub),offerProvider:'Révéo Abonné',offerType:'subscription',subscriptionId:SUBSCRIPTION_ID,subscriptionSelectionId:SUBSCRIPTION_ID,reveoDirect:true,reveoSubscriber:true,reveoVerified:true,reveoTerritory:territory,reveoTariffKey:sub.key});
    }
    return out;
  }
  function mergeStation(st,matrix){
    if(!isReveoOperator(st))return st;
    const territory=territoryForStation(st),t=territory?matrix?.territories?.[territory]:null;
    if(territory!=='S34'||!t||!Array.isArray(t.public))return {...st,reveoPricingStatus:'unresolved',reveoTerritory:territory||'',reveoStrictCpo:true};
    const direct=directConfigurations(st,matrix);
    if(!direct.length)return {...st,reveoPricingStatus:'unresolved_configuration',reveoTerritory:territory,reveoStrictCpo:true};
    const configs=mergeConfigurations(st.chargingConfigurations,direct),first=direct.find(c=>c.offerProvider==='Révéo Direct')||direct[0];
    return {...st,chargingConfigurations:configs,pricing:first.pricing,kind:st.kind||first.kind,powerKw:Number(st.powerKw||first.powerKw),operator:st.operator||'Révéo',reveoPricingStatus:'verified',reveoTerritory:territory,reveoStrictCpo:true,reveoDirectOfferCount:direct.filter(c=>c.offerProvider==='Révéo Direct').length,reveoSubscriberOfferCount:direct.filter(c=>c.reveoSubscriber).length};
  }
  function overlayPrepared(prepared,matrix){
    if(!prepared||!Array.isArray(prepared.stations)||!matrix)return prepared;
    let verified=0,unresolved=0,offers=0;
    prepared.stations=prepared.stations.map(st=>{
      if(!isReveoOperator(st))return st;
      const merged=mergeStation(st,matrix);
      if(merged.reveoPricingStatus==='verified'){verified++;offers+=Number(merged.reveoDirectOfferCount||0)+Number(merged.reveoSubscriberOfferCount||0)}else unresolved++;
      return merged;
    });
    prepared.reveoDirectLoaded=true;
    prepared.reveoMergeStats={verifiedStations:verified,unresolvedStations:unresolved,directOfferRows:offers};
    window.TCC_REVE0_MERGE_STATS={...prepared.reveoMergeStats};
    return prepared;
  }

  function registerSubscriptionPlan(){
    const api=window.TCCV8Subscriptions;if(typeof api?.registerPlan!=='function')return false;
    api.registerPlan({id:SUBSCRIPTION_ID,selectionId:SUBSCRIPTION_ID,provider:'Révéo — Abonnement',offerType:'subscription_direct',monthlyFeeEur:1.5,monthlyFeeLabel:'1,50 €/mois/badge · badge 12 €',defaultSelected:false,operatorAliases:['Révéo','Reveo'],directOperatorOnly:true,source:'https://reveocharge.com/tarifs/'});
    document.dispatchEvent(new CustomEvent('tcc:subscription-plan-registered'));
    return true;
  }
  function installCandidateOverlay(){
    const current=window.candidateStations;if(typeof current!=='function')return false;if(current.__tccReveoDirectV1)return true;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){
      const prepared=await current.call(this,filterMode,maxDistanceKm);if(filterMode!=='all')return prepared;
      const matrix=await loadMatrix();return overlayPrepared(prepared,matrix);
    };
    wrapped.__tccReveoDirectV1=true;wrapped.__tccOriginal=current;window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}return true;
  }
  function boot(){
    installCandidateOverlay();
    if(!registerSubscriptionPlan()){let tries=0;const timer=setInterval(()=>{tries++;if(registerSubscriptionPlan()||tries>=20)clearInterval(timer)},250)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else queueMicrotask(boot);

  window.TCCReveoDirectV8={revision:REVISION,loadMatrix,validateMatrix,isReveoOperator,departmentOf,isMontpellierMetro,territoryForStation,isLongDuration,physicalGroups,bandFor,pricingForBand,directConfigurations,mergeStation,overlayPrepared,registerSubscriptionPlan,installCandidateOverlay,clearCache(){matrixPromise=null;delete window.TCC_REVE0_DIRECT_MATRIX_V1}};
  console.info('[TCC V8] Révéo Direct : Hérault hors Montpellier Métropole calculable; autres territoires fail-closed.');
})();
