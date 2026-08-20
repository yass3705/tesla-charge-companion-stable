// Tesla Charge Companion V8 RC4.8 — overlay tarifs opérateur directs.
(function(){
  'use strict';
  const OVERLAY_URL='data/tariff_overlay_v1.json';
  const REVISION='rc48ae';
  let overlayPromise=null;
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  async function loadOverlay(){
    if(!overlayPromise)overlayPromise=fetch(`${OVERLAY_URL}?v=20260820h`,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`overlay tarifs indisponible (${r.status})`);
      return r.json();
    }).then(data=>{
      window.TCC_TARIFF_OVERLAY_V1=data;
      return data;
    }).catch(err=>{
      console.warn('[TCC V8] Overlay tarifs opérateur non chargé:',err);
      return {operatorOffers:[],subscriptions:[]};
    });
    return overlayPromise;
  }

  function operatorCandidates(st){
    return [st?.operator,st?._sourceOperator,st?.name].map(norm).filter(Boolean);
  }
  function isSigeifOperator(st){
    return operatorCandidates(st).some(v=>v==='sigeif'||v.includes('sigeif')||v.includes('syndicat intercommunal pour le gaz et l electricite en idf'));
  }
  function isPlenitudeOperator(st){
    return operatorCandidates(st).some(v=>v==='be charge'||v.includes('plenitude')||v.includes('plentitude'));
  }
  function operatorMatches(st,offer){
    const values=operatorCandidates(st),id=String(offer?.id||'');
    if(id.startsWith('sigeif-')&&isSigeifOperator(st))return true;
    if(id.startsWith('plenitude-')&&isPlenitudeOperator(st))return true;
    return (offer?.operatorAliases||[]).some(alias=>values.includes(norm(alias)));
  }
  function powerMatches(kind,power,offer){
    if(offer?.kind&&text(kind).toUpperCase()!==text(offer.kind).toUpperCase())return false;
    const p=Number(power||0),min=Number(offer?.minPowerKw),max=Number(offer?.maxPowerKw);
    if(Number.isFinite(min)&&p<min-1e-9)return false;
    if(Number.isFinite(max)&&p>max+1e-9)return false;
    return true;
  }
  function providerOfConfig(c){
    const label=text(c?.label||c?.configurationLabel);
    const i=label.indexOf('·');
    return (i>=0?label.slice(0,i):label).trim();
  }
  function providerLabel(offer){return String(offer?.id||'').startsWith('sigeif-')?'SIGEIF / IZIVIA direct':offer?.provider;}

  function physicalConfigs(st){
    const configs=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{id:'main',label:`${st?.kind||'AC'} ${Number(st?.powerKw||0)} kW`,kind:st?.kind||'AC',powerKw:Number(st?.powerKw||0),stalls:Number(st?.stalls||0),pricing:st?.pricing}];
    const seen=new Set(),out=[];
    for(const c of configs){
      const kind=text(c?.kind||st?.kind||'AC').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;
      if(seen.has(key))continue;
      seen.add(key);out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function hasProvider(configs,provider,kind,power){
    const p=norm(provider);
    return (configs||[]).some(c=>norm(providerOfConfig(c))===p&&text(c?.kind).toUpperCase()===kind&&Math.abs(Number(c?.powerKw||0)-power)<.25);
  }
  function addOperatorOffers(st,overlay){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR')return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[];
    const physical=physicalConfigs(st),added=[];
    for(const offer of overlay?.operatorOffers||[]){
      if(!operatorMatches(st,offer))continue;
      const provider=providerLabel(offer);
      for(const cfg of physical){
        if(!powerMatches(cfg.kind,cfg.powerKw,offer))continue;
        if(hasProvider([...base,...added],provider,cfg.kind,cfg.powerKw))continue;
        added.push({
          id:`tariff-overlay:${offer.id}:${cfg.kind}:${cfg.powerKw}`,
          label:`${provider} · ${cfg.kind} ${cfg.powerKw} kW`,
          kind:cfg.kind,
          powerKw:cfg.powerKw,
          stalls:cfg.stalls,
          pricing:JSON.parse(JSON.stringify(offer.pricing||{type:'rules',rules:[]})),
          offerProvider:provider,
          offerType:offer.offerType||'operator_direct',
          overlayOfferId:offer.id,
          overlaySource:offer.source||''
        });
      }
    }
    if(!added.length)return st;
    return {...st,chargingConfigurations:[...base,...added],_tariffOverlayOffers:[...(st._tariffOverlayOffers||[]),...added.map(x=>x.overlayOfferId)]};
  }

  async function applyToPrepared(result){
    if(!result||!Array.isArray(result.stations))return result;
    const overlay=await loadOverlay();
    result.stations=result.stations.map(st=>addOperatorOffers(st,overlay));
    result.tariffOverlayApplied=true;
    result.tariffOverlayAppliedAt=Date.now();
    return result;
  }

  // Extension minimale du moteur de règles : certains CPO (ex. Plenitude)
  // accordent une franchise qui commence à la FIN de la charge, et non au début
  // de la session. Les champs historiques afterMinutes* restent inchangés.
  function installPostChargePricing(){
    const current=window.priceWithRules;
    if(typeof current!=='function')return false;
    if(current.__tccPostChargeGrace)return true;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const out=current.apply(this,arguments);
      const rules=Array.isArray(pp?.rules)?pp.rules:[];
      if(!out||out.error||!rules.some(r=>Number(r?.postChargeRate||0)>0))return out;
      const occupied=Number(out.occupiedMinutes),charge=Math.max(0,Number(chargeMinutes||0));
      if(!(occupied>charge))return out;
      const graceValues=rules.map(r=>Number(r?.postChargeGraceMinutes)).filter(Number.isFinite);
      const grace=graceValues.length?Math.max(0,Math.max(...graceValues)):0;
      const exposureStart=charge+grace,exposureEnd=occupied;
      if(!(exposureEnd>exposureStart))return out;
      let extra=0;
      for(let i=Math.floor(exposureStart);i<Math.ceil(exposureEnd);i++){
        const a=Math.max(exposureStart,i),b=Math.min(exposureEnd,i+1),fraction=Math.max(0,b-a);
        if(!(fraction>0))continue;
        const sessionMinute=a;
        const localMinute=((Number(startMin||0)+sessionMinute)%1440+1440)%1440;
        const rule=typeof window.ruleForMinute==='function'?window.ruleForMinute(rules,localMinute):(typeof ruleForMinute==='function'?ruleForMinute(rules,localMinute):null);
        if(!rule)continue;
        const rate=Math.max(0,Number(rule.postChargeRate||0));
        if(!(rate>0))continue;
        const currency=rule.currency||'EUR',raw=rate*fraction;
        const converted=typeof window.fxToEur==='function'?window.fxToEur(raw,currency):(typeof fxToEur==='function'?fxToEur(raw,currency):raw);
        extra+=Number(converted||0);
      }
      if(extra>0){
        out.total=Number(out.total||0)+extra;
        out.idleCost=Number(out.idleCost||0)+extra;
        out.postChargeCost=Number(out.postChargeCost||0)+extra;
      }
      return out;
    };
    wrapped.__tccPostChargeGrace=true;
    wrapped.__tccOriginal=current;
    window.priceWithRules=wrapped;
    try{priceWithRules=wrapped}catch(e){}
    console.info('[TCC V8] Frais après fin de charge avec franchise actifs.');
    return true;
  }

  function install(){
    installPostChargePricing();
    const current=window.candidateStations;
    if(typeof current!=='function')return false;
    if(current.__tccOperatorOverlay)return true;
    const wrapped=async function(...args){
      const result=await current.apply(this,args);
      return applyToPrepared(result);
    };
    wrapped.__tccOperatorOverlay=true;wrapped.__tccOriginal=current;
    window.candidateStations=wrapped;
    try{candidateStations=wrapped}catch(e){}
    console.info('[TCC V8] Overlay opérateur direct V1 actif.');
    return true;
  }

  function markRevision(){
    const banner=document.getElementById('tccPreviewBanner');
    if(banner&&/RC4\.8/.test(text(banner.textContent))){banner.textContent=`V8 Preview · RC4.8 · ${REVISION} · multi-tarifs · auto-mise à jour désactivée`;}
  }

  loadOverlay();
  let tries=0;const timer=setInterval(()=>{tries++;const a=install(),b=installPostChargePricing();if((a&&b)||tries>160)clearInterval(timer);},100);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(markRevision,0),{once:true});else setTimeout(markRevision,0);
  window.TCCV8OperatorOverlay={loadOverlay,addOperatorOffers,applyToPrepared,isSigeifOperator,isPlenitudeOperator,installPostChargePricing,revision:REVISION};
})();
