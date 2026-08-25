// Tesla Charge Companion V8 RC4.8 — couche CPO France consolidée.
// Périmètre strict : opérateur physique / réseau direct uniquement, aucune itinérance.
(function(){
  'use strict';
  const REVISION='rc48bu-fr-cpo-consolidated-20260826';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));

  function values(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name,st?.address,st?._sourceAddress,st?.city,st?.postalCode].map(norm).filter(Boolean)}
  function joined(st){return values(st).join(' ')}
  function hasAlias(st,aliases){const vals=values(st),wanted=aliases.map(norm);return vals.some(v=>wanted.some(a=>v===a||v.includes(a)||a.includes(v)))}
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls,pricing:st?.pricing}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(c?.frCpoGapOfferId||c?.frCpoConsolidatedOfferId)continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0),pricing:c?.pricing,offerProvider:c?.offerProvider,offerType:c?.offerType});
    }
    return out;
  }
  function providerOf(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function hasProvider(configs,provider,cfg,subscriptionId=''){const p=norm(provider);return(configs||[]).some(c=>providerOf(c)===p&&text(c?.subscriptionId||'')===text(subscriptionId||'')&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.25)}
  function rule(pricePerKwh,{connectionFee=0,afterMinutesRate=0,afterMinutesThreshold=0,afterMinutesCap=0,start='00:00',end='24:00',postChargeRate=0,postChargeGraceMinutes=0,startedKwhCharged=false}={}){
    return {scope:start==='00:00'&&end==='24:00'?'allDay':'timeWindow',start,end,billing:'kwh',currency:'EUR',pricePerKwh,chargePerMinute:0,connectionFee,idlePerMinute:0,afterMinutesRate,afterMinutesThreshold,afterMinutesCap,afterMinutesCapStart:start,afterMinutesCapEnd:end,postChargeRate,postChargeGraceMinutes,startedKwhCharged};
  }
  function addOffer(st,provider,offerId,cfg,rules,meta={}){
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[];
    if(hasProvider(base,provider,cfg,meta.subscriptionId||''))return st;
    const added={
      id:`fr-cpo-consolidated:${offerId}:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
      label:`${provider} · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,
      pricing:{type:'rules',rules:clone(rules)},offerProvider:provider,offerType:meta.offerType||'operator_direct',
      subscriptionId:meta.subscriptionId||undefined,
      frCpoConsolidatedOfferId:offerId,frCpoGapOfferId:offerId,frCpoVerifiedAt:'2026-08-26',frCpoScope:meta.scope||'direct_physical_operator_only',frCpoSource:meta.source||''
    };
    return {...st,chargingConfigurations:[...base,added],_frCpoConsolidatedOffers:[...(st._frCpoConsolidatedOffers||[]),offerId],_frCpoGapOffers:[...(st._frCpoGapOffers||[]),offerId]};
  }

  // Charge E-Lec : prix national officiel des points standards 22 kW depuis le 09/07/2026.
  function addChargeELec(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['Charge E-Lec','Charge E Lec']))return st;
    let out=st;
    for(const cfg of physicalConfigs(out)){
      if(cfg.kind!=='AC'||Math.abs(cfg.powerKw-22)>1.1)continue;
      out=addOffer(out,'Charge E-Lec direct','charge-e-lec-standard-22',cfg,[rule(0.19)],{source:'https://www.e.leclerc/e/charge-e-lec',scope:'charge_e_lec_standard_22kw'});
    }
    return out;
  }

  // YAWAY : seul Breteuil dispose d'un prix public exact identifié (0,30 €/kWh, sans abonnement).
  function addYawayBreteuil(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['YAWAY','YAWAY Recharge']))return st;
    if(!joined(st).includes('breteuil'))return st;
    let out=st;
    for(const cfg of physicalConfigs(out))out=addOffer(out,'YAWAY direct','yaway-breteuil-030',cfg,[rule(0.30)],{source:'https://yaway.fr/',scope:'station_exact_breteuil'});
    return out;
  }

  // R3 / DBT : 0,35 €/kWh AC lente et 0,55 €/kWh recharge rapide sur le réseau R3.
  function addR3(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['R3','R3 Charge','DBT R3']))return st;
    let out=st;
    for(const cfg of physicalConfigs(out)){
      if(cfg.kind==='AC'&&cfg.powerKw<=22.5)out=addOffer(out,'R3 direct','r3-slow-ac',cfg,[rule(.35)],{source:'https://www.dbt.fr/carte-des-stations/',scope:'r3_physical_network'});
      else if(cfg.kind==='DC')out=addOffer(out,'R3 direct','r3-fast-dc',cfg,[rule(.55)],{source:'https://www.dbt.fr/carte-des-stations/',scope:'r3_physical_network'});
    }
    return out;
  }

  // Stations-e : uniquement les bornes physiquement exploitées par Stations-e, jamais les partenaires.
  const STATIONS_E_ALIASES=['Stations-e','Stations e','StationsE'];
  function stationsERules(cfg,price){
    const common={postChargeRate:.10,postChargeGraceMinutes:15,startedKwhCharged:true};
    if(cfg.kind==='AC'&&Math.abs(cfg.powerKw-22)<=1.1){
      return [rule(price,{...common,start:'07:00',end:'23:00'}),rule(price,{postChargeRate:0,postChargeGraceMinutes:15,startedKwhCharged:true,start:'23:00',end:'07:00'})];
    }
    return [rule(price,common)];
  }
  function stationsEPriceClass(cfg){
    if(cfg.kind==='AC'&&Math.abs(cfg.powerKw-22)<=1.1)return'22ac';
    if(cfg.kind==='DC'&&Math.abs(cfg.powerKw-24)<=1.1)return'24dc';
    if(cfg.kind==='DC'&&Math.abs(cfg.powerKw-50)<=2)return'50dc';
    return'';
  }
  function addStationsE(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,STATIONS_E_ALIASES))return st;
    let out=st;
    for(const cfg of physicalConfigs(out)){
      const cls=stationsEPriceClass(cfg);if(!cls)continue;
      out=addOffer(out,'Stations-e direct','stations-e-direct',cfg,stationsERules(cfg,.54),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only'});
      out=addOffer(out,'Stations-e Badge','stations-e-badge',cfg,stationsERules(cfg,.39),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only',subscriptionId:'stations-e-badge',offerType:'subscription'});
      const express=cls==='50dc'?.35:.32;
      out=addOffer(out,'Stations-e Express-e','stations-e-express',cfg,stationsERules(cfg,express),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only',subscriptionId:'stations-e-express',offerType:'subscription'});
      const access=.35===0?0:(cls==='50dc'?.35:.29);
      out=addOffer(out,'Stations-e Access-e','stations-e-access',cfg,stationsERules(cfg,access),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only',subscriptionId:'stations-e-access',offerType:'subscription'});
    }
    return out;
  }

  // ENGIE Vianeo Max : 0,33 €/kWh national, mais les frais minute locaux doivent être conservés.
  // On ne génère donc l'offre que si une configuration directe Vianeo avec règles existe déjà.
  function addVianeoMax(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['ENGIE Vianeo','Vianeo']))return st;
    let out=st;
    for(const cfg of physicalConfigs(out)){
      const direct=cfg.offerType==='operator_direct'||norm(cfg.offerProvider).includes('vianeo direct');
      const rules=Array.isArray(cfg?.pricing?.rules)?clone(cfg.pricing.rules):[];
      if(!direct||!rules.length)continue;
      for(const r of rules){if(String(r.billing||'').toLowerCase()==='kwh'||Number.isFinite(Number(r.pricePerKwh)))r.pricePerKwh=.33;}
      out=addOffer(out,'ENGIE Vianeo Max','vianeo-max',cfg,rules,{source:'https://www.engie-vianeo.com/france/engie-vianeo-max-abonnement-recharge-tarif-unique/',scope:'vianeo_physical_only_preserve_local_fees',subscriptionId:'vianeo-max',offerType:'subscription'});
    }
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
    return'';
  }
  function ouestRules(spec){
    const base={connectionFee:1,afterMinutesRate:spec.after?0.20:0,afterMinutesThreshold:spec.after||0,afterMinutesCap:spec.cap||0};
    if(spec.after&&spec.day)return [rule(spec.price,{...base,start:'07:00',end:'21:00'}),rule(spec.price,{connectionFee:1,start:'21:00',end:'07:00'})];
    return [rule(spec.price,base)];
  }
  function addOuestCharge(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,OUEST_ALIASES))return st;
    const dept=department(st),grid=OUEST_DEPTS[dept];if(!grid)return st;
    const physical=physicalConfigs(st),cls=ouestClass(physical),spec=grid[cls];if(!spec)return st;
    let out=st;
    for(const cfg of physical)out=addOffer(out,'Ouest Charge direct (non-abonné)',`ouest-charge-${dept}-${cls}`,cfg,ouestRules(spec),{source:'https://ouestcharge.fr/tarifs-borne-ouest-charge/',scope:`network_direct_department_${dept}_${cls}`});
    return out;
  }

  function registerSubscriptions(){
    const api=window.TCCV8Subscriptions;if(typeof api?.registerPlan!=='function')return false;
    const list=[
      {id:'stations-e-badge',selectionId:'stations-e-badge',provider:'Stations-e — Badge gratuit',offerType:'subscription',monthlyFeeEur:0,defaultSelected:false,operatorAliases:STATIONS_E_ALIASES,directOperatorOnly:true,source:'https://stations-e.com/fr/tarification'},
      {id:'stations-e-express',selectionId:'stations-e-express',provider:'Stations-e — Express-e',offerType:'subscription',monthlyFeeEur:2.90,defaultSelected:false,operatorAliases:STATIONS_E_ALIASES,directOperatorOnly:true,source:'https://stations-e.com/fr/tarification'},
      {id:'stations-e-access',selectionId:'stations-e-access',provider:'Stations-e — Access-e',offerType:'subscription',monthlyFeeEur:4.90,defaultSelected:false,operatorAliases:STATIONS_E_ALIASES,directOperatorOnly:true,source:'https://stations-e.com/fr/tarification'},
      {id:'vianeo-max',selectionId:'vianeo-max',provider:'ENGIE Vianeo Max',offerType:'subscription',monthlyFeeEur:9.99,defaultSelected:false,operatorAliases:['ENGIE Vianeo','Vianeo'],directOperatorOnly:true,source:'https://www.engie-vianeo.com/france/engie-vianeo-max-abonnement-recharge-tarif-unique/'}
    ];
    list.forEach(p=>api.registerPlan(p));
    document.dispatchEvent(new CustomEvent('tcc:subscription-plan-registered'));
    return true;
  }

  function applyAll(st){return addOuestCharge(addVianeoMax(addStationsE(addR3(addYawayBreteuil(addChargeELec(st))))))}
  function install(){
    const current=window.expandConfigurations;if(typeof current!=='function')return false;if(current.__tccFranceCpoConsolidated20260826)return true;
    const wrapped=function(baseStations){const source=Array.isArray(baseStations)?baseStations.map(applyAll):baseStations;return current.call(this,source)};
    wrapped.__tccFranceCpoConsolidated20260826=true;wrapped.__tccFranceCpoGap20260825=true;wrapped.__tccOriginal=current;
    if(current.__tccOverlayExpansionGuard)wrapped.__tccOverlayExpansionGuard=true;
    if(current.__tccDirectResolverPowerV1)wrapped.__tccDirectResolverPowerV1=true;
    if(current.__tccDirectSmokeFix)wrapped.__tccDirectSmokeFix=true;
    window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;const a=install(),b=registerSubscriptions();if((a&&b)||tries>240)clearInterval(timer)},50);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(install,0);setTimeout(registerSubscriptions,0)},{once:true});else{setTimeout(install,0);setTimeout(registerSubscriptions,0)}
  window.TCCV8FranceCpoGap=window.TCCV8FranceCpoConsolidated={revision:REVISION,applyAll,addChargeELec,addYawayBreteuil,addR3,addStationsE,addVianeoMax,addOuestCharge,registerSubscriptions,install};
  console.info(`[TCC V8] ${REVISION} actif : couche CPO France consolidée.`);
})();