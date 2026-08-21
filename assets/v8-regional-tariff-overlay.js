// Tesla Charge Companion V8 RC4.8 — overlay tarifs régionaux validés.
(function(){
  'use strict';
  const DATA_URL='data/regional_tariff_overlay_v1.json';
  const VERSION='rc48am-regional-2';
  let dataPromise=null;
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  async function loadData(){
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=20260821m2`,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`overlay régional indisponible (${r.status})`);
      return r.json();
    }).then(d=>{window.TCC_REGIONAL_TARIFF_OVERLAY_V1=d;return d;}).catch(err=>{
      console.warn('[TCC V8] Overlay régional non chargé:',err);return{offers:[],deferred:[]};
    });
    return dataPromise;
  }
  function operatorCandidates(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name].map(norm).filter(Boolean);}
  function operatorMatches(st,offer){const vals=operatorCandidates(st);return (offer?.operatorAliases||[]).some(a=>vals.includes(norm(a)));}
  function providerOf(c){
    if(c?.offerProvider)return text(c.offerProvider);
    const s=text(c?.label||c?.configurationLabel),i=s.indexOf('·');return(i>=0?s.slice(0,i):s).trim();
  }
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(c?.regionalOfferId)continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function offerMatchesConfig(offer,cfg){
    if(offer?.kind&&text(offer.kind).toUpperCase()!==cfg.kind)return false;
    if(Number.isFinite(Number(offer?.targetPowerKw))){
      const tol=Math.max(0,Number(offer?.powerToleranceKw||0.25));
      if(Math.abs(cfg.powerKw-Number(offer.targetPowerKw))>tol)return false;
    }
    if(Number.isFinite(Number(offer?.minPowerKw))&&cfg.powerKw<Number(offer.minPowerKw)-1e-9)return false;
    if(Number.isFinite(Number(offer?.maxPowerKw))&&cfg.powerKw>Number(offer.maxPowerKw)+1e-9)return false;
    return true;
  }
  function offerMatchesStation(st,offer,physical){
    const location=norm(`${text(st?.name)} ${text(st?.address)} ${text(st?._sourceAddress)}`);
    const include=Array.isArray(offer?.addressContainsAny)?offer.addressContainsAny.map(norm).filter(Boolean):[];
    if(include.length&&!include.some(v=>location.includes(v)))return false;
    const exclude=Array.isArray(offer?.excludeAddressContainsAny)?offer.excludeAddressContainsAny.map(norm).filter(Boolean):[];
    if(exclude.some(v=>location.includes(v)))return false;
    const maxPower=Math.max(0,...physical.map(c=>Number(c.powerKw||0)));
    if(Number.isFinite(Number(offer?.requiresSitePowerGteKw))&&maxPower<Number(offer.requiresSitePowerGteKw)-1e-9)return false;
    if(Number.isFinite(Number(offer?.excludeIfSiteHasPowerGteKw))&&maxPower>=Number(offer.excludeIfSiteHasPowerGteKw)-1e-9)return false;
    return true;
  }
  function hasProvider(configs,provider,cfg){return(configs||[]).some(c=>norm(providerOf(c))===norm(provider)&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.25);}
  function addOffers(st,data){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR')return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[],physical=physicalConfigs(st);
    for(const offer of data?.offers||[]){
      if(!operatorMatches(st,offer)||!offerMatchesStation(st,offer,physical))continue;
      for(const cfg of physical){
        if(!offerMatchesConfig(offer,cfg)||hasProvider([...base,...added],offer.provider,cfg))continue;
        added.push({
          id:`regional-overlay:${offer.id}:${cfg.kind}:${cfg.powerKw}`,
          label:`${offer.provider} · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,
          pricing:JSON.parse(JSON.stringify(offer.pricing||{type:'rules',rules:[]})),offerProvider:offer.provider,
          offerType:offer.offerType||'operator_direct',regionalOfferId:offer.id,regionalSource:offer.source||'',regionalVerifiedAt:offer.verifiedAt||''
        });
      }
    }
    if(!added.length)return st;
    return {...st,chargingConfigurations:[...base,...added],_regionalTariffOffers:[...(st._regionalTariffOffers||[]),...added.map(x=>x.regionalOfferId)]};
  }

  function occupiedMinutes(startTime,chargeMinutes,unplugTime){
    if(!unplugTime)return chargeMinutes;
    const toMin=v=>{const m=text(v).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN};
    const s=toMin(startTime),u=toMin(unplugTime);if(!Number.isFinite(s)||!Number.isFinite(u))return chargeMinutes;
    let d=u-s;if(d<0)d+=1440;return Math.max(chargeMinutes,d);
  }
  function installRegionalPricing(){
    const current=window.priceWithRules;if(typeof current!=='function')return false;
    if(current.__tccRegionalPricingV1)return true;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const out=current.apply(this,arguments);if(!out||out.error)return out;
      const rules=Array.isArray(pp?.rules)?pp.rules:[];if(!rules.length)return out;
      const regional=rules.find(r=>Number(r?.regionalEnergyPerKwh||0)>0||Number(r?.regionalLongPerMinute||0)>0);
      if(!regional)return out;
      let energyExtra=0,longExtra=0;
      const energyRate=Number(regional.regionalEnergyPerKwh||0);
      if(energyRate>0)energyExtra=energyRate*Math.max(0,Number(billedEnergy||0));
      const occ=occupiedMinutes(startTime,Number(chargeMinutes||0),unplugTime),threshold=Number(regional.regionalLongAfterMinutes||0),rate=Number(regional.regionalLongPerMinute||0);
      if(rate>0&&threshold>=0)longExtra=Math.max(0,occ-threshold)*rate;
      out.chargeCost=Number(out.chargeCost||0)+energyExtra;
      out.durationSurcharge=Number(out.durationSurcharge||0)+longExtra;
      out.total=Number(out.total||0)+energyExtra+longExtra;
      out.regionalEnergyCost=energyExtra;out.regionalLongConnectionCost=longExtra;
      return out;
    };
    wrapped.__tccRegionalPricingV1=true;wrapped.__tccRegionalOriginal=current;window.priceWithRules=wrapped;return true;
  }
  function installCandidateOverlay(){
    if(typeof candidateStations!=='function')return false;
    if(candidateStations.__tccRegionalOverlayV1)return true;
    const original=candidateStations;
    const wrapped=async function(){
      const result=await original.apply(this,arguments);if(!result||!Array.isArray(result.stations))return result;
      const data=await loadData();result.stations=result.stations.map(st=>addOffers(st,data));result.regionalTariffOverlayApplied=true;return result;
    };
    wrapped.__tccRegionalOverlayV1=true;wrapped.__tccRegionalOriginal=original;candidateStations=wrapped;return true;
  }
  loadData();
  let tries=0;const timer=setInterval(()=>{tries++;const a=installRegionalPricing(),b=installCandidateOverlay();if((a&&b)||tries>200)clearInterval(timer);},50);
  window.TCCV8RegionalTariffOverlay={version:VERSION,loadData,addOffers,installRegionalPricing,installCandidateOverlay};
})();
