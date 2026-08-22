// Tesla Charge Companion V8 RC4.8 — overlay station canonique vérifié.
(function(){
  'use strict';
  const DATA_URL='data/v8_canonical_station_overlay_v1.json';
  const REVISION='rc48an';
  let dataPromise=null;
  const text=v=>String(v==null?'':v).trim();
  const deepClone=v=>JSON.parse(JSON.stringify(v));

  async function loadData(){
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=20260822a`,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`overlay canonique indisponible (${r.status})`);
      return r.json();
    }).then(data=>{
      if(data?.dataset!=='v8-canonical-station-tariff-overlay')throw new Error('overlay canonique invalide');
      if(data?.activeInV73!==false)throw new Error('garde-fou V7.3 absent');
      window.TCC_V8_CANONICAL_STATION_OVERLAY=data;
      return data;
    }).catch(err=>{
      console.warn('[TCC V8] Overlay canonique station non chargé:',err);
      return {stations:[]};
    });
    return dataPromise;
  }

  function physicalConfigs(st){
    const configs=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length
      ?st.chargingConfigurations
      :[{id:'main',label:`${st?.kind||'AC'} ${Number(st?.powerKw||0)} kW`,kind:st?.kind||'AC',powerKw:Number(st?.powerKw||0),stalls:Number(st?.stalls||0),pricing:st?.pricing}];
    const seen=new Set(),out=[];
    for(const c of configs){
      const kind=text(c?.kind||st?.kind||'AC').toUpperCase();
      const power=Number(c?.powerKw??st?.powerKw??0);
      if(!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;
      if(seen.has(key))continue;
      seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }

  function configMatches(cfg,match={}){
    if(match.allPhysical===true)return true;
    if(match.kind&&text(cfg?.kind).toUpperCase()!==text(match.kind).toUpperCase())return false;
    const p=Number(cfg?.powerKw||0);
    if(Number.isFinite(Number(match.powerKw))){
      const tol=Math.max(0,Number(match.toleranceKw||0.5));
      if(Math.abs(p-Number(match.powerKw))>tol)return false;
    }
    if(Number.isFinite(Number(match.minPowerKw))&&p<Number(match.minPowerKw)-1e-9)return false;
    if(Number.isFinite(Number(match.maxPowerKw))&&p>Number(match.maxPowerKw)+1e-9)return false;
    return true;
  }

  function hasCanonicalOffer(configs,offerId,kind,power){
    return (configs||[]).some(c=>c?.canonicalOfferId===offerId&&text(c?.kind).toUpperCase()===kind&&Math.abs(Number(c?.powerKw||0)-power)<.25);
  }

  function applyStation(st,data){
    if(!st||st.source==='teslaSupercharger'||String(st.countryCode||'FR').toUpperCase()!=='FR')return st;
    const id=text(st.catalogStationId||'');
    if(!id)return st;
    const entry=(data?.stations||[]).find(x=>text(x?.catalogStationId)===id);
    if(!entry)return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[];
    const physical=physicalConfigs(st),added=[];
    for(const offer of entry.offers||[]){
      for(const cfg of physical){
        if(!configMatches(cfg,offer.match||{}))continue;
        if(hasCanonicalOffer([...base,...added],offer.id,cfg.kind,cfg.powerKw))continue;
        added.push({
          id:`canonical-station:${offer.id}:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
          label:`${offer.provider} · ${cfg.kind} ${cfg.powerKw} kW`,
          kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,
          pricing:deepClone(offer.pricing||{type:'rules',rules:[]}),
          offerProvider:offer.provider,
          offerType:offer.offerType||'operator_direct',
          canonicalOfferId:offer.id,
          canonicalSourcePath:entry.sourcePath||'',
          canonicalVerified:true,
          canonicalRevision:REVISION
        });
      }
    }
    if(!added.length)return st;
    return {
      ...st,
      chargingConfigurations:[...base,...added],
      _canonicalStationOffers:[...(st._canonicalStationOffers||[]),...added.map(x=>x.canonicalOfferId)],
      _canonicalStationVerified:true
    };
  }

  async function applyToPrepared(result){
    if(!result||!Array.isArray(result.stations))return result;
    const data=await loadData();
    result.stations=result.stations.map(st=>applyStation(st,data));
    result.canonicalStationOverlayApplied=true;
    result.canonicalStationOverlayRevision=REVISION;
    return result;
  }

  function convert(amount,currency){
    if(typeof window.fxToEur==='function')return Number(window.fxToEur(amount,currency||'EUR')||0);
    if(typeof fxToEur==='function')return Number(fxToEur(amount,currency||'EUR')||0);
    return Number(amount||0);
  }

  // Extensions tarifaires utilisées uniquement par les offres V8 canoniques :
  // - minimum de facturation de session ;
  // - frais fixe déclenché après X minutes de charge.
  function installCanonicalPricingExtensions(){
    const current=window.priceWithRules;
    if(typeof current!=='function')return false;
    if(current.__tccCanonicalStationPricingV1)return true;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const out=current.apply(this,arguments);
      if(!out||out.error||!Number.isFinite(Number(out.total)))return out;
      const rules=Array.isArray(pp?.rules)?pp.rules:[];
      if(!rules.length)return out;
      const startRule=typeof window.ruleForMinute==='function'
        ?window.ruleForMinute(rules,Number(startMin||0))
        :(typeof ruleForMinute==='function'?ruleForMinute(rules,Number(startMin||0)):rules[0]);
      if(!startRule)return out;

      const delayedFee=Math.max(0,Number(startRule.delayedConnectionFee||0));
      const delayedAfter=Math.max(0,Number(startRule.delayedConnectionFeeAfterChargeMinutes||0));
      if(delayedFee>0&&Number(chargeMinutes||0)>delayedAfter+1e-9){
        const delta=convert(delayedFee,startRule.currency||'EUR');
        out.total=Number(out.total||0)+delta;
        out.connection=Number(out.connection||0)+delta;
        out.delayedConnectionFee=Number(out.delayedConnectionFee||0)+delta;
      }

      const minimums=rules.map(r=>({value:Number(r?.minimumSessionFee),currency:r?.currency||'EUR'})).filter(x=>Number.isFinite(x.value)&&x.value>0);
      if(minimums.length){
        const minimumEur=Math.max(...minimums.map(x=>convert(x.value,x.currency)));
        if(Number(out.total||0)<minimumEur-1e-9){
          const delta=minimumEur-Number(out.total||0);
          out.total=minimumEur;
          out.minimumSessionAdjustment=Number(out.minimumSessionAdjustment||0)+delta;
        }
      }
      return out;
    };
    wrapped.__tccCanonicalStationPricingV1=true;
    wrapped.__tccOriginal=current;
    window.priceWithRules=wrapped;
    try{priceWithRules=wrapped}catch(e){}
    console.info('[TCC V8] Extensions tarifaires canoniques actives (minimum + frais différé).');
    return true;
  }

  function installStationOverlay(){
    const current=window.candidateStations;
    if(typeof current!=='function')return false;
    if(current.__tccCanonicalStationOverlayV1)return true;
    const wrapped=async function(...args){
      const result=await current.apply(this,args);
      return applyToPrepared(result);
    };
    wrapped.__tccCanonicalStationOverlayV1=true;
    wrapped.__tccOriginal=current;
    window.candidateStations=wrapped;
    try{candidateStations=wrapped}catch(e){}
    console.info('[TCC V8] Overlay station canonique vérifié actif.');
    return true;
  }

  function markRevision(){
    const banner=document.getElementById('tccPreviewBanner');
    if(banner&&/RC4\.8/.test(text(banner.textContent)))banner.textContent=`V8 Preview · RC4.8 · ${REVISION} · multi-tarifs · canonique station · auto-mise à jour désactivée`;
  }

  loadData();
  let tries=0;const timer=setInterval(()=>{
    tries++;
    const a=installCanonicalPricingExtensions(),b=installStationOverlay();
    if((a&&b)||tries>180)clearInterval(timer);
  },100);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(markRevision,0),{once:true});else setTimeout(markRevision,0);

  window.TCCV8CanonicalStationOverlay={loadData,applyStation,applyToPrepared,installCanonicalPricingExtensions,revision:REVISION};
})();
