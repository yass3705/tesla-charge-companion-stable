// Tesla Charge Companion V8 — IZIVIA FAST direct, network-exact and fail-closed.
// Applies only to physical IZIVIA/Sodetrel stations explicitly identified as IZIVIA FAST / McDonald's.
(function(){
  'use strict';
  const VERSION='v8-izivia-fast-direct-20260827a';
  const DATA_URL='data/izivia_fast_direct_tariff_v1.json?v=20260827a';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  let catalog=null,catalogPromise=null;

  function validateCatalog(data){
    if(data?.dataset!=='izivia-fast-direct-france-v1'||data?.schemaVersion!=='1.0.0')throw new Error('IZIVIA FAST dataset invalid');
    const s=data?.scope||{},m=data?.matching||{},t=data?.tariff||{};
    if(s.countryCode!=='FR'||s.onlyDirectCpo!==true||s.roamingIncluded!==false||s.subscriptionDiscountsIncluded!==false||s.failClosed!==true)throw new Error('IZIVIA FAST scope invalid');
    if(m.dcOnly!==true||!Array.isArray(m.operatorAliases)||!m.operatorAliases.length||!Array.isArray(m.stationHintsAny)||!m.stationHintsAny.length)throw new Error('IZIVIA FAST matching policy invalid');
    if(t.currency!=='EUR'||t.billing!=='kwh'||!Array.isArray(t.windows)||t.windows.length!==4)throw new Error('IZIVIA FAST tariff invalid');
    const expected=[['00:00','11:30',.30],['11:30','15:00',.35],['15:00','18:00',.30],['18:00','24:00',.35]];
    t.windows.forEach((row,i)=>{const e=expected[i];if(row?.start!==e[0]||row?.end!==e[1]||Math.abs(Number(row?.pricePerKwh)-e[2])>1e-9)throw new Error(`IZIVIA FAST window ${i+1} invalid`);});
    return data;
  }
  function loadCatalog(){
    if(catalogPromise)return catalogPromise;
    catalogPromise=fetch(DATA_URL,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`IZIVIA FAST dataset unavailable (${r.status})`);return r.json();}).then(data=>{catalog=validateCatalog(data);return catalog;}).catch(err=>{catalogPromise=null;console.warn('[TCC V8] IZIVIA FAST direct not loaded:',err);return null;});
    return catalogPromise;
  }

  function providerOf(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function operatorValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.sourceOperator].map(norm).filter(Boolean)}
  function stationHintValues(st){return [st?.name,st?._sourceName,st?.network,st?._sourceNetwork,st?.sourceNetwork].map(norm).filter(Boolean)}
  function operatorMatches(st,data=catalog){
    const aliases=(data?.matching?.operatorAliases||[]).map(norm).filter(Boolean);
    return operatorValues(st).some(v=>aliases.some(a=>v===a||v.startsWith(`${a} `)));
  }
  function networkHintMatches(st,data=catalog){
    const hints=(data?.matching?.stationHintsAny||[]).map(norm).filter(Boolean);
    return stationHintValues(st).some(v=>hints.some(h=>v.includes(h)));
  }
  function isIziviaFast(st,data=catalog){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!data)return false;
    return operatorMatches(st,data)&&networkHintMatches(st,data);
  }
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls}];
    const out=[],seen=new Set();
    for(const c of src){
      if(c?.iziviaFastDirectOffer||providerOf(c)==='izivia direct')continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(kind!=='DC'||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function hasDirect(configs,cfg){return(configs||[]).some(c=>providerOf(c)==='izivia direct'&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.35)}
  function pricing(data=catalog){
    const t=validateCatalog(data).tariff;
    return{type:'rules',rules:t.windows.map(row=>({scope:'timeWindow',start:row.start,end:row.end,billing:'kwh',currency:t.currency,pricePerKwh:Number(row.pricePerKwh),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00',postChargeRate:0,postChargeGraceMinutes:0,startedKwhCharged:false,tariffLabel:row.label||''}))};
  }
  function addOffers(st,data=catalog){
    if(!isIziviaFast(st,data))return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      if(hasDirect([...base,...added],cfg))continue;
      added.push({
        id:`izivia-fast-direct:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
        label:`IZIVIA direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,
        pricing:pricing(data),offerProvider:'IZIVIA direct',offerType:'operator_direct',
        iziviaFastDirectOffer:true,iziviaFastTariffExact:true,iziviaFastNetwork:true,
        iziviaFastSourceVersion:text(data?.generatedAt),iziviaFastStatusSeparated:true
      });
    }
    return added.length?{...st,chargingConfigurations:[...base,...added],_iziviaFastDirectOffers:[...(st._iziviaFastDirectOffers||[]),...added.map(x=>x.id)]}:st;
  }
  async function enrichPrepared(prepared){
    if(!prepared||!Array.isArray(prepared.stations))return prepared;
    const data=await loadCatalog();if(!data)return prepared;
    prepared.stations=prepared.stations.map(st=>addOffers(st,data));
    prepared.iziviaFastDirectPipelineApplied=true;return prepared;
  }
  function register(){const p=window.TCCV8DirectPipeline;if(!p?.registerPreparedEnricher)return false;p.registerPreparedEnricher('izivia-fast-direct',enrichPrepared,55);return true;}
  if(!register()&&typeof document!=='undefined')document.addEventListener('tcc:direct-offer-pipeline-ready',register,{once:true});
  window.TCCV8IziviaFastDirect={version:VERSION,loadCatalog,validateCatalog,addOffers,isIziviaFast,pricing,enrichPrepared,get catalog(){return catalog}};
})();
