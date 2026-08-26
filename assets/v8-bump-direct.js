// Tesla Charge Companion V8 — Bump France CPO-direct exact station/EVSE tariffs.
// Source: validated Bump public driver-facing tariff snapshot. No roaming and no network-wide fallback.
(function(){
  'use strict';
  const REVISION='bump-direct-v1-20260826a';
  const DATA_URL='data/bump_direct_tariffs_tcc_france.json.gz';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const compact=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  let dataPromise=null,indexCache=null;

  async function readGzipJson(url){
    const r=await fetch(`${url}?v=20260826a`,{cache:'no-store'});
    if(!r.ok)throw new Error(`base Bump indisponible (${r.status})`);
    const bytes=new Uint8Array(await r.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('compression Bump invalide');
    if(typeof DecompressionStream!=='function')throw new Error('décompression gzip Bump indisponible');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  function validateCatalog(data){
    const c=data?.counts||{};
    if(data?.dataset!=='bump-direct-tariffs-tcc-france'||data?.operator!=='Bump'||data?.country!=='FR')throw new Error('dataset Bump inattendu');
    if(data?.scope?.directCpoOnly!==true||data?.scope?.roamingIncluded!==false||data?.scope?.unresolvedCasesNeverRankable!==true)throw new Error('périmètre Bump Direct invalide');
    if(Number(c.franceStations)!==1506||Number(c.francePoints)!==2252||Number(c.rankablePoints)!==2074||Number(c.unresolvedPoints)!==178)throw new Error('compteurs Bump inattendus');
    if((data?.variableParseFailures||[]).length)throw new Error('règles variables Bump non résolues');
    return data;
  }
  async function loadCatalog(){
    if(window.TCC_BUMP_DIRECT_CATALOG_V1)return validateCatalog(window.TCC_BUMP_DIRECT_CATALOG_V1);
    if(!dataPromise)dataPromise=readGzipJson(DATA_URL).then(validateCatalog).then(data=>{
      window.TCC_BUMP_DIRECT_CATALOG_V1=data;indexCache=null;
      document.dispatchEvent(new CustomEvent('tcc:bump-map-ready',{detail:{rankable:Number(data.counts?.rankablePoints||0)}}));
      return data;
    }).catch(err=>{console.warn('[TCC V8] Base Bump Direct ignorée :',err?.message||err);return null;});
    return dataPromise;
  }

  function operatorValues(st){return[st?.operator,st?._sourceOperator,st?.cpo,st?.network].map(norm).filter(Boolean)}
  function isBumpOperator(st){return operatorValues(st).some(v=>v==='bump'||v.startsWith('bump ')||v.includes(' bump '))}
  function providerOf(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls,pricing:st?.pricing}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(providerOf(c)==='bump direct'||c?.bumpDirectOffer)continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function hasDirect(configs,cfg){return(configs||[]).some(c=>providerOf(c)==='bump direct'&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.35)}
  function compatible(point,cfg){return Math.abs(Number(point?.powerKw||0)-Number(cfg?.powerKw||0))<.35}
  function signature(point){return JSON.stringify({components:point?.components||null,rules:point?.rules||null});}

  function indexes(data){
    if(indexCache?.data===data)return indexCache;
    const byEvse=new Map(),byStation=new Map(),byName=new Map(),byAddress=new Map();
    const add=(idx,key,rec)=>{if(!key)return;if(!idx.has(key))idx.set(key,[]);idx.get(key).push(rec)};
    for(const station of data?.stations||[]){
      const sid=compact(station?.stationId),rec={station,stationId:sid,points:[]};
      for(const p of station?.points||[]){
        const point={...p,stationId:sid,stationName:station?.name||'',address:station?.address||''};rec.points.push(point);
        const eid=compact(p?.idPdcItinerance);if(eid)byEvse.set(eid,point);
      }
      add(byStation,sid,rec);add(byName,norm(station?.name),rec);add(byAddress,norm(station?.address),rec);
    }
    indexCache={data,byEvse,byStation,byName,byAddress};return indexCache;
  }
  function collectBumpIds(st){
    const evse=new Set(),station=new Set(),seen=new Set();
    function scan(v,depth=0,key=''){
      if(v==null||depth>4)return;
      if(typeof v==='string'||typeof v==='number'){
        const raw=String(v).toUpperCase();
        for(const m of raw.match(/FRBMPE[A-Z0-9]+/g)||[])evse.add(compact(m));
        for(const m of raw.match(/FRBMPS[A-Z0-9]+/g)||[])station.add(compact(m));
        return;
      }
      if(typeof v!=='object'||seen.has(v))return;seen.add(v);
      if(Array.isArray(v)){v.slice(0,250).forEach(x=>scan(x,depth+1,key));return;}
      for(const [k,x] of Object.entries(v)){
        const nk=norm(k);if(depth<=1||/(?:evse|pdc|station|source|external|identifier|^id$|ids)/.test(nk))scan(x,depth+1,k);
      }
    }
    scan(st);return{evse:[...evse],station:[...station]};
  }
  function rankable(point){return point?.rankable===true&&(point?.status==='rankable_static'||point?.status==='rankable_rule_based')}
  function safePointGroup(points,cfg,mode){
    const all=(points||[]).filter(p=>compatible(p,cfg));if(!all.length)return null;
    // A station/name/address fallback is allowed only when every PDC at that power is rankable.
    if(all.some(p=>!rankable(p)))return null;
    const sig=new Set(all.map(signature));if(sig.size!==1)return null;
    return {...all[0],bumpMatchMode:mode,bumpMatchedEvseIds:all.map(p=>compact(p.idPdcItinerance)).filter(Boolean)};
  }
  function resolve(st,cfg,data){
    if(!data?.stations)return null;const idx=indexes(data),ids=collectBumpIds(st);
    const exact=[];for(const id of ids.evse){const p=idx.byEvse.get(id);if(p&&compatible(p,cfg))exact.push(p)}
    if(exact.length){if(exact.some(p=>!rankable(p)))return null;const sig=new Set(exact.map(signature));if(sig.size===1)return{...exact[0],bumpMatchMode:'evse',bumpMatchedEvseIds:exact.map(p=>compact(p.idPdcItinerance))};return null;}
    for(const sid of ids.station){for(const rec of idx.byStation.get(sid)||[]){const hit=safePointGroup(rec.points,cfg,'station_id');if(hit)return hit}}
    if(!isBumpOperator(st))return null;
    for(const n of [norm(st?.name),norm(st?._sourceName)].filter(x=>x.length>=6)){
      const recs=idx.byName.get(n)||[];if(recs.length!==1)continue;const hit=safePointGroup(recs[0].points,cfg,'exact_name_power');if(hit)return hit;
    }
    for(const a of [norm(st?.address),norm(st?._sourceAddress)].filter(x=>x.length>=8)){
      const recs=idx.byAddress.get(a)||[];if(recs.length!==1)continue;const hit=safePointGroup(recs[0].points,cfg,'exact_address_power');if(hit)return hit;
    }
    return null;
  }

  function basePricing(point){
    const components=point?.components||{},policy=Array.isArray(point?.rules)?point.rules:[];
    const band=policy.find(r=>r?.kind==='energy_time_bands');let rules=[];
    if(band&&Array.isArray(band.bands)&&band.bands.length){
      rules=band.bands.map(b=>({scope:'timeWindow',start:text(b.start)||'00:00',end:text(b.end)||'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(b.eurPerKwh||0),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}));
    }else{
      const energy=Number(components.energyEurPerKwh);rules=[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number.isFinite(energy)?energy:0,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}];
    }
    return{type:'rules',rules,bumpDirectExact:true,bumpFeePolicy:{rules:policy,components:{...components}}};
  }

  function minute(v){const m=text(v).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN}
  function inWindow(m,start,end){const s=minute(start),e=minute(end);if(!Number.isFinite(s)||!Number.isFinite(e))return false;return s<e?(m>=s&&m<e):(m>=s||m<e)}
  function occupiedMinutes(startTime,chargeMinutes,unplugTime){
    if(!unplugTime)return chargeMinutes;const s=minute(startTime),u=minute(unplugTime);if(!Number.isFinite(s)||!Number.isFinite(u))return chargeMinutes;
    let d=u-s;if(d<0)d+=1440;return Math.max(chargeMinutes,d);
  }
  function conditionsMet(conditions,billedEnergy,occupied){
    for(const c of conditions||[]){
      if(c?.kind==='energy_above_kwh'&&!(billedEnergy>Number(c.value||0)+1e-9))return false;
      if(c?.kind==='session_duration_after_minutes'&&!(occupied>Number(c.value||0)+1e-9))return false;
    }
    return true;
  }
  function bumpExtras(policy,startMin,chargeMinutes,billedEnergy,unplugTime,startTime){
    const rules=Array.isArray(policy?.rules)?policy.rules:[],components=policy?.components||{},occupied=occupiedMinutes(startTime,chargeMinutes,unplugTime);
    let flat=0,duration=0,idle=0,minimum=Number(components.minPriceEur||0);let hasFlatRule=false,hasDurationRule=false;
    for(const r of rules){
      if(r?.kind==='minimum_total')minimum=Math.max(minimum,Number(r.amountEur||0));
      else if(r?.kind==='flat_fee'){
        hasFlatRule=true;if(conditionsMet(r.conditions,billedEnergy,occupied))flat+=Math.max(0,Number(r.amountEur||0));
      }else if(r?.kind==='session_duration_surcharge'){
        hasDurationRule=true;duration+=Math.max(0,occupied-Number(r.afterMinutes||0))*Math.max(0,Number(r.eurPerMinute||0));
      }else if(r?.kind==='post_charge_occupancy'){
        const parked=Math.max(0,occupied-chargeMinutes),billable=Math.max(0,parked-Number(r.graceMinutes||0));idle+=billable*Math.max(0,Number(r.eurPerMinute||0));
      }else if(r?.kind==='post_charge_occupancy_time_bands'){
        const parked=Math.max(0,occupied-chargeMinutes),bands=Array.isArray(r.bands)?r.bands:[];
        for(let i=0;i<Math.ceil(parked);i++){
          const from=i,to=Math.min(parked,i+1);if(to<=from)continue;const clock=(startMin+chargeMinutes+i)%1440;
          const band=bands.find(b=>inWindow(clock,b.start,b.end));if(!band||i<Number(band.graceMinutes||0))continue;
          idle+=(to-from)*Math.max(0,Number(band.eurPerMinute||0));
        }
      }
    }
    if(!hasFlatRule&&Number(components.flatFeeEur)>0)flat+=Number(components.flatFeeEur);
    if(!hasDurationRule&&Number(components.timeEurPerHour)>0)duration+=occupied*Number(components.timeEurPerHour)/60;
    return{flat,duration,idle,minimum,occupied,totalBeforeMinimum:flat+duration+idle};
  }
  function installPricingExtension(){
    const current=window.priceWithRules;if(typeof current!=='function')return false;if(current.__tccBumpFeeV1)return true;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments){
      const result=current.call(this,pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments);if(!result||result.error)return result;
      const policy=pp?.bumpFeePolicy;if(!policy)return result;
      const extra=bumpExtras(policy,startMin,chargeMinutes,billedEnergy,unplugTime,startTime);
      result.total=Number(result.total||0)+extra.flat+extra.duration+extra.idle;
      result.connection=Number(result.connection||0)+extra.flat;result.durationSurcharge=Number(result.durationSurcharge||0)+extra.duration;result.idleCost=Number(result.idleCost||0)+extra.idle;
      const adjustment=Math.max(0,extra.minimum-Number(result.total||0));if(adjustment>0){result.total+=adjustment;result.connection=Number(result.connection||0)+adjustment;}
      result.bumpFeeCost=extra.flat+extra.duration+extra.idle;result.bumpMinimumAdjustment=adjustment;result.bumpMinimumEur=extra.minimum;return result;
    };
    wrapped.__tccBumpFeeV1=true;wrapped.__tccOriginal=current;window.priceWithRules=wrapped;try{priceWithRules=wrapped}catch(e){}return true;
  }

  function addOffers(st,data=window.TCC_BUMP_DIRECT_CATALOG_V1){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!data?.stations)return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      if(hasDirect([...base,...added],cfg))continue;const point=resolve(st,cfg,data);if(!point)continue;
      added.push({
        id:`bump-direct:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,label:`Bump Direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:Math.max(1,(point.bumpMatchedEvseIds||[]).length||cfg.stalls),
        pricing:basePricing(point),offerProvider:'Bump Direct',offerType:'operator_direct',bumpDirectOffer:true,bumpVerified:true,bumpMapVersion:data.schemaVersion,
        bumpMatchMode:point.bumpMatchMode,bumpMatchedEvseIds:point.bumpMatchedEvseIds||[],bumpStationId:point.stationId||'',bumpTariffGroupId:point.tariffGroupId||'',bumpTariffId:point.tariffId||'',bumpRankableStatus:point.status
      });
    }
    return added.length?{...st,chargingConfigurations:[...base,...added],_bumpDirectOffers:[...(st._bumpDirectOffers||[]),...added.map(x=>x.id)]}:st;
  }
  function installExpansion(){
    const current=window.expandConfigurations;if(typeof current!=='function')return false;if(current.__tccBumpDirectV1)return true;
    const wrapped=function(baseStations){const source=Array.isArray(baseStations)?baseStations.map(st=>addOffers(st)):baseStations;return current.call(this,source)};
    wrapped.__tccBumpDirectV1=true;wrapped.__tccOriginal=current;
    if(current.__tccOverlayExpansionGuard)wrapped.__tccOverlayExpansionGuard=true;if(current.__tccDirectResolverPowerV1)wrapped.__tccDirectResolverPowerV1=true;if(current.__tccDirectSmokeFix)wrapped.__tccDirectSmokeFix=true;
    window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}return true;
  }
  function boot(){
    loadCatalog();let tries=0;const timer=setInterval(()=>{tries++;const a=installExpansion(),b=installPricingExtension();if((a&&b)||tries>240)clearInterval(timer)},50);
    document.addEventListener('tcc:bump-map-ready',()=>{installExpansion();installPricingExtension();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else queueMicrotask(boot);
  window.TCCBumpDirectV8={revision:REVISION,loadCatalog,validateCatalog,addOffers,resolve,basePricing,bumpExtras,conditionsMet,isBumpOperator,installPricingExtension,installExpansion,get catalog(){return window.TCC_BUMP_DIRECT_CATALOG_V1||null}};
})();
