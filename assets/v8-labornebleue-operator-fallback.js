// Tesla Charge Companion V8 RC4.8 — garde-fou tarifaire La Borne Bleue.
// Applique la grille officielle uniquement aux stations dont le CPO physique est
// explicitement La Borne Bleue. Les réseaux partenaires restent exclus.
(function(){
  'use strict';
  const REVISION='rc48bm-lbb-runtime-guard';
  const SUBSCRIPTION_ID='labornebleue-annual';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));

  function explicitPhysicalLbb(st){
    if(st?.labornebleueStrictCpo===true)return true;
    const values=[st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.sourceNetworkLabel,st?.physicalOperator,st?.displayOperator,st?.canonicalOperator,st?.operatorName].map(norm).filter(Boolean);
    return values.some(v=>v==='la borne bleue'||v==='labornebleue');
  }

  function exactPublic(kind,power){
    if(kind==='DC'&&power>50)return{model:'kwh_plus_elapsed',currency:'EUR',pricePerKwh:.50,afterMinutes:30,afterRatePerMinute:.20};
    if(kind!=='AC')return null;
    if(power>=3.7&&power<=7.4)return{model:'time_windows',currency:'EUR',windows:[{start:'08:00',end:'20:00',ratePerMinute:4.50/60},{start:'20:00',end:'08:00',ratePerMinute:3.50/60}]};
    if(power<=22.1)return{model:'per_minute',currency:'EUR',ratePerMinute:6.50/60};
    return{model:'per_minute',currency:'EUR',ratePerMinute:12/60};
  }
  function exactSubscriber(kind,power){
    if(kind==='DC'&&power>50)return{model:'kwh_plus_elapsed',currency:'EUR',pricePerKwh:.45,afterMinutes:30,afterRatePerMinute:.20};
    if(kind!=='AC')return null;
    if(power>=3.7&&power<=7.4)return{model:'time_windows',currency:'EUR',windows:[{start:'08:00',end:'20:00',ratePerMinute:3.50/60},{start:'20:00',end:'08:00',ratePerMinute:2.50/60,capEur:12}]};
    if(power<=22.1)return{model:'time_windows',currency:'EUR',windows:[{start:'08:00',end:'20:00',ratePerMinute:5.50/60},{start:'20:00',end:'08:00',ratePerMinute:5.50/60,capEur:12}]};
    return{model:'per_minute',currency:'EUR',ratePerMinute:11/60};
  }
  function runtimePricing(exact){
    if(exact.model==='kwh_plus_elapsed')return{type:'rules',labornebleueExact:clone(exact),rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:exact.pricePerKwh,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:exact.afterRatePerMinute,afterMinutesThreshold:exact.afterMinutes,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'}]};
    const windows=exact.windows||[{start:'00:00',end:'24:00',ratePerMinute:exact.ratePerMinute}];
    return{type:'rules',labornebleueExact:clone(exact),rules:windows.map(w=>({scope:windows.length>1?'timeWindow':'allDay',start:w.start,end:w.end,billing:'minute',currency:'EUR',pricePerKwh:0,chargePerMinute:w.ratePerMinute,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'}))};
  }

  function physicalConfigurations(st){
    const source=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls}];
    const out=[],seen=new Set();
    for(const c of source){
      const kind=text(c?.kind||st?.kind).toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||1)});
    }
    return out;
  }
  function planForConfig(c){
    const provider=norm(c?.offerProvider||c?.label||c?.configurationLabel);
    if(text(c?.subscriptionId)===SUBSCRIPTION_ID||provider.includes('abonne'))return'subscriber';
    return'public';
  }
  function isLbbDirectProvider(c){
    if(c?.labornebleueDirect===true)return true;
    return norm(c?.offerProvider||c?.label||c?.configurationLabel).startsWith('la borne bleue direct');
  }
  function isCalculableLbbDirect(c,kind,power,subscriber){
    if(text(c?.kind).toUpperCase()!==kind||Math.abs(Number(c?.powerKw||0)-power)>.25)return false;
    if(!isLbbDirectProvider(c)||planForConfig(c)!==(subscriber?'subscriber':'public'))return false;
    if(c?.labornebleueDirect!==true||c?.labornebleueVerified!==true)return false;
    return !!c?.pricing?.labornebleueExact;
  }
  function keepBaseConfig(c){
    if(!isLbbDirectProvider(c))return true;
    return c?.labornebleueDirect===true&&c?.labornebleueVerified===true&&!!c?.pricing?.labornebleueExact;
  }
  function powerLabel(power){return Number.isInteger(Number(power))?String(Number(power)):String(Number(power)).replace(/0+$/,'').replace(/\.$/,'')}
  function makeConfig(st,cfg,subscriber){
    const exact=(subscriber?exactSubscriber:exactPublic)(cfg.kind,cfg.powerKw);if(!exact)return null;
    const provider=subscriber?'La Borne Bleue direct — Abonné':'La Borne Bleue direct';
    return{
      id:`lbb-explicit:${text(st?.baseStationId||st?.catalogStationId||st?.id||'station')}:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}:${subscriber?'subscriber':'public'}`,
      label:`${provider} · ${cfg.kind} ${powerLabel(cfg.powerKw)} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:Math.max(1,cfg.stalls||1),
      pricing:runtimePricing(exact),offerProvider:provider,offerType:'operator_direct',subscriptionId:subscriber?SUBSCRIPTION_ID:null,
      labornebleueDirect:true,labornebleueVerified:true,labornebleueOwnNetworkOnly:true,labornebleueExplicitOperatorFallback:true,labornebleueFallbackRevision:REVISION
    };
  }
  function addDirect(st){
    if(!st||st.source==='teslaSupercharger'||String(st.countryCode||'FR').toUpperCase()!=='FR'||!explicitPhysicalLbb(st))return st;
    const raw=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(clone):[];
    const physical=physicalConfigurations({...st,chargingConfigurations:raw});
    const base=raw.filter(keepBaseConfig),added=[];
    for(const cfg of physical){
      if(!exactPublic(cfg.kind,cfg.powerKw)||!exactSubscriber(cfg.kind,cfg.powerKw))continue;
      if(!base.some(c=>isCalculableLbbDirect(c,cfg.kind,cfg.powerKw,false))&&!added.some(c=>isCalculableLbbDirect(c,cfg.kind,cfg.powerKw,false)))added.push(makeConfig(st,cfg,false));
      if(!base.some(c=>isCalculableLbbDirect(c,cfg.kind,cfg.powerKw,true))&&!added.some(c=>isCalculableLbbDirect(c,cfg.kind,cfg.powerKw,true)))added.push(makeConfig(st,cfg,true));
    }
    if(!added.length&&base.length===raw.length)return st;
    return{...st,operator:'La Borne Bleue',chargingConfigurations:[...base,...added],_labornebleueExplicitFallback:true,_labornebleueExplicitFallbackRevision:REVISION};
  }

  function applyToPrepared(result){
    if(!result||!Array.isArray(result.stations))return result;
    result.stations=result.stations.map(addDirect);
    result.labornebleueExplicitFallbackApplied=true;
    result.labornebleueExplicitFallbackRevision=REVISION;
    return result;
  }
  function installCandidate(){
    const current=window.candidateStations;if(typeof current!=='function')return false;
    if(current.__tccLbbExplicitCandidateV2)return true;
    const wrapped=async function(...args){return applyToPrepared(await current.apply(this,args));};
    wrapped.__tccLbbExplicitCandidateV2=true;wrapped.__tccOriginal=current;
    window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}
    return true;
  }
  function installExpansion(){
    const current=window.expandConfigurations;if(typeof current!=='function')return false;
    if(current.__tccLbbExplicitExpansionV2)return true;
    const wrapped=function(baseStations){const source=Array.isArray(baseStations)?baseStations.map(addDirect):baseStations;return current.call(this,source)};
    for(const key of ['__tccOverlayExpansionGuard','__tccDirectResolverPowerV1','__tccDirectSmokeFix','__tccSubscriptionStabilityV1'])if(current[key])wrapped[key]=current[key];
    wrapped.__tccLbbExplicitExpansionV2=true;wrapped.__tccOriginal=current;
    window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}
    return true;
  }
  function ensureInstalled(){
    try{window.TCCV8LaBorneBleueDirect?.installPricing?.()}catch(e){}
    const a=installCandidate(),b=installExpansion();return a&&b;
  }

  let tries=0;const timer=setInterval(()=>{tries++;ensureInstalled();if(tries>1600)clearInterval(timer)},75);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(ensureInstalled,0),{once:true});else setTimeout(ensureInstalled,0);
  window.TCCV8LaBorneBleueExplicitFallback={revision:REVISION,explicitPhysicalLbb,exactPublic,exactSubscriber,runtimePricing,addDirect,applyToPrepared,installCandidate,installExpansion,ensureInstalled};
  console.info('[TCC V8] Garde-fou La Borne Bleue actif avant candidateStations + expandConfigurations.');
})();
