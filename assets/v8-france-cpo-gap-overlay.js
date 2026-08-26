// Tesla Charge Companion V8 RC4.8 — couche CPO France consolidée.
// Périmètre strict : opérateur physique / réseau direct uniquement, aucune itinérance.
(function(){
  'use strict';
  const REVISION='rc48bv-fr-cpo-charge-elec-dc-20260826';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));

  function values(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name,st?.address,st?._sourceAddress,st?.city,st?.postalCode].map(norm).filter(Boolean)}
  function joined(st){return values(st).join(' ')}
  function rawBlob(st){try{return norm(JSON.stringify(st))}catch(e){return joined(st)}}
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
      frCpoConsolidatedOfferId:offerId,frCpoGapOfferId:offerId,
      frCpoVerifiedAt:meta.verifiedAt||'2026-08-26',
      frCpoTariffObservedAt:meta.observedAt||undefined,
      frCpoValidUntil:meta.validUntil||undefined,
      frCpoConfidence:meta.confidence||undefined,
      frCpoScope:meta.scope||'direct_physical_operator_only',
      frCpoSource:meta.source||'',
      frCpoSecondarySource:meta.secondarySource||''
    };
    return {...st,chargingConfigurations:[...base,added],_frCpoConsolidatedOffers:[...(st._frCpoConsolidatedOffers||[]),offerId],_frCpoGapOffers:[...(st._frCpoGapOffers||[]),offerId]};
  }

  // Charge E-Lec standard : 0,19 €/kWh uniquement sur les points standards 22 kW.
  const CHARGE_ELEC_ALIASES=['Charge E-Lec','Charge E Lec'];
  const CHARGE_ELEC_DC_SOURCE='https://www.blogtesla.fr/forum/viewtopic.php?t=11639';
  const CHARGE_ELEC_DC_OBSERVED='2026-07-21';
  const CHARGE_ELEC_DC_VALID_UNTIL='2026-09-05T00:00:00+02:00';
  const CHARGE_ELEC_DC_STATIONS=[
    {id:'le-gua',dept:'17',aliases:['le gua'],power:160,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-station-service-le-gua'},
    {id:'surgeres',dept:'17',aliases:['surgeres'],power:300,price:.27,official:'https://www.charge-elec.leclerc/station/eleclerc-surgeres'},
    {id:'blain',dept:'44',aliases:['blain','blaindis'],power:120,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-blaindis'},
    {id:'amilly',dept:'45',aliases:['amilly'],power:120,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-amilly'},
    {id:'vannes',dept:'56',aliases:['vannes'],power:180,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-vannes'},
    {id:'clamecy',dept:'58',aliases:['clamecy'],power:200,price:.19,official:'https://www.charge-elec.leclerc/station/eleclerc-clamecy'},
    {id:'caudry',dept:'59',aliases:['caudry'],power:120,price:.19,official:'https://www.charge-elec.leclerc/station/eleclerc-caudry'},
    {id:'valenciennes',dept:'59',aliases:['valenciennes','anzin'],power:180,price:.35,official:'https://www.charge-elec.leclerc/station/eleclerc-valenciennes'},
    {id:'oloron',dept:'64',aliases:['oloron'],power:100,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-oloron'},
    {id:'orthez',dept:'64',aliases:['orthez'],power:280,price:.21,official:'https://www.charge-elec.leclerc/station/eleclerc-orthez'},
    {id:'geispolsheim',dept:'67',aliases:['geispolsheim'],power:180,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-geispolsheim'},
    {id:'ribeauville',dept:'68',aliases:['ribeauville'],power:200,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-ribeauville'},
    {id:'lure',dept:'70',aliases:['lure'],power:180,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-lure'},
    {id:'alencon-arconnay',dept:'72',aliases:['arconnay','alencon'],power:100,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-alencon-arconnay'},
    {id:'cran-gevrier',dept:'74',aliases:['cran gevrier'],power:120,price:.28,official:'https://www.charge-elec.leclerc/station/eleclerc-cran-gevrier'},
    {id:'bessines',dept:'79',aliases:['bessines'],power:150,price:.28,official:'https://www.charge-elec.leclerc/station/e-leclerc-bessines'}
  ];
  function genericDepartment(st){
    const raw=[st?.postalCode,st?.address,st?._sourceAddress].map(text).join(' ');
    const m=raw.match(/\b(0[1-9]|[1-8]\d|9[0-5])\d{3}\b/);return m?.[1]||'';
  }
  function chargeELecDcSpec(st){
    if(Date.now()>new Date(CHARGE_ELEC_DC_VALID_UNTIL).getTime())return null;
    const j=joined(st),blob=rawBlob(st);
    const marker=blob.includes('fr le2')||blob.includes('charge e lec')||blob.includes('e leclerc')||blob.includes('eleclerc')||(blob.includes('freshmile')&&blob.includes('leclerc'));
    if(!marker)return null;
    const dept=genericDepartment(st);
    return CHARGE_ELEC_DC_STATIONS.find(s=>(!dept||dept===s.dept)&&s.aliases.some(a=>j.includes(norm(a))))||null;
  }
  function addChargeELec(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR')return st;
    let out=st;
    if(hasAlias(out,CHARGE_ELEC_ALIASES)){
      for(const cfg of physicalConfigs(out)){
        if(cfg.kind!=='AC'||Math.abs(cfg.powerKw-22)>1.1)continue;
        out=addOffer(out,'Charge E-Lec direct','charge-e-lec-standard-22',cfg,[rule(.19)],{source:'https://www.charge-elec.leclerc/actualite/recharger-son-vehicule-pendant-ses-courses-na-jamais-ete-aussi-avantageux',scope:'charge_e_lec_standard_22kw'});
      }
    }
    const spec=chargeELecDcSpec(out);if(!spec)return out;
    for(const cfg of physicalConfigs(out)){
      if(cfg.kind!=='DC'||Math.abs(cfg.powerKw-spec.power)>2.1)continue;
      out=addOffer(out,'Charge E-Lec direct',`charge-e-lec-dc-${spec.id}`,cfg,[rule(spec.price)],{
        source:CHARGE_ELEC_DC_SOURCE,secondarySource:spec.official,
        scope:`charge_e_lec_station_exact_${spec.id}_${spec.power}kw`,
        observedAt:CHARGE_ELEC_DC_OBSERVED,verifiedAt:'2026-08-26',validUntil:CHARGE_ELEC_DC_VALID_UNTIL,
        confidence:'dated_direct_app_observation_topology_revalidated'
      });
    }
    return out;
  }

  function addYawayBreteuil(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['YAWAY','YAWAY Recharge'])||!joined(st).includes('breteuil'))return st;
    let out=st;for(const cfg of physicalConfigs(out))out=addOffer(out,'YAWAY direct','yaway-breteuil-030',cfg,[rule(.30)],{source:'https://yaway.fr/',scope:'station_exact_breteuil'});return out;
  }

  function addR3(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['R3','R3 Charge','DBT R3']))return st;
    let out=st;for(const cfg of physicalConfigs(out)){
      if(cfg.kind==='AC'&&cfg.powerKw<=22.5)out=addOffer(out,'R3 direct','r3-slow-ac',cfg,[rule(.35)],{source:'https://www.dbt.fr/carte-des-stations/',scope:'r3_physical_network'});
      else if(cfg.kind==='DC')out=addOffer(out,'R3 direct','r3-fast-dc',cfg,[rule(.55)],{source:'https://www.dbt.fr/carte-des-stations/',scope:'r3_physical_network'});
    }return out;
  }

  const STATIONS_E_ALIASES=['Stations-e','Stations e','StationsE'];
  function stationsERules(cfg,price){
    const common={postChargeRate:.10,postChargeGraceMinutes:15,startedKwhCharged:true};
    if(cfg.kind==='AC'&&Math.abs(cfg.powerKw-22)<=1.1)return [rule(price,{...common,start:'07:00',end:'23:00'}),rule(price,{postChargeRate:0,postChargeGraceMinutes:15,startedKwhCharged:true,start:'23:00',end:'07:00'})];
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
    let out=st;for(const cfg of physicalConfigs(out)){
      const cls=stationsEPriceClass(cfg);if(!cls)continue;
      out=addOffer(out,'Stations-e direct','stations-e-direct',cfg,stationsERules(cfg,.54),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only'});
      out=addOffer(out,'Stations-e Badge','stations-e-badge',cfg,stationsERules(cfg,.39),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only',subscriptionId:'stations-e-badge',offerType:'subscription'});
      out=addOffer(out,'Stations-e Express-e','stations-e-express',cfg,stationsERules(cfg,cls==='50dc'?.35:.32),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only',subscriptionId:'stations-e-express',offerType:'subscription'});
      out=addOffer(out,'Stations-e Access-e','stations-e-access',cfg,stationsERules(cfg,cls==='50dc'?.35:.29),{source:'https://stations-e.com/fr/tarification',scope:'stations_e_physical_only',subscriptionId:'stations-e-access',offerType:'subscription'});
    }return out;
  }

  function addVianeoMax(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,['ENGIE Vianeo','Vianeo']))return st;
    let out=st;for(const cfg of physicalConfigs(out)){
      const direct=cfg.offerType==='operator_direct'||norm(cfg.offerProvider).includes('vianeo direct');
      const rules=Array.isArray(cfg?.pricing?.rules)?clone(cfg.pricing.rules):[];if(!direct||!rules.length)continue;
      for(const r of rules){if(String(r.billing||'').toLowerCase()==='kwh'||Number.isFinite(Number(r.pricePerKwh)))r.pricePerKwh=.33}
      out=addOffer(out,'ENGIE Vianeo Max','vianeo-max',cfg,rules,{source:'https://www.engie-vianeo.com/france/engie-vianeo-max-abonnement-recharge-tarif-unique/',scope:'vianeo_physical_only_preserve_local_fees',subscriptionId:'vianeo-max',offerType:'subscription'});
    }return out;
  }

  const OUEST_ALIASES=['Ouest Charge','OuestCharge'];
  const OUEST_DEPTS={
    '49':{normal:{price:.35,after:300,day:true},rapid:{price:.45,after:60,day:true},ultra:{price:.55,after:45,day:true}},
    '44':{normal:{price:.35,after:240,day:true},rapid:{price:.50,after:60,day:true}},
    '35':{normal:{price:.40,after:300,day:true,cap:50},rapid:{price:.55,after:60,cap:50},ultra:{price:.55,after:60,cap:50}},
    '29':{normal:{price:.40},rapid:{price:.55,after:60,cap:50},ultra:{price:.55,after:60,cap:50}},
    '22':{normal:{price:.40,after:300,day:true,cap:50},rapid:{price:.55,after:60,cap:50},ultra:{price:.55,after:60}}
  };
  function department(st){const raw=[st?.postalCode,st?.address,st?._sourceAddress,st?.name].map(text).join(' '),m=raw.match(/\b(22|29|35|44|49)\d{3}\b/);return m?.[1]||''}
  function ouestClass(physical){const max=Math.max(0,...physical.map(c=>Number(c.powerKw||0)));if(max<=22.5)return'normal';if(max>=40&&max<=60)return'rapid';if(max>=100)return'ultra';return''}
  function ouestRules(spec){
    const base={connectionFee:1,afterMinutesRate:spec.after?.20:0,afterMinutesThreshold:spec.after||0,afterMinutesCap:spec.cap||0};
    if(spec.after&&spec.day)return [rule(spec.price,{...base,start:'07:00',end:'21:00'}),rule(spec.price,{connectionFee:1,start:'21:00',end:'07:00'})];
    return [rule(spec.price,base)];
  }
  function addOuestCharge(st){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!hasAlias(st,OUEST_ALIASES))return st;
    const dept=department(st),grid=OUEST_DEPTS[dept];if(!grid)return st;
    const physical=physicalConfigs(st),cls=ouestClass(physical),spec=grid[cls];if(!spec)return st;
    let out=st;for(const cfg of physical)out=addOffer(out,'Ouest Charge direct (non-abonné)',`ouest-charge-${dept}-${cls}`,cfg,ouestRules(spec),{source:'https://ouestcharge.fr/tarifs-borne-ouest-charge/',scope:`network_direct_department_${dept}_${cls}`});return out;
  }

  function registerSubscriptions(){
    const api=window.TCCV8Subscriptions;if(typeof api?.registerPlan!=='function')return false;
    [
      {id:'stations-e-badge',selectionId:'stations-e-badge',provider:'Stations-e — Badge gratuit',offerType:'subscription',monthlyFeeEur:0,defaultSelected:false,operatorAliases:STATIONS_E_ALIASES,directOperatorOnly:true,source:'https://stations-e.com/fr/tarification'},
      {id:'stations-e-express',selectionId:'stations-e-express',provider:'Stations-e — Express-e',offerType:'subscription',monthlyFeeEur:2.90,defaultSelected:false,operatorAliases:STATIONS_E_ALIASES,directOperatorOnly:true,source:'https://stations-e.com/fr/tarification'},
      {id:'stations-e-access',selectionId:'stations-e-access',provider:'Stations-e — Access-e',offerType:'subscription',monthlyFeeEur:4.90,defaultSelected:false,operatorAliases:STATIONS_E_ALIASES,directOperatorOnly:true,source:'https://stations-e.com/fr/tarification'},
      {id:'vianeo-max',selectionId:'vianeo-max',provider:'ENGIE Vianeo Max',offerType:'subscription',monthlyFeeEur:9.99,defaultSelected:false,operatorAliases:['ENGIE Vianeo','Vianeo'],directOperatorOnly:true,source:'https://www.engie-vianeo.com/france/engie-vianeo-max-abonnement-recharge-tarif-unique/'}
    ].forEach(p=>api.registerPlan(p));
    document.dispatchEvent(new CustomEvent('tcc:subscription-plan-registered'));return true;
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