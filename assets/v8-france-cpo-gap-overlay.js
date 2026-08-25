// Tesla Charge Companion V8 RC4.8 — compléments CPO directs France vérifiés le 25/08/2026.
// Périmètre strict : opérateur physique / réseau direct uniquement, aucune itinérance.
(function(){
  'use strict';
  const REVISION='rc48bt-fr-cpo-gap-20260825';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));

  function values(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name,st?.address,st?._sourceAddress,st?.city,st?.postalCode].map(norm).filter(Boolean)}
  function joined(st){return values(st).join(' ')}
  function hasAlias(st,aliases){const vals=values(st),wanted=aliases.map(norm);return vals.some(v=>wanted.some(a=>v===a||v.includes(a)||a.includes(v)))}
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(c?.frCpoGapOfferId)continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function providerOf(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function hasProvider(configs,provider,cfg){const p=norm(provider);return(configs||[]).some(c=>providerOf(c)===p&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.25)}
  function rule(pricePerKwh,{connectionFee=0,afterMinutesRate=0,afterMinutesThreshold=0,afterMinutesCap=0,start='00:00',end='24:00'}={}){
    return {scope:start==='00:00'&&end==='24:00'?'allDay':'timeWindow',start,end,billing:'kwh',currency:'EUR',pricePerKwh,chargePerMinute:0,connectionFee,idlePerMinute:0,afterMinutesRate,afterMinutesThreshold,afterMinutesCap,afterMinutesCapStart:start,afterMinutesCapEnd:end};
  }
  function addOffer(st,provider,offerId,cfg,rules,meta={}){
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[];
    if(hasProvider(base,provider,cfg))return st;
    const added={
      id:`fr-cpo-gap:${offerId}:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
      label:`${provider} · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,
      pricing:{type:'rules',rules:clone(rules)},offerProvider:provider,offerType:meta.offerType||'operator_direct',
      frCpoGapOfferId:offerId,frCpoGapVerifiedAt:'2026-08-25',frCpoGapScope:meta.scope||'direct_physical_operator_only',frCpoGapSource:meta.source||''
    };
    return {...st,chargingConfigurations:[...base,added],_frCpoGapOffers:[...(st._frCpoGapOffers||[]),offerId]};
  }

  // Charge E-Lec : prix national officiel des points standards 22 kW depuis le 09/07/2026.
  function addChargeELec(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['Charge E-Lec','Charge E Lec']))return st;
    let out=st;
    for(const cfg of physicalConfigs(out)){
      if(cfg.kind!=='AC'||Math.abs(cfg.powerKw-22)>1.1)continue;
      out=addOffer(out,'Charge E-Lec direct','charge-e-lec-standard-22',cfg,[rule(0.19)],{source:'official_e_leclerc_2026-07-02',scope:'charge_e_lec_standard_22kw'});
    }
    return out;
  }

  // YAWAY : seul Breteuil dispose d'un prix public exact identifié (0,30 €/kWh, sans abonnement).
  function addYawayBreteuil(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['YAWAY','YAWAY Recharge']))return st;
    if(!joined(st).includes('breteuil'))return st;
    let out=st;
    for(const cfg of physicalConfigs(out))out=addOffer(out,'YAWAY direct','yaway-breteuil-030',cfg,[rule(0.30)],{source:'official_yaway_breteuil',scope:'station_exact_breteuil'});
    return out;
  }

  const OUEST_ALIASES=['Ouest Charge','OuestCharge'];
  const OUEST_DEPTS={
    '49':{normal:{price:.35,after:300,day:true},rapid:{price:.45,after:60,day:true},ultra:{price:.55,after:45,day:true}},
    '44':{normal:{price:.35,after:240,day:true},rapid:{price:.50,after:60,day:true}},
    '35':{normal:{price:.40,after:300,day:true,cap:50},rapid:{price:.55,after:60,cap:50},ultra:{price:.55,after:60,cap:50}},
    '29':{normal:{price:.40},rapid:{price:.55,after:60,cap:50},ultra:{price:.55,after:60,cap:50}},
    '22':{normal:{price:.40,after:300,day:true,cap:50},rapid:{price:.55,after:60,cap:50},ultra:{price:.55,after:60}}
  };
  function department(st){
    const raw=[st?.postalCode,st?.address,st?._sourceAddress,st?.name].map(text).join(' ');
    const m=raw.match(/\b(22|29|35|44|49)\d{3}\b/);return m?.[1]||'';
  }
  function ouestClass(physical){
    const max=Math.max(0,...physical.map(c=>Number(c.powerKw||0)));
    if(max<=22.5)return'normal';
    if(max>=40&&max<=60)return'rapid';
    if(max>=100)return'ultra';
    return''; // classe non inférable sans ambiguïté : on ne classe pas.
  }
  function ouestRules(spec){
    const base={connectionFee:1,afterMinutesRate:spec.after?0.20:0,afterMinutesThreshold:spec.after||0,afterMinutesCap:spec.cap||0};
    if(spec.after&&spec.day)return [rule(spec.price,{...base,start:'07:00',end:'21:00'}),rule(spec.price,{connectionFee:1,start:'21:00',end:'07:00'})];
    return [rule(spec.price,base)];
  }
  function addOuestCharge(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,OUEST_ALIASES))return st;
    const dept=department(st),grid=OUEST_DEPTS[dept];if(!grid)return st; // 53/56/72/85 = réseaux partenaires, volontairement exclus.
    const physical=physicalConfigs(st),cls=ouestClass(physical),spec=grid[cls];if(!spec)return st;
    let out=st;
    for(const cfg of physical)out=addOffer(out,'Ouest Charge direct (non-abonné)',`ouest-charge-${dept}-${cls}`,cfg,ouestRules(spec),{source:'official_ouestcharge_tariffs_current',scope:`network_direct_department_${dept}_${cls}`});
    return out;
  }

  function applyAll(st){return addOuestCharge(addYawayBreteuil(addChargeELec(st)))}
  function install(){
    const current=window.expandConfigurations;if(typeof current!=='function')return false;if(current.__tccFranceCpoGap20260825)return true;
    const wrapped=function(baseStations){const source=Array.isArray(baseStations)?baseStations.map(applyAll):baseStations;return current.call(this,source)};
    wrapped.__tccFranceCpoGap20260825=true;wrapped.__tccOriginal=current;
    if(current.__tccOverlayExpansionGuard)wrapped.__tccOverlayExpansionGuard=true;
    if(current.__tccDirectResolverPowerV1)wrapped.__tccDirectResolverPowerV1=true;
    if(current.__tccDirectSmokeFix)wrapped.__tccDirectSmokeFix=true;
    window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>240)clearInterval(timer)},50);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});else setTimeout(install,0);
  window.TCCV8FranceCpoGap={revision:REVISION,applyAll,addChargeELec,addYawayBreteuil,addOuestCharge,install};
  console.info(`[TCC V8] ${REVISION} actif : Charge E-Lec 22 kW + YAWAY Breteuil + Ouest Charge direct.`);
})();
