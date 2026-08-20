// Tesla Charge Companion V8 RC4.8 — overlay tarifs opérateur directs.
(function(){
  'use strict';
  const OVERLAY_URL='data/tariff_overlay_v1.json';
  let overlayPromise=null;
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  async function loadOverlay(){
    if(!overlayPromise)overlayPromise=fetch(`${OVERLAY_URL}?v=20260820a`,{cache:'no-store'}).then(r=>{
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

  function operatorMatches(st,offer){
    const op=norm(st?.operator);
    return (offer?.operatorAliases||[]).some(alias=>op===norm(alias));
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
      for(const cfg of physical){
        if(!powerMatches(cfg.kind,cfg.powerKw,offer))continue;
        if(hasProvider([...base,...added],offer.provider,cfg.kind,cfg.powerKw))continue;
        added.push({
          id:`tariff-overlay:${offer.id}:${cfg.kind}:${cfg.powerKw}`,
          label:`${offer.provider} · ${cfg.kind} ${cfg.powerKw} kW`,
          kind:cfg.kind,
          powerKw:cfg.powerKw,
          stalls:cfg.stalls,
          pricing:JSON.parse(JSON.stringify(offer.pricing||{type:'rules',rules:[]})),
          offerProvider:offer.provider,
          offerType:offer.offerType||'operator_direct',
          overlayOfferId:offer.id,
          overlaySource:offer.source||''
        });
      }
    }
    if(!added.length)return st;
    const merged=[...base,...added];
    return {...st,chargingConfigurations:merged,_tariffOverlayOffers:added.map(x=>x.overlayOfferId)};
  }

  function install(){
    const current=window.candidateStations;
    if(typeof current!=='function'||current.__tccOperatorOverlay)return false;
    const wrapped=async function(...args){
      const [result,overlay]=await Promise.all([current.apply(this,args),loadOverlay()]);
      if(Array.isArray(result?.stations))result.stations=result.stations.map(st=>addOperatorOffers(st,overlay));
      return result;
    };
    wrapped.__tccOperatorOverlay=true;wrapped.__tccOriginal=current;
    window.candidateStations=wrapped;
    try{candidateStations=wrapped}catch(e){}
    console.info('[TCC V8] Overlay opérateur direct V1 actif.');
    return true;
  }

  loadOverlay();
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>120)clearInterval(timer);},100);
  window.TCCV8OperatorOverlay={loadOverlay,addOperatorOffers};
})();
