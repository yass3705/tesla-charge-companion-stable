// Tesla Charge Companion V8 — Allego France CPO-direct exact station/EVSE tariffs.
// DXP is the tariff source. Roaming and country-default prices are never promoted.
(function(){
  'use strict';
  const REVISION='allego-direct-v2-20260826';
  const DATA_URL='data/allego_direct_stations_france.json.gz';
  const KINGDOM_SELECTION_ID='burger-king-kingdom';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  let dataPromise=null;

  function geoDistanceKm(aLat,aLon,bLat,bLon){
    const A=Number(aLat),B=Number(aLon),C=Number(bLat),D=Number(bLon);
    if(![A,B,C,D].every(Number.isFinite))return Infinity;
    const R=6371,toRad=x=>x*Math.PI/180,dLat=toRad(C-A),dLon=toRad(D-B);
    const q=Math.sin(dLat/2)**2+Math.cos(toRad(A))*Math.cos(toRad(C))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(q));
  }

  async function readGzipJson(url){
    const r=await fetch(`${url}?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`Base Allego indisponible (${r.status})`);
    const bytes=new Uint8Array(await r.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('Compression Allego invalide');
    if(typeof DecompressionStream!=='function')throw new Error('Décompression gzip Allego indisponible');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  function validateCatalog(data){
    const c=data?.counts||{};
    if(data?.dataset!=='allego-direct-operated-evse-france'||data?.schemaVersion!=='3.1.0'||data?.operator!=='Allego'||data?.country!=='FR')throw new Error('Dataset Allego inattendu');
    if(data?.scope?.operatorDirectOnly!==true||data?.scope?.roamingIncluded!==false||data?.scope?.countryDefaultsAreRankable!==false)throw new Error('Périmètre Allego Direct invalide');
    if(data?.scope?.exactDirectPricesFromDxp!==true||data?.scope?.structuredTimeFeesAreRankable!==true||data?.scope?.conditionalOffersRequireSelection!==true)throw new Error('Sémantique Allego v8 incomplète');
    if(!Array.isArray(data?.stations)||data.stations.length<140||Number(c.franceEvseCount)<1000)throw new Error('Inventaire Allego France incomplet');
    if(Number(c.rankableEvseCount)<1100||Number(c.coveragePct)<99)throw new Error('Couverture Allego DXP insuffisante');
    if(Number(c.stationsWithCoordinates)<140||Number(c.irveLinkedEvseCount)<1000)throw new Error('Géométrie IRVE Allego insuffisante');
    return data;
  }

  async function loadCatalog(){
    if(window.TCC_ALLEGO_DIRECT_CATALOG_V2)return validateCatalog(window.TCC_ALLEGO_DIRECT_CATALOG_V2);
    if(!dataPromise)dataPromise=readGzipJson(DATA_URL).then(validateCatalog).then(data=>{
      window.TCC_ALLEGO_DIRECT_CATALOG_V2=data;return data;
    }).catch(err=>{
      console.warn('[TCC V8] Base Allego Direct ignorée :',err?.message||err);
      return {stations:[],counts:{},generatedAt:''};
    });
    return dataPromise;
  }

  function pricingRules(price,conditionalOffer=null){
    const p=Number(price);
    if(!conditionalOffer)return[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:p,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}];
    const special=Number(conditionalOffer.pricePerKwhEur),start=text(conditionalOffer.start)||'14:30',end=text(conditionalOffer.end)||'18:30';
    return [
      {scope:'timeWindow',start:'00:00',end:start,billing:'kwh',currency:'EUR',pricePerKwh:p,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0},
      {scope:'timeWindow',start,end,billing:'kwh',currency:'EUR',pricePerKwh:special,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0},
      {scope:'timeWindow',start:end,end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:p,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0}
    ];
  }

  function pricing(evse,conditionalOffer=null){
    return {type:'rules',rules:pricingRules(evse.directEurPerKwh,conditionalOffer),allegoFeePolicy:evse.feePolicy||null,allegoExactDirect:true};
  }

  function feeSignature(policy){return JSON.stringify(policy||null)}
  function groupKey(evse){return [text(evse.kind).toUpperCase(),Number(evse.powerKw||0).toFixed(3),Number(evse.directEurPerKwh||0).toFixed(6),feeSignature(evse.feePolicy)].join('|')}

  function directConfigurations(record){
    const groups=new Map();
    for(const evse of record?.evses||[]){
      if(evse?.rankableDirect!==true)continue;
      const price=Number(evse.directEurPerKwh),power=Number(evse.powerKw),kind=text(evse.kind).toUpperCase();
      if(!(price>0)||!(power>0)||!['AC','DC'].includes(kind))continue;
      const key=groupKey(evse);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(evse);
    }
    const stationKey=text(record?.stationId||record?.irveStationIds?.[0]||record?.stationKey||record?.name).replace(/[^A-Za-z0-9_-]+/g,'-');
    const out=[];
    let seq=0;
    for(const evses of groups.values()){
      const sample=evses[0],kind=text(sample.kind).toUpperCase(),power=Number(sample.powerKw),ids=evses.map(e=>text(e.evseId)).filter(Boolean);
      out.push({
        id:`allego-direct-${stationKey}-${++seq}`,label:`Allego Direct · ${kind} ${power} kW`,kind,powerKw:power,stalls:evses.length,
        pricing:pricing(sample),offerProvider:'Allego Direct',offerType:'operator_direct',allegoDirect:true,allegoVerified:true,
        allegoEvseIds:ids,allegoPricePerKwhEur:Number(sample.directEurPerKwh),allegoFeePolicy:sample.feePolicy||null,
        allegoDxpChargePointIds:[...new Set(evses.map(e=>text(e.dxpChargePointId||e.resolvedChargePointId)).filter(Boolean))]
      });
      const eligible=evses.filter(e=>(e.conditionalOffers||[]).some(o=>text(o.selectionId)===KINGDOM_SELECTION_ID));
      if(eligible.length){
        const offer=eligible[0].conditionalOffers.find(o=>text(o.selectionId)===KINGDOM_SELECTION_ID);
        out.push({
          id:`allego-kingdom-${stationKey}-${seq}`,label:`Burger King Kingdom · ${kind} ${power} kW`,kind,powerKw:power,stalls:eligible.length,
          pricing:pricing(sample,offer),offerProvider:'Burger King Kingdom',offerType:'subscription',subscriptionId:KINGDOM_SELECTION_ID,subscriptionSelectionId:KINGDOM_SELECTION_ID,
          allegoDirect:true,allegoVerified:true,allegoConditionalOffer:true,allegoEvseIds:eligible.map(e=>text(e.evseId)).filter(Boolean),
          allegoBasePricePerKwhEur:Number(sample.directEurPerKwh),allegoSpecialPricePerKwhEur:Number(offer.pricePerKwhEur),allegoSpecialStart:offer.start,allegoSpecialEnd:offer.end,
          allegoFeePolicy:sample.feePolicy||null
        });
      }
    }
    return out;
  }

  function providerOf(c){return norm(c?.offerProvider||text(c?.label).split('·')[0])}
  function mergeConfigurations(existing,direct){
    const kept=(existing||[]).filter(c=>!(providerOf(c)==='allego direct'||c?.allegoDirect===true));
    return [...direct,...kept];
  }

  function recordId(record){return text(record?.stationId||record?.irveStationIds?.[0]||record?.stationKey||record?.name)}
  function stationNameKey(v){return norm(v).replace(/\b(station|charging|charge|borne|allego|france)\b/g,' ').replace(/\s+/g,' ').trim()}
  function isAllegoOperator(st){
    return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name].map(norm).filter(Boolean).some(v=>v==='allego'||v.startsWith('allego ')||v.includes(' allego '));
  }
  function bestRecordForStation(station,records,used){
    let best=null;
    for(const record of records){
      const id=recordId(record);if(!id||used.has(id))continue;
      const c=record.coordinates||[],distance=geoDistanceKm(station.latitude,station.longitude,c[0],c[1]);if(distance>.20+1e-9)continue;
      const a=stationNameKey(station.name),b=stationNameKey(record.name),same=!!(a&&b&&(a.includes(b)||b.includes(a)));
      const score=distance-(same?.04:0);if(!best||score<best.score)best={record,score,distance};
    }
    return best;
  }

  function mergedStation(record,base=null){
    const direct=directConfigurations(record);if(!direct.some(c=>c.offerProvider==='Allego Direct'))return base;
    const coords=record.coordinates||[],first=direct.find(c=>c.offerProvider==='Allego Direct');
    const existing=Array.isArray(base?.chargingConfigurations)?base.chargingConfigurations:[];
    const configs=mergeConfigurations(existing,direct);
    const normal=direct.filter(c=>c.offerProvider==='Allego Direct');
    const station={
      ...(base||{}),
      id:base?.id||`france-catalog:allego:${recordId(record)}`,catalogStationId:base?.catalogStationId||`allego:${recordId(record)}`,
      source:base?.source||'franceNationalCatalog',countryCode:'FR',name:record.name||base?.name||'Station Allego',address:record.irveAddress||record.address||base?.address||'',
      latitude:Number(coords[0]),longitude:Number(coords[1]),operator:'Allego',chargingConfigurations:configs,
      stalls:normal.reduce((s,c)=>s+Number(c.stalls||0),0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,
      lastUpdated:String(window.TCC_ALLEGO_DIRECT_CATALOG_V2?.generatedAt||'').slice(0,10),allegoStrictCpo:true,allegoDirectPricingContext:'official_dxp',
      allegoIrveStationIds:[...(record.irveStationIds||[])],allegoOfficialEvseIds:(record.evses||[]).map(e=>e.evseId).filter(Boolean),
      allegoDirectEvseCount:normal.reduce((s,c)=>s+Number(c.stalls||0),0),allegoPricingStatus:record.pricingStatus||'',allegoStatusJoinedExternally:!!base
    };
    if(!base)station.access={limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires à vérifier dans Allego.'};
    return station;
  }

  function overlayPrepared(prepared,data,maxDistanceKm=0){
    if(!prepared||!Array.isArray(prepared.stations)||!Array.isArray(data?.stations))return prepared;
    const origin=prepared.origin||{},radius=Number(maxDistanceKm)||0;
    const records=data.stations.filter(r=>r?.rankableDirect===true&&Array.isArray(r.coordinates)&&r.coordinates.length>=2)
      .filter(r=>!(radius>0)||geoDistanceKm(origin.lat,origin.lon,r.coordinates[0],r.coordinates[1])<=radius+1e-6);
    const used=new Set(),output=[];let matched=0,added=0,directEvses=0;
    for(const st of prepared.stations){
      if(!isAllegoOperator(st)){output.push(st);continue;}
      const best=bestRecordForStation(st,records,used);if(!best){output.push(st);continue;}
      const id=recordId(best.record);used.add(id);const merged=mergedStation(best.record,st);
      if(merged){output.push(merged);matched++;directEvses+=Number(merged.allegoDirectEvseCount||0)}else output.push(st);
    }
    for(const record of records){
      const id=recordId(record);if(used.has(id))continue;const st=mergedStation(record,null);if(!st)continue;
      st._airKm=geoDistanceKm(origin.lat,origin.lon,st.latitude,st.longitude);output.push(st);used.add(id);added++;directEvses+=Number(st.allegoDirectEvseCount||0);
    }
    output.sort((a,b)=>Number(a._airKm??Infinity)-Number(b._airKm??Infinity));
    prepared.stations=output;prepared.allegoDirectCatalogLoaded=true;
    prepared.allegoMergeStats={sourceStations:data.stations.length,rankableInArea:records.length,matched,added,directEvses,outputStations:output.length};
    window.TCC_ALLEGO_MERGE_STATS={...prepared.allegoMergeStats};return prepared;
  }

  function minute(v){const m=text(v).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN}
  function inWindow(m,start,end){const s=minute(start),e=minute(end);if(!Number.isFinite(s)||!Number.isFinite(e))return false;return s<e?(m>=s&&m<e):(m>=s||m<e)}
  function occupiedMinutes(startTime,chargeMinutes,unplugTime){
    if(!unplugTime)return chargeMinutes;const s=minute(startTime),u=minute(unplugTime);if(!Number.isFinite(s)||!Number.isFinite(u))return chargeMinutes;
    let d=u-s;if(d<0)d+=1440;return Math.max(chargeMinutes,d);
  }
  function customAllegoFee(policy,startMin,chargeMinutes,occupied){
    if(!policy)return{idle:0,overstay:0,total:0};let idle=0,overstay=0;
    if(policy.type==='idle_after_charging'){
      const rate=Math.max(0,Number(policy.ratePerMinuteEur||0)),threshold=Math.max(0,Number(policy.notBeforeSessionMinute||0));
      const begin=Math.max(chargeMinutes,threshold);
      for(let i=Math.floor(begin);i<Math.ceil(occupied);i++){const from=Math.max(begin,i),to=Math.min(occupied,i+1);if(to>from)idle+=(to-from)*rate;}
    }else if(policy.type==='connection_overstay'){
      const rate=Math.max(0,Number(policy.ratePerMinuteEur||0)),begin=Math.max(0,Number(policy.startAfterSessionMinutes||0)),end=Math.max(begin,Number(policy.endAfterSessionMinutes||Infinity));
      const windows=Array.isArray(policy.activeTimeWindows)&&policy.activeTimeWindows.length?policy.activeTimeWindows:[{start:'00:00',end:'24:00'}];
      const stop=Math.min(occupied,end);
      for(let i=Math.floor(begin);i<Math.ceil(stop);i++){
        const from=Math.max(begin,i),to=Math.min(stop,i+1);if(to<=from)continue;
        const clock=(startMin+i)%1440;if(windows.some(w=>inWindow(clock,w.start,w.end)))overstay+=(to-from)*rate;
      }
    }
    return{idle,overstay,total:idle+overstay};
  }

  function installPricingExtension(){
    const current=window.priceWithRules;if(typeof current!=='function')return false;if(current.__tccAllegoFeeV2)return true;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments){
      const result=current.call(this,pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments);if(!result||result.error)return result;
      const policy=pp?.allegoFeePolicy;if(!policy)return result;
      const occupied=occupiedMinutes(startTime,chargeMinutes,unplugTime),fee=customAllegoFee(policy,startMin,chargeMinutes,occupied);
      result.total=Number(result.total||0)+fee.total;result.idleCost=Number(result.idleCost||0)+fee.idle;result.durationSurcharge=Number(result.durationSurcharge||0)+fee.overstay;
      result.allegoFeeCost=fee.total;result.allegoFeePolicy=policy;return result;
    };
    wrapped.__tccAllegoFeeV2=true;wrapped.__tccOriginal=current;window.priceWithRules=wrapped;try{priceWithRules=wrapped}catch(e){}return true;
  }

  function registerKingdomPlan(){
    const api=window.TCCV8Subscriptions;if(typeof api?.registerPlan!=='function')return false;
    api.registerPlan({id:KINGDOM_SELECTION_ID,selectionId:KINGDOM_SELECTION_ID,provider:'Burger King Kingdom — Allego',offerType:'loyalty_direct',monthlyFeeEur:0,monthlyFeeLabel:'Gratuit · compte Kingdom lié',defaultSelected:false,operatorAliases:['Allego'],directOperatorOnly:true,source:'https://www.burgerking.fr/page/communiques-presse'});
    document.dispatchEvent(new CustomEvent('tcc:subscription-plan-registered'));return true;
  }

  function installCandidateOverlay(){
    const current=window.candidateStations;if(typeof current!=='function')return false;if(current.__tccAllegoDirectV2)return true;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){
      const prepared=await current.call(this,filterMode,maxDistanceKm);if(filterMode!=='all')return prepared;
      const data=await loadCatalog();return overlayPrepared(prepared,data,maxDistanceKm);
    };
    wrapped.__tccAllegoDirectV2=true;wrapped.__tccOriginal=current;window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}return true;
  }

  function boot(){
    installPricingExtension();installCandidateOverlay();
    if(!registerKingdomPlan()){let tries=0;const timer=setInterval(()=>{tries++;if(registerKingdomPlan()||tries>=20)clearInterval(timer)},250);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else queueMicrotask(boot);

  window.TCCAllegoDirectV8={revision:REVISION,loadCatalog,validateCatalog,directConfigurations,mergedStation,overlayPrepared,customAllegoFee,installPricingExtension,registerKingdomPlan,installCandidateOverlay,clearCache(){dataPromise=null;delete window.TCC_ALLEGO_DIRECT_CATALOG_V2;}};
  console.info('[TCC V8] Allego Direct DXP + Burger King Kingdom prêt.');
})();
