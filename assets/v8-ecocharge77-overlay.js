// Tesla Charge Companion V8 — Ecocharge77 validated direct-tariff overlay.
(function(){
  'use strict';
  const VERSION='ecocharge77-20260821a';
  const ALIASES=['ecocharge77','ecocharge 77','ecocharge77 sdesm','sdesm ecocharge77'];
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const toMin=v=>{const m=text(v).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN};
  function operatorMatches(st){
    const vals=[st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name].map(norm).filter(Boolean);
    return ALIASES.some(a=>vals.includes(norm(a)));
  }
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(c?.ecocharge77OfferId)continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function classify(cfg){
    if(cfg.kind==='AC'&&cfg.powerKw<=24.5)return 'normal';
    if(cfg.kind==='DC'&&cfg.powerKw>=20&&cfg.powerKw<=30)return 'normal';
    if(cfg.kind==='DC'&&cfg.powerKw>=50&&cfg.powerKw<=130)return 'rapid';
    return '';
  }
  function hasOffer(configs,type,cfg){return(configs||[]).some(c=>c?.ecocharge77OfferId===type&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.25);}
  function addOffers(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!operatorMatches(st))return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      const type=classify(cfg);if(!type||hasOffer([...base,...added],type,cfg))continue;
      const pricing={type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:0,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00',ecocharge77Type:type,ecocharge77EnergyPerKwh:type==='rapid'?0.46:0.36}]};
      added.push({id:`ecocharge77:${type}:${cfg.kind}:${cfg.powerKw}`,label:`Ecocharge77 direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,pricing,offerProvider:'Ecocharge77 direct',offerType:'operator_direct',ecocharge77OfferId:type,regionalSource:'data-lab/ecocharge77_official_idf.json',regionalVerifiedAt:'2026-08-21'});
    }
    if(!added.length)return st;
    return {...st,chargingConfigurations:[...base,...added],_ecocharge77TariffOffers:[...(st._ecocharge77TariffOffers||[]),...added.map(x=>x.ecocharge77OfferId)]};
  }
  function occupiedMinutes(startTime,chargeMinutes,unplugTime){
    if(!unplugTime)return Math.max(0,Number(chargeMinutes||0));
    const s=toMin(startTime),u=toMin(unplugTime);if(!Number.isFinite(s)||!Number.isFinite(u))return Math.max(0,Number(chargeMinutes||0));
    let d=u-s;if(d<0)d+=1440;return Math.max(Number(chargeMinutes||0),d);
  }
  function dayMinutesAfterThreshold(startTime,occ,threshold){
    const s=toMin(startTime);if(!Number.isFinite(s))return 0;
    let total=0;
    for(let elapsed=Math.max(0,Math.floor(threshold));elapsed<Math.floor(occ);elapsed++){
      const clock=(s+elapsed)%1440;if(clock>=480&&clock<1260)total++;
    }
    return total;
  }
  function installPricing(){
    const current=window.priceWithRules;if(typeof current!=='function')return false;if(current.__tccEcocharge77Pricing)return true;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const out=current.apply(this,arguments);if(!out||out.error)return out;
      const rule=(Array.isArray(pp?.rules)?pp.rules:[]).find(r=>r?.ecocharge77Type);if(!rule)return out;
      const type=rule.ecocharge77Type,energy=Math.max(0,Number(billedEnergy||0)),occ=occupiedMinutes(startTime,chargeMinutes,unplugTime);
      const energyCost=energy*Number(rule.ecocharge77EnergyPerKwh||0);
      let timeCost=0;
      if(type==='rapid')timeCost=Math.max(0,occ-60)*0.20;
      else if(type==='normal')timeCost=dayMinutesAfterThreshold(startTime,occ,180)*0.036;
      out.chargeCost=Number(out.chargeCost||0)+energyCost;
      out.durationSurcharge=Number(out.durationSurcharge||0)+timeCost;
      out.total=Number(out.total||0)+energyCost+timeCost;
      out.ecocharge77EnergyCost=energyCost;out.ecocharge77DurationCost=timeCost;return out;
    };
    wrapped.__tccEcocharge77Pricing=true;wrapped.__tccEcocharge77Original=current;window.priceWithRules=wrapped;return true;
  }
  function installCandidates(){
    if(typeof candidateStations!=='function')return false;if(candidateStations.__tccEcocharge77Overlay)return true;
    const original=candidateStations;
    const wrapped=async function(){const result=await original.apply(this,arguments);if(result&&Array.isArray(result.stations)){result.stations=result.stations.map(addOffers);result.ecocharge77TariffOverlayApplied=true;}return result;};
    wrapped.__tccEcocharge77Overlay=true;wrapped.__tccEcocharge77Original=original;candidateStations=wrapped;return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;const a=installPricing(),b=installCandidates();if((a&&b)||tries>200)clearInterval(timer);},50);
  window.TCCV8Ecocharge77Overlay={version:VERSION,addOffers,installPricing,installCandidates};
})();
