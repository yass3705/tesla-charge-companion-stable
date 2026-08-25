// Tesla Charge Companion V8 RC4.8 — La Borne Bleue direct strict (Ile-de-France).
// Source physique: inventaire IRVE Alize/Bouygues filtre explicitement sur le reseau
// La Borne Bleue. Tarifs: grille officielle applicable depuis le 03/04/2025.
// Les reseaux partenaires restent hors de cette couche et l'abonnement est opt-in.
(function(){
  'use strict';
  const DATA_URL='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/national/labornebleue_direct_stations_idf.json.gz';
  const REVISION='rc48-labornebleue-direct-20260825a';
  const SUBSCRIPTION_ID='labornebleue-annual';
  const MAX_MATCH_METERS=120;
  const MAX_NEUTRAL_MATCH_METERS=35;
  const MAX_PREPARED_STATIONS=80;
  const DATA_VERSION='20260825a';
  let dataPromise=null,candidateInstalled=false,pricingInstalled=false,lastPrepared=null,subscriptionShimmed=false,uiObserver=null,uiBusy=false;

  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const toMinutes=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})/);return m?(Number(m[1])*60+Number(m[2]))%1440:NaN;};
  const minuteAt=(start,offset)=>(Number(start||0)+offset)%1440;
  const inWindow=(m,start,end)=>{const s=toMinutes(start),e=end==='24:00'?1440:toMinutes(end);if(!Number.isFinite(s)||!Number.isFinite(e))return false;if(s===e)return true;return s<e?(m>=s&&m<e):(m>=s||m<e);};

  function haversineKm(aLat,aLon,bLat,bLon){
    const R=6371,toRad=x=>Number(x)*Math.PI/180,p1=toRad(aLat),p2=toRad(bLat),dp=toRad(Number(bLat)-Number(aLat)),dl=toRad(Number(bLon)-Number(aLon));
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }

  function validateExact(exact){
    if(!exact||exact.currency!=='EUR')throw new Error('tarif La Borne Bleue hors EUR/invalide');
    if(exact.model==='per_minute'){
      if(!(Number(exact.ratePerMinute)>=0))throw new Error('tarif minute invalide');
      return true;
    }
    if(exact.model==='time_windows'){
      const windows=Array.isArray(exact.windows)?exact.windows:[];
      if(!windows.length)throw new Error('fenetres horaires absentes');
      for(const w of windows){
        if(!text(w.start)||!text(w.end)||!(Number(w.ratePerMinute)>=0))throw new Error('fenetre horaire invalide');
        if(w.capEur!=null&&!(Number(w.capEur)>0))throw new Error('plafond nocturne invalide');
      }
      return true;
    }
    if(exact.model==='kwh_plus_elapsed'){
      if(!(Number(exact.pricePerKwh)>=0)||!(Number(exact.afterMinutes)>=0)||!(Number(exact.afterRatePerMinute)>=0))throw new Error('tarif DC invalide');
      return true;
    }
    throw new Error(`modele La Borne Bleue inconnu: ${exact.model||'—'}`);
  }

  function validateData(data){
    if(data?.dataset!=='labornebleue-direct-tcc-v8-idf'||data?.schemaVersion!=='1.0.0')throw new Error('dataset La Borne Bleue V8 inattendu');
    const scope=data?.scope||{},counts=data?.counts||{};
    if(scope.countryCode!=='FR'||scope.region!=='Ile-de-France'||scope.onlyDirectCpo!==true||scope.strictExplicitNetworkLabel!==true)throw new Error('perimetre La Borne Bleue direct invalide');
    if(scope.partnerLocationsIncluded!==false||scope.partnerTariffsIncluded!==false||scope.subscriptionDiscountAtPartnerOperators!==false)throw new Error('itinérance/partenaires ne doivent pas entrer dans La Borne Bleue direct');
    if(Number(scope.subscriptionAnnualFeeEur)!==10||scope.dcTariffRule!=='strictly_above_50_kw')throw new Error('regles abonnement/DC inattendues');
    const stations=Array.isArray(data?.stations)?data.stations:[];
    if(stations.length!==Number(counts.publishedStations)||stations.length<350||stations.length>650)throw new Error(`inventaire La Borne Bleue inattendu (${stations.length})`);
    if(Number(counts.strictSourceChargePoints)<1000||Number(counts.strictSourceChargePoints)>1600)throw new Error(`nombre de points La Borne Bleue inattendu (${counts.strictSourceChargePoints})`);
    const ids=new Set();let configs=0;
    for(const st of stations){
      if(!text(st.stationId)||ids.has(st.stationId))throw new Error(`station La Borne Bleue invalide/dupliquee: ${st?.stationId||'—'}`);
      ids.add(st.stationId);
      if(st.countryCode!=='FR'||!Number.isFinite(Number(st.latitude))||!Number.isFinite(Number(st.longitude)))throw new Error(`coordonnees La Borne Bleue invalides: ${st.stationId}`);
      const cs=Array.isArray(st.configurations)?st.configurations:[];
      if(!cs.length)throw new Error(`station La Borne Bleue sans configuration tarifable: ${st.stationId}`);
      for(const cfg of cs){
        if(cfg?.labornebleueDirect!==true||cfg?.labornebleueVerified!==true||cfg?.labornebleueOwnNetworkOnly!==true||cfg?.offerType!=='operator_direct')throw new Error(`configuration La Borne Bleue non stricte: ${st.stationId}`);
        if(!['AC','DC'].includes(text(cfg.kind).toUpperCase())||!(Number(cfg.powerKw)>0)||!(Number(cfg.stalls)>0))throw new Error(`puissance La Borne Bleue invalide: ${st.stationId}`);
        if(cfg.subscriptionId!==null&&cfg.subscriptionId!==SUBSCRIPTION_ID)throw new Error(`abonnement La Borne Bleue invalide: ${st.stationId}`);
        validateExact(cfg?.pricing?.labornebleueExact);
        configs++;
      }
    }
    if(configs!==Number(counts.publishedConfigurations)||configs<stations.length*2)throw new Error(`comptage configurations La Borne Bleue incoherent (${configs})`);
    return data;
  }

  async function gunzipJson(response){
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('compression La Borne Bleue invalide');
    if(typeof DecompressionStream!=='function')throw new Error('decompression gzip non prise en charge');
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }

  async function loadData(){
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=${DATA_VERSION}`,{cache:'no-store'}).then(async r=>{
      if(!r.ok)throw new Error(`base La Borne Bleue indisponible (${r.status})`);
      return gunzipJson(r);
    }).then(data=>{validateData(data);window.TCC_LABORNEBLEUE_DIRECT_V8=data;return data;}).catch(err=>{
      dataPromise=null;console.warn('[TCC V8] La Borne Bleue direct ignoree:',err?.message||err);return null;
    });
    return dataPromise;
  }

  function isLikelyLabornebleueStation(st){
    const values=[st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name].map(norm).filter(Boolean);
    return values.some(v=>v.includes('la borne bleue')||v==='labornebleue'||v.includes('alize')||v.includes('bouygues energies')||v==='sipperec'||v.includes('sipperec'));
  }
  function configProvider(c){const explicit=text(c?.offerProvider);if(explicit)return explicit;const label=text(c?.label||c?.configurationLabel),i=label.indexOf('·');return(i>=0?label.slice(0,i):label).trim();}
  function configKey(c){return [norm(configProvider(c)),text(c?.kind).toUpperCase(),Number(c?.powerKw||0).toFixed(3),text(c?.subscriptionId),JSON.stringify(c?.pricing?.labornebleueExact||c?.pricing||null)].join('|');}
  function mergeConfigurations(sources,direct=[]){
    const out=[],seen=new Set();
    for(const st of sources)for(const cfg of (Array.isArray(st?.chargingConfigurations)?st.chargingConfigurations:[])){const key=configKey(cfg);if(seen.has(key))continue;seen.add(key);out.push(clone(cfg));}
    for(const cfg of direct){const key=configKey(cfg);if(seen.has(key))continue;seen.add(key);out.push(clone(cfg));}
    return out;
  }
  function locationAirKm(loc,origin){const v=[origin?.lat,origin?.lon,loc?.latitude,loc?.longitude].map(Number);return v.every(Number.isFinite)?haversineKm(...v):Infinity;}
  function stationAirKm(st,origin){const existing=Number(st?._airKm);if(Number.isFinite(existing))return existing;const v=[origin?.lat,origin?.lon,st?.latitude,st?.longitude].map(Number);return v.every(Number.isFinite)?haversineKm(...v):Infinity;}
  function inArea(data,prepared){const max=Math.max(0,Number(prepared?.maxDistanceKm||0)),origin=prepared?.origin||{};return(data?.stations||[]).map(st=>({...st,_airKm:locationAirKm(st,origin)})).filter(st=>Number.isFinite(st._airKm)&&(max<=0||st._airKm<=max+1e-9));}

  function buildAssignments(base,official){
    const pairs=[];
    base.forEach((st,index)=>{
      if(st?.source==='teslaSupercharger')return;
      const lat=Number(st?.latitude),lon=Number(st?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      official.forEach((loc,locIndex)=>{
        const meters=haversineKm(lat,lon,loc.latitude,loc.longitude)*1000;
        const allowed=meters<=MAX_NEUTRAL_MATCH_METERS+1e-6||(isLikelyLabornebleueStation(st)&&meters<=MAX_MATCH_METERS+1e-6);
        if(allowed)pairs.push({index,locIndex,meters});
      });
    });
    pairs.sort((a,b)=>a.meters-b.meters||a.index-b.index||a.locIndex-b.locIndex);
    const assignedBase=new Set(),byLocation=new Map();
    for(const pair of pairs){
      if(assignedBase.has(pair.index))continue;
      assignedBase.add(pair.index);
      if(!byLocation.has(pair.locIndex))byLocation.set(pair.locIndex,[]);
      byLocation.get(pair.locIndex).push(pair);
    }
    return{assignedBase,byLocation};
  }

  function directConfigs(loc){return (loc.configurations||[]).map(clone);}
  function canonicalFromMatches(loc,matches,base,origin){
    const ordered=matches.slice().sort((a,b)=>a.meters-b.meters),primary=base[ordered[0].index],sources=ordered.map(x=>base[x.index]),configurations=mergeConfigurations(sources,directConfigs(loc)),first=configurations.find(c=>c?.labornebleueDirect)||configurations[0];
    return {...primary,name:loc.name||primary.name,address:loc.address||primary.address,latitude:Number(loc.latitude),longitude:Number(loc.longitude),operator:'La Borne Bleue',countryCode:'FR',kind:first?.kind||primary.kind,powerKw:Number(first?.powerKw||primary.powerKw||11),pricing:first?.pricing||primary.pricing,chargingConfigurations:configurations,stalls:Math.max(Number(loc.chargePointCount||0),Number(primary.stalls||0)),_airKm:locationAirKm(loc,origin),labornebleueStrictCpo:true,labornebleueStationId:loc.stationId,labornebleueSourceCatalogStationIds:sources.map(x=>x.catalogStationId).filter(Boolean),labornebleueStatusJoinedExternally:true,labornebleueDirectConfigurationCount:(loc.configurations||[]).length,labornebleueMatchDistanceMeters:Math.round(ordered[0].meters),_labornebleueOverlayRevision:REVISION};
  }
  function syntheticFromOfficial(loc,origin){
    const configs=directConfigs(loc),first=configs[0],id=`labornebleue-direct:${loc.stationId}`;
    return{id,catalogStationId:id,name:loc.name||'Station La Borne Bleue',address:loc.address||'',operator:'La Borne Bleue',latitude:Number(loc.latitude),longitude:Number(loc.longitude),countryCode:'FR',source:'labornebleueDirectInventory',kind:first?.kind||'AC',powerKw:Number(first?.powerKw||11),stalls:Number(loc.chargePointCount||1),pricing:first?.pricing||{type:'rules',rules:[]},chargingConfigurations:configs,access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la couche tarifaire La Borne Bleue — acces a verifier.'},temporarilyUnavailable:false,readOnlyCatalog:true,operationalStatus:'unknown',operationalStatusSource:'',_airKm:locationAirKm(loc,origin),labornebleueStrictCpo:true,labornebleueStationId:loc.stationId,labornebleueSourceCatalogStationIds:[],labornebleueStatusJoinedExternally:false,labornebleueDirectConfigurationCount:configs.length,labornebleueMatchDistanceMeters:null,_labornebleueOverlayRevision:REVISION};
  }

  function mergePrepared(prepared,data){
    validateData(data);
    if(!prepared||!Array.isArray(prepared.stations))return prepared;
    if(prepared.labornebleueDirectOverlayApplied&&prepared.labornebleueDirectOverlayRevision===REVISION)return prepared;
    const base=prepared.stations.slice(),origin=prepared.origin||{},official=inArea(data,prepared),{assignedBase,byLocation}=buildAssignments(base,official),kept=base.filter((_,index)=>!assignedBase.has(index)),merged=[];
    let matched=0,added=0,collapsed=0;
    official.forEach((loc,locIndex)=>{const matches=byLocation.get(locIndex)||[];if(matches.length){merged.push(canonicalFromMatches(loc,matches,base,origin));matched++;collapsed+=Math.max(0,matches.length-1);}else{merged.push(syntheticFromOfficial(loc,origin));added++;}});
    let stations=[...kept,...merged];stations.forEach(st=>{if(!Number.isFinite(Number(st._airKm)))st._airKm=stationAirKm(st,origin);});stations.sort((a,b)=>stationAirKm(a,origin)-stationAirKm(b,origin));if(stations.length>MAX_PREPARED_STATIONS)stations=stations.slice(0,MAX_PREPARED_STATIONS);
    prepared.stations=stations;prepared.labornebleueDirectOverlayApplied=true;prepared.labornebleueDirectOverlayRevision=REVISION;prepared.labornebleueDirectOverlayStats={strictNationalStations:data.stations.length,strictNationalChargePoints:Number(data.counts?.strictSourceChargePoints||0),strictInPreparedArea:official.length,matchedRuntimeSites:matched,addedStrictSites:added,collapsedRuntimeDuplicates:collapsed,preparedStationCount:stations.length};return prepared;
  }
  async function applyToPrepared(prepared){const data=window.TCC_LABORNEBLEUE_DIRECT_V8||await loadData();return data?mergePrepared(prepared,data):prepared;}
  function installCandidateWrapper(){
    if(candidateInstalled)return true;const current=window.candidateStations;if(typeof current!=='function')return false;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){const result=await current.apply(this,arguments);if(filterMode!=='all'||!result||!Array.isArray(result.stations))return result;return applyToPrepared(result);};
    wrapped.__tccLabornebleueDirectV1=true;wrapped.__tccOriginal=current;window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}candidateInstalled=true;return true;
  }

  function occupiedMinutes(chargeMinutes,unplugTime,startTime){
    const charge=Math.max(0,Number(chargeMinutes||0));if(!unplugTime||!startTime)return charge;
    const a=toMinutes(startTime),b=toMinutes(unplugTime);if(!Number.isFinite(a)||!Number.isFinite(b))return charge;let delta=b-a;if(delta<0)delta+=1440;return Math.max(charge,delta);
  }
  function windowFor(exact,m){return (exact.windows||[]).find(w=>inWindow(m,w.start,w.end))||null;}
  function exactCost(pp,startMinute,chargeMinutes,billedEnergy,unplugTime,startTime){
    const exact=pp?.labornebleueExact;if(!exact)return null;validateExact(exact);
    const occupied=occupiedMinutes(chargeMinutes,unplugTime,startTime),start=Number.isFinite(Number(startMinute))?Number(startMinute):toMinutes(startTime);
    if(exact.model==='kwh_plus_elapsed'){
      const energyCost=Math.max(0,Number(billedEnergy||0))*Number(exact.pricePerKwh||0);
      // La grille officielle parle explicitement de minutes de charge, pas de stationnement.
      const extraMinutes=Math.max(0,Number(chargeMinutes||0)-Number(exact.afterMinutes||0));
      const timeCost=extraMinutes*Number(exact.afterRatePerMinute||0);
      return{total:energyCost+timeCost,energyCost,timeCost,sessionTimeCost:0,occupiedMinutes:occupied,billedMinutes:Number(chargeMinutes||0)};
    }
    const billedMinutes=occupied,byWindow=new Map();let sessionTimeCost=0;
    for(let i=0;i<Math.ceil(billedMinutes);i++){
      const fraction=Math.min(1,billedMinutes-i);if(fraction<=0)continue;
      if(exact.model==='per_minute'){sessionTimeCost+=fraction*Number(exact.ratePerMinute||0);continue;}
      const w=windowFor(exact,minuteAt(start,i));if(!w)throw new Error(`aucune fenetre tarifaire a ${minuteAt(start,i)} min`);
      byWindow.set(w,(byWindow.get(w)||0)+fraction*Number(w.ratePerMinute||0));
    }
    for(const [w,raw] of byWindow.entries())sessionTimeCost+=Number(w.capEur)>0?Math.min(raw,Number(w.capEur)):raw;
    return{total:sessionTimeCost,energyCost:0,timeCost:0,sessionTimeCost,occupiedMinutes:occupied,billedMinutes};
  }
  function installPricing(){
    if(pricingInstalled||window.__TCC_LABORNEBLEUE_PRICING_INSTALLED__)return true;const current=window.priceWithRules;if(typeof current!=='function')return false;
    const wrapped=function(pp,startMinute,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      if(!pp?.labornebleueExact)return current.apply(this,arguments);
      let exact;try{exact=exactCost(pp,startMinute,chargeMinutes,billedEnergy,unplugTime,startTime);}catch(err){return{error:`Tarif La Borne Bleue strict invalide: ${err.message}`};}
      return{total:exact.total,connection:0,chargeCost:exact.energyCost+exact.timeCost+exact.sessionTimeCost,idleCost:0,durationSurcharge:0,occupiedMinutes:exact.occupiedMinutes,currencies:['EUR'],labornebleueDirectPricing:true,labornebleueExactPricing:true,labornebleueEnergyCost:exact.energyCost,labornebleueAdditionalChargeTimeCost:exact.timeCost,labornebleueSessionTimeCost:exact.sessionTimeCost,labornebleueBilledMinutes:exact.billedMinutes};
    };
    wrapped.__tccLabornebleueExactV1=true;wrapped.__tccOriginal=current;window.priceWithRules=wrapped;try{priceWithRules=wrapped}catch(e){}pricingInstalled=true;window.__TCC_LABORNEBLEUE_PRICING_INSTALLED__=true;return true;
  }

  function readSubscriptionState(){try{const s=JSON.parse(localStorage.getItem('tccSubscriptionsV1')||'{}');return new Set(Array.isArray(s.selected)?s.selected:[])}catch(e){return new Set()}}
  function setSubscriptionSelected(enabled){
    const selected=readSubscriptionState();if(enabled)selected.add(SUBSCRIPTION_ID);else selected.delete(SUBSCRIPTION_ID);
    localStorage.setItem('tccSubscriptionsV1',JSON.stringify({selected:[...selected],updatedAt:new Date().toISOString()}));
    window.TCCV8Subscriptions?.applyAll?.(true);
    const run=window.compare;if(typeof run==='function'&&document.querySelector('#results .result-card'))setTimeout(()=>{try{Promise.resolve(run()).catch(()=>{})}catch(e){}},0);
  }
  function registerPlan(){
    const overlay=window.TCC_TARIFF_OVERLAY_V1;if(!overlay||!Array.isArray(overlay.subscriptions))return false;
    if(!overlay.subscriptions.some(p=>text(p?.selectionId||p?.id)===SUBSCRIPTION_ID))overlay.subscriptions.push({id:SUBSCRIPTION_ID,provider:'La Borne Bleue — Abonnement',offerType:'subscription',runtime:'existing_labornebleue_direct',monthlyFeeLabel:'10 €/an',defaultSelected:false,operatorAliases:['La Borne Bleue'],directOperatorOnly:true,source:'data-lab/labornebleue_official_idf.json'});
    return true;
  }
  function installSubscriptionApiShim(){
    const api=window.TCCV8Subscriptions;if(!api||subscriptionShimmed)return false;
    const previousProvider=typeof api.subscriptionIdForProvider==='function'?api.subscriptionIdForProvider.bind(api):()=>'';
    const previousStation=typeof api.subscriptionIdForStation==='function'?api.subscriptionIdForStation.bind(api):()=>'';
    const previousEligible=typeof api.isStationEligible==='function'?api.isStationEligible.bind(api):null;
    api.subscriptionIdForProvider=value=>norm(value).includes('la borne bleue direct abonne')?SUBSCRIPTION_ID:previousProvider(value);
    api.subscriptionIdForStation=st=>text(st?.subscriptionId||st?.subscriptionSelectionId)||api.subscriptionIdForProvider(st?.configurationLabel||st?.label||st?.offerProvider)||previousStation(st);
    api.isStationEligible=(st,selected=readSubscriptionState())=>{const id=api.subscriptionIdForStation(st);if(id===SUBSCRIPTION_ID)return selected.has(SUBSCRIPTION_ID);return previousEligible?previousEligible(st,selected):true;};
    subscriptionShimmed=true;return true;
  }
  function providerText(row){const el=row.querySelector('.v8-offer-provider');return norm(el?.textContent||row.dataset?.tccProvider||'');}
  function tagSubscriptionRows(){
    document.querySelectorAll('#results .v8-offer-row').forEach(row=>{if(providerText(row).includes('la borne bleue direct abonne')){row.dataset.subscriptionId=SUBSCRIPTION_ID;row.dataset.tccProvider='La Borne Bleue direct — Abonné';}});
  }
  function injectSubscriptionControl(){
    const box=document.getElementById('v8SubscriptionsBox');if(!box)return false;
    let host=document.getElementById('tccLabornebleueSubscriptionControl');
    const checked=readSubscriptionState().has(SUBSCRIPTION_ID);
    if(!host){
      host=document.createElement('label');host.id='tccLabornebleueSubscriptionControl';host.className='v8-subscription-choice';
      host.style.cssText='display:flex;align-items:flex-start;gap:8px;padding:9px 10px;margin-top:8px;border:1px solid #33333a;border-radius:11px;font-size:11px';
      host.innerHTML='<input type="checkbox" data-labornebleue-subscription style="width:auto!important;margin-top:2px"><span><b>La Borne Bleue — Abonnement</b><span style="display:block;color:#8f8f96;font-size:9px;margin-top:2px">10 €/an · tarif préférentiel sur le réseau propre</span></span>';
      const grid=box.querySelector('.v8-subscriptions-grid');(grid||box).appendChild(host);
      host.querySelector('input').addEventListener('change',e=>setSubscriptionSelected(!!e.target.checked));
    }
    const input=host.querySelector('input');if(input)input.checked=checked;return true;
  }
  function installUiObserver(){
    const root=document.documentElement;if(!root||uiObserver)return false;
    let timer=null;uiObserver=new MutationObserver(()=>{if(uiBusy)return;clearTimeout(timer);timer=setTimeout(()=>{uiBusy=true;try{registerPlan();installSubscriptionApiShim();tagSubscriptionRows();injectSubscriptionControl();window.TCCV8Subscriptions?.applyAll?.(true);}finally{uiBusy=false;}},120)});uiObserver.observe(root,{childList:true,subtree:true});return true;
  }

  function markRevision(){const banner=document.getElementById('tccPreviewBanner');if(banner&&/RC4\.8/.test(text(banner.textContent))&&!/Borne Bleue/i.test(text(banner.textContent)))banner.textContent=`${text(banner.textContent)} · La Borne Bleue direct`;}

  loadData();let attempts=0;
  const timer=setInterval(async()=>{
    attempts++;installPricing();installCandidateWrapper();registerPlan();installSubscriptionApiShim();installUiObserver();injectSubscriptionControl();tagSubscriptionRows();
    const prepared=window.TCC_V8_AREA_CACHE?.prepared;if(prepared&&prepared!==lastPrepared){await applyToPrepared(prepared);lastPrepared=prepared;window.TCC_V8_AREA_CACHE.prepared=prepared;}
    markRevision();if(attempts>2400)clearInterval(timer);
  },50);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{markRevision();installUiObserver();injectSubscriptionControl();tagSubscriptionRows();},0),{once:true});else setTimeout(()=>{markRevision();installUiObserver();injectSubscriptionControl();tagSubscriptionRows();},0);

  window.TCCV8LaBorneBleueDirect={loadData,validateData,validateExact,mergePrepared,applyToPrepared,isLikelyLabornebleueStation,exactCost,installPricing,installCandidateWrapper,registerPlan,installSubscriptionApiShim,tagSubscriptionRows,subscriptionId:SUBSCRIPTION_ID,revision:REVISION};
  console.info('[TCC V8] La Borne Bleue direct strict pret : inventaire + tarifs public/abonne exacts + abonnement opt-in.');
})();
