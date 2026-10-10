(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9ProductionShell=api;if(root.document)api.install(root).catch(err=>console.error('[TCC V9 shell] install failed',err));}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const V7_DC_POINTS=[[0,175],[10,175],[20,170],[30,160],[40,145],[50,125],[60,105],[70,85],[80,60],[85,42],[90,28],[95,16],[98,10],[100,6]];
  const SUBSCRIPTION_KEY='tccV9SelectedSubscriptionsV1';
  const CONGESTION_PREF_KEY='tccV9StationCongestionOptInV1';
  function congestionPreferences(w){try{const a=JSON.parse(w.localStorage.getItem(CONGESTION_PREF_KEY)||'{}');return a&&typeof a==='object'&&!Array.isArray(a)?a:{};}catch(_){return{};}}
  function setCongestionPreference(w,id,on){const a=congestionPreferences(w);if(on)a[id]=true;else delete a[id];try{w.localStorage.setItem(CONGESTION_PREF_KEY,JSON.stringify(a));}catch(_){}}
  function hasCongestionPricing(st){return(st?.offers||[]).some(o=>(o?.pricing?.rules||[]).some(r=>(num(r?.congestionTimePerMinute)||0)>0||(num(r?.electraCongestionPolicy?.rateEurPerMinute)||0)>0||(r?.ocpiCongestionDurationBands||[]).some(b=>Array.isArray(b)&&(num(b[2])||0)>0)));}

  function selectedSubscriptions(w){
    try{const raw=JSON.parse(w.localStorage.getItem(SUBSCRIPTION_KEY)||'[]');return Array.isArray(raw)?[...new Set(raw.map(text).filter(Boolean))]:[];}catch(_){return[];}
  }
  function saveSelectedSubscriptions(w,ids){const clean=[...new Set((ids||[]).map(text).filter(Boolean))];try{w.localStorage.setItem(SUBSCRIPTION_KEY,JSON.stringify(clean));}catch(_){}return clean;}
  function subscriptionLabel(row){const provider=text(row?.provider),label=text(row?.label),id=text(row?.id);if(label&&label!==id)return label;if(provider&&provider!==id)return provider;return id;}
  function renderSubscriptionSelector(w,options,countryCode){
    const compare=w.document.getElementById('compare'),card=compare?.querySelector('.card');if(!card)return;
    let box=w.document.getElementById('v9SubscriptionSelector');
    if(!box){box=w.document.createElement('details');box.id='v9SubscriptionSelector';box.className='box';box.style.marginTop='10px';const primary=card.querySelector('button.primary');if(primary)card.insertBefore(box,primary);else card.appendChild(box);}
    const selected=new Set(selectedSubscriptions(w)),rows=(options||[]).slice();
    box.innerHTML=`<summary><b>Abonnements recharge</b> <span class="small">(${rows.length} compatible(s) en ${esc(countryCode)})</span></summary><div class="small" style="margin-top:8px">Les abonnements sélectionnés s'appliquent automatiquement dans tous les pays où leur compatibilité est vérifiée.</div><div id="v9SubscriptionChoices" style="margin-top:8px">${rows.length?rows.map(row=>{const id=text(row.id),checked=selected.has(id)?' checked':'';const countries=(row.countries||[]).join(', ');return `<label style="display:block;margin:7px 0"><input type="checkbox" data-v9-subscription-id="${esc(id)}" style="width:auto"${checked}> ${esc(subscriptionLabel(row))}${countries?` <span class="small">· ${esc(countries)}</span>`:''}</label>`;}).join(''):'<span class="small">Aucun abonnement tarifaire vérifié pour cette zone.</span>'}</div>`;
    box.querySelectorAll('input[data-v9-subscription-id]').forEach(input=>input.addEventListener('change',()=>{const current=new Set(selectedSubscriptions(w)),id=text(input.dataset.v9SubscriptionId);if(input.checked)current.add(id);else current.delete(id);saveSelectedSubscriptions(w,[...current]);w.compare();}));
  }

  function rankingWeights(mode){if(mode==='price')return{price:.7,distance:.3};if(mode==='distance')return{price:.3,distance:.7};return{price:.5,distance:.5};}
  function rankRows(rows,mode='balanced',limit=20){
    const available=(rows||[]).filter(x=>Number.isFinite(x.total)&&Number.isFinite(x.distanceKm));
    const unknown=(rows||[]).filter(x=>!Number.isFinite(x.total)&&Number.isFinite(x.distanceKm)).sort((a,b)=>a.distanceKm-b.distanceKm);
    if(!available.length)return unknown.slice(0,limit);
    const costs=available.map(x=>x.total),distances=available.map(x=>x.distanceKm),minC=Math.min(...costs),maxC=Math.max(...costs),minD=Math.min(...distances),maxD=Math.max(...distances),w=rankingWeights(mode);
    for(const row of available){const cn=maxC===minC?0:(row.total-minC)/(maxC-minC),dn=maxD===minD?0:(row.distanceKm-minD)/(maxD-minD);row.shellScore=w.price*cn+w.distance*dn;}
    available.sort((a,b)=>a.shellScore-b.shellScore||a.total-b.total||a.distanceKm-b.distanceKm||text(a.station?.name).localeCompare(text(b.station?.name),'fr'));
    return available.concat(unknown).slice(0,limit);
  }
  function combineDateTime(date,time,startValue=null){
    if(!date||!time)return null;let d=new Date(`${date}T${time}:00`);if(!Number.isFinite(d.getTime()))return null;
    if(startValue){const start=new Date(startValue);if(Number.isFinite(start.getTime())&&d<=start)d=new Date(d.getTime()+24*60*60*1000);}
    return d.toISOString();
  }
  function dcCurve(condition='normal',profile='realistic'){
    const cf=condition==='warm'?1:(condition==='cold'?.68:.86),pf=profile==='optimistic'?1.08:(profile==='conservative'?.88:1);
    return V7_DC_POINTS.map(([soc,powerKw])=>({soc,powerKw:Math.max(3,powerKw*cf*pf)}));
  }
  function readInputs(w){
    const get=id=>w.document.getElementById(id),date=get('simDate')?.value||'',time=get('simTime')?.value||'',unplug=get('simUnplugTime')?.value||'',startAt=combineDateTime(date,time),disconnectAt=unplug?combineDateTime(date,unplug,startAt):null;
    const rawRadius=text(get('simMaxDistance')?.value),radius=rawRadius===''?0:Math.max(0,num(rawRadius)||0);
    return{startSoc:num(get('simNow')?.value),targetSoc:num(get('simTarget')?.value),date,time,startAt,disconnectAt,condition:get('simCondition')?.value||'normal',profile:get('simProfile')?.value||'realistic',operatorMode:get('simOperatorFilter')?.value||'tesla',rankingMode:get('simRanking')?.value||'balanced',radiusKm:radius,originText:text(get('simOrigin')?.value)};
  }
  function buildSession(input){return{startSoc:input.startSoc,targetSoc:input.targetSoc,startAt:input.startAt,disconnectAt:input.disconnectAt,targetCurrency:'EUR',batteryCapacityKwh:75,consumptionKwhPer100Km:15,vehicleMaxAcKw:11,vehicleMaxDcKw:250,chargeEfficiency:.92,chargeCurve:dcCurve(input.condition,input.profile),includeCongestionFees:false};}
  function diagnosticStore(w,event){try{const key='tccV9ProductionShellDiagnosticsV1',rows=JSON.parse(w.localStorage.getItem(key)||'[]');rows.unshift({...event,at:new Date().toISOString()});w.localStorage.setItem(key,JSON.stringify(rows.slice(0,20)));}catch(_){}}
  async function countryCodeForOrigin(w,origin){
    const cacheKey=`tcc-v9-country:${Number(origin.lat).toFixed(3)},${Number(origin.lon).toFixed(3)}`;
    try{const cached=w.sessionStorage.getItem(cacheKey);if(cached)return cached;}catch(_){ }
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(origin.lat)}&lon=${encodeURIComponent(origin.lon)}`;
    const response=await w.fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`country lookup ${response.status}`);const data=await response.json();const code=text(data?.address?.country_code).toUpperCase();if(!/^[A-Z]{2}$/.test(code))throw new Error('country unavailable');
    try{w.sessionStorage.setItem(cacheKey,code);}catch(_){ }return code;
  }
  function adapters(w){return{teslaJson:w.TCCV9Adapters?.teslaJson,nationalCompact:w.TCCV9Adapters?.nationalCompact,directOffers:w.TCCV9Adapters?.directOffers,legacyDirectTariffs:w.TCCV9Adapters?.legacyDirectTariffs,legacyDirectStations:w.TCCV9Adapters?.legacyDirectStations,franceEmspCompact:w.TCCV9Adapters?.franceEmspCompact,franceCrosswalk:w.TCCV9Adapters?.franceCrosswalk,franceIrveStatus:w.TCCV9Adapters?.franceIrveStatus,ukPcpr:w.TCCV9Adapters?.ukPcpr,moroccoPublic:w.TCCV9Adapters?.moroccoPublic,moroccoKilowattTariff:w.TCCV9Adapters?.moroccoKilowattTariff};}
  async function createEngine(w,cfg){
    if(!w.TCCV9RuntimeEngine||!w.TCCV9BrowserLoaders||!w.TCCV9BrowserRouting)throw new Error('V9 runtime dependency missing');
    const base=String(cfg.runtimeBase||'.').replace(/\/$/,''),[registry,vehicleProfiles]=await Promise.all([
      w.fetch(`${base}/data/v9/source-registry.json`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`registry ${r.status}`);return r.json();}),
      w.fetch(`${base}/data/v9/vehicle-profiles.json`,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`vehicle profiles ${r.status}`);return r.json();})
    ]);
    const loaders=w.TCCV9BrowserLoaders.createRegistryLoaders({registry,basePath:base,adapters:adapters(w)}),routeProvider=w.TCCV9BrowserRouting.osrmProvider();
    return w.TCCV9RuntimeEngine.createEngine({registry,loaders,routeProvider,vehicleProfiles});
  }
  function rowsFromArea(area){return(area.rankedStations||area.stations||[]).map(st=>{const evaluation=area.sessionEvaluations?.[st.id],score=area.stationScores?.[st.id],route=area.routes?.byStationId?.[st.id];const total=evaluation?.best?.total;return{station:st,evaluation,score,route,total:total==null?null:num(total),distanceKm:num(score?.distanceKm??route?.distanceKm)};});}
  function applyCongestionSelections(w,engine,run,input){
    const prefs=congestionPreferences(w),area=run.area;
    for(const st of area.stations||[]){
      if(!hasCongestionPricing(st))continue;
      const enabled=prefs[st.id]===true;
      const planned=area.sessionPlans?.[st.id]?.effectiveSession||area.effectiveSession||buildSession(input);
      const session={...planned,includeCongestionFees:enabled,assumeStationSaturated:enabled};
      area.sessionEvaluations[st.id]=engine.evaluateStation(st,session,{
        selectedSubscriptions:run.selectedSubscriptions,
        targetCurrency:area.effectiveSession?.targetCurrency||session.targetCurrency||'EUR',
        fxRates:area.effectiveSession?.fxRates||{}
      });
    }
    run.rows=rankRows(rowsFromArea(area),input.rankingMode,20);
    return run;
  }
  function maxPower(st){let max=0;for(const evse of st?.evses||[])for(const c of evse?.connectors||[])max=Math.max(max,num(c?.powerKw)||0);return max;}
  function connectorOfferRows(row){
    const values=[row?.evaluation?.best,...(row?.evaluation?.alternatives||[])].filter(x=>x?.comparable&&x.connectorId&&Number.isFinite(x.total));
    if(!values.length)return'';
    const seen=new Set(),rows=[];
    for(const o of values){
      const key=[o.connectorPowerKw,Number(o.total).toFixed(3),o.currency].join('|');
      if(seen.has(key))continue;seen.add(key);
      rows.push(`<div class="small">• ${esc(o.connectorPowerKw||'?')} kW · ${Number(o.total).toFixed(2)} ${esc(o.targetCurrency||o.currency||'GBP')} TTC · ${esc(o.provider||'Allego direct')}</div>`);
    }
    return `<div style="margin-top:7px"><b class="small">Coût par configuration de charge</b>${rows.join('')}</div>`;
  }

  function renderCandidate(w,area,rows,originLabel){
    const results=w.document.getElementById('results'),routeStatus=w.document.getElementById('routeStatus');if(!results)throw new Error('stable results container missing');
    if(routeStatus)routeStatus.innerHTML=`<span class="good">Moteur V9 canary · ${rows.length} borne(s) classée(s) depuis ${esc(originLabel)}.</span>`;
    if(!rows.length){results.innerHTML='<div class="warn">Aucune borne V9 exploitable pour cette recherche. Retour au moteur stable recommandé.</div>';return;}
    results.innerHTML=`<div class="small box"><b>Moteur V9 canary</b> · interface V7.3 stable · candidat moteur épinglé</div>`+rows.map((row,i)=>{const st=row.station,best=row.evaluation?.best,score=row.score,route=row.route;return `<div class="box" style="margin-top:10px"><b>${i+1}. ${esc(st.name||'Borne')}</b><div class="small">${esc(st.physicalOperator?.name||'Opérateur inconnu')} · ${maxPower(st)} kW · ${esc(st.status?.state||'unknown')}</div><div style="margin-top:6px">${best?`<b>${Number(best.total).toFixed(2)} ${esc(best.targetCurrency||'EUR')}</b> · ${esc(best.provider||'tarif')}`:'<span class="warn">Tarif non comparable</span>'}${Number.isFinite(row.distanceKm)?` · ${row.distanceKm.toFixed(1)} km`:''}</div>${connectorOfferRows(row)}${score?`<div class="small">Charge ${num(score.chargingMinutes)!=null?Number(score.chargingMinutes).toFixed(0)+' min':'—'} · trajet ${num(score.driveMinutes)!=null?Number(score.driveMinutes).toFixed(0)+' min':'—'} · total ${num(score.totalTimeMinutes)!=null?Number(score.totalTimeMinutes).toFixed(0)+' min':'—'}</div>`:''}${route?.provider?`<div class="small">Routage ${esc(route.provider)}</div>`:''}</div>`;}).join('');
  }
  async function executeV9(w,engine,cfg,input){
    if(!(input.targetSoc>input.startSoc))throw new Error('invalid SOC target');if(!input.originText)throw new Error('origin required');
    if(cfg.mode==='candidate'&&!(input.radiusKm>0))throw new Error('unbounded radius not production-equivalent');
    if(typeof w.resolveOrigin!=='function')throw new Error('stable origin resolver unavailable');const origin=await w.resolveOrigin(input.originText),countryCode=await countryCodeForOrigin(w,origin),scope=cfg.engineScopeCountries||[];
    if(scope.length&&!scope.includes(countryCode))throw new Error(`country outside V9 shell scope: ${countryCode}`);
    const queryRadius=input.radiusKm>0?input.radiusKm:20,filters=input.operatorMode==='tesla'?{operatorIds:['tesla']}:{},session=buildSession(input);if(countryCode==='GB')session.targetCurrency='GBP';
    const selected=selectedSubscriptions(w);
    const area=await engine.queryArea({countryCode,origin:{lat:Number(origin.lat),lon:Number(origin.lon)},radiusKm:queryRadius,filters,session,vehicleProfileId:'generic-ev-preview',selectedSubscriptions:selected,subscriptionFilters:{countryCodes:[countryCode],coverageMode:'any'},routingBudget:80,perOperatorFloor:2,sortBy:'finalCost'});
    const rows=rankRows(rowsFromArea(area),input.rankingMode,20);return{area,rows,origin,countryCode,queryRadius,partialRadius:!(input.radiusKm>0),selectedSubscriptions:selected};
  }
  async function install(w){
    const cfg=w.__TCC_V9_SHELL_CONFIG__;if(!cfg||!['shadow','candidate'].includes(cfg.mode))throw new Error('shell config unavailable');const legacyCompare=w.compare;if(typeof legacyCompare!=='function')throw new Error('stable compare unavailable');
    const enginePromise=createEngine(w,cfg);
    w.compare=async function(){const input=readInputs(w);if(cfg.mode==='shadow'){
      const stable=await legacyCompare.apply(this,arguments);enginePromise.then(engine=>executeV9(w,engine,cfg,input)).then(run=>diagnosticStore(w,{mode:'shadow',outcome:'v9-ok',countryCode:run.countryCode,stationCount:run.area?.stations?.length||0,rankedCount:run.rows.length,sourceErrors:run.area?.diagnostics?.errors?.length||0,routingErrors:run.area?.diagnostics?.routingErrorCount||0,partialRadius:run.partialRadius})).catch(err=>diagnosticStore(w,{mode:'shadow',outcome:'v9-fallback',reason:err.message}));return stable;
    }
      try{const engine=await enginePromise,run=await executeV9(w,engine,cfg,input);renderSubscriptionSelector(w,run.area?.subscriptions||[],run.countryCode);renderCandidate(w,run.area,run.rows,run.origin.label||input.originText);diagnosticStore(w,{mode:'candidate',outcome:'v9-ok',countryCode:run.countryCode,stationCount:run.area?.stations?.length||0,rankedCount:run.rows.length,selectedSubscriptionCount:run.selectedSubscriptions.length,sourceErrors:run.area?.diagnostics?.errors?.length||0,routingErrors:run.area?.diagnostics?.routingErrorCount||0});return run.area;}catch(err){diagnosticStore(w,{mode:'candidate',outcome:'legacy-fallback',reason:err.message});return legacyCompare.apply(this,arguments);}
    };
    w.__TCC_V9_SHELL__={mode:cfg.mode,candidateSha:cfg.observedCandidateSha,engineScopeCountries:(cfg.engineScopeCountries||[]).slice(),fallback:cfg.fallback||'legacy-compare'};
    return w.__TCC_V9_SHELL__;
  }
  return{rankingWeights,rankRows,combineDateTime,dcCurve,readInputs,buildSession,rowsFromArea,selectedSubscriptions,saveSelectedSubscriptions,subscriptionLabel,renderSubscriptionSelector,executeV9,install};
});
