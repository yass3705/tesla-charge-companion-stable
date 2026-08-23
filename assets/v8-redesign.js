// Tesla Charge Companion V8 RC3 — refonte mobile/desktop + profil véhicule.
(function(){
  'use strict';
  const BUILD='8004';
  const STORAGE_KEY='tccVehicleProfileV1';
  const CATALOG=window.TCC_VEHICLE_CATALOG||{models:[]};
  if(!document.querySelector('link[data-v8-redesign]')){const link=document.createElement('link');link.rel='stylesheet';link.href='assets/v8-redesign.css?v=rc48be-20260823';link.dataset.v8Redesign='1';document.head.appendChild(link);}
  const DEFAULT_STATE={model:'Y',trim:'lr-rwd',year:2026,capacityMode:'simple',usableCapacity:75,newCapacity:75,degradation:0,consumptionOverride:null};
  const $=id=>document.getElementById(id);
  const num=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
  const esc=v=>window.escapeHtml?window.escapeHtml(v):String(v??'');
  let applying=false;

  function readState(){
    try{return {...DEFAULT_STATE,...JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}}catch(e){return {...DEFAULT_STATE}}
  }
  function writeState(state){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  function modelById(id){return CATALOG.models.find(m=>m.id===id)||CATALOG.models[0];}
  function trimById(model,id){return model?.trims?.find(t=>t.id===id)||model?.trims?.[0];}
  function currentSpec(state=readState()){
    const model=modelById(state.model),trim=trimById(model,state.trim);
    const year=trim?.years?.includes(Number(state.year))?Number(state.year):(trim?.years?.slice(-1)[0]||2026);
    return{model,trim,year};
  }
  function currentUsableCapacity(state=readState()){
    if(state.capacityMode==='advanced')return Math.max(1,num(state.newCapacity,75)*(1-Math.max(0,Math.min(40,num(state.degradation,0)))/100));
    return Math.max(1,num(state.usableCapacity,75));
  }
  function setInput(id,value){const el=$(id);if(el&&value!=null)el.value=String(value);}
  function applyProfileToEngine(state=readState(),resetConsumption=false){
    const {trim}=currentSpec(state);if(!trim)return;
    const usable=currentUsableCapacity(state);
    setInput('simBatteryCapacity',usable.toFixed(2));
    const ov=!resetConsumption&&state.consumptionOverride;
    setInput('simConsumption',ov?.reference??trim.referenceConsumption);
    setInput('simCityConsumption',ov?.city??trim.cityConsumption);
    setInput('simFastConsumption',ov?.fast??trim.fastConsumption);
    setInput('simMotorwayConsumption',ov?.motorway??trim.motorwayConsumption);
    updateVehicleSummary(state);
  }
  function profileLabel(state=readState()){
    const {model,trim,year}=currentSpec(state);return `${model?.label||''} · ${trim?.label||''} · ${year}`;
  }
  function updateVehicleSummary(state=readState()){
    const el=$('v8VehicleSummary');if(!el)return;
    const {trim}=currentSpec(state);const cap=currentUsableCapacity(state);
    el.innerHTML=`<div><span class="v8-eyebrow">Véhicule</span><b>${esc(profileLabel(state))}</b><span>${cap.toFixed(1)} kWh utiles · AC ${num(trim?.acMaxKw,11)} kW · DC ${num(trim?.dcMaxKw,175)} kW max</span></div><button type="button" class="secondary" id="v8EditVehicle">Modifier</button>`;
    $('v8EditVehicle')?.addEventListener('click',()=>{document.querySelector('nav button[data-tab="fx"]')?.click();setTimeout(()=>$('v8VehicleCard')?.scrollIntoView({behavior:'smooth',block:'start'}),80);});
  }

  function installPowerLimits(){
    if(typeof window.acPowerAtSoc==='function'&&!window.acPowerAtSoc.__tccVehicleWrapped){
      const original=window.acPowerAtSoc;
      const wrapped=function(soc,stationMax){const {trim}=currentSpec();return original(soc,Math.min(num(stationMax,0),num(trim?.acMaxKw,11)));};
      wrapped.__tccVehicleWrapped=true;window.acPowerAtSoc=wrapped;try{acPowerAtSoc=wrapped}catch(e){}
    }
    if(typeof window.dcCurvePower==='function'&&!window.dcCurvePower.__tccVehicleWrapped){
      const wrapped=function(soc,condition,profile,stationMax){
        const {trim}=currentSpec();const max=Math.min(num(stationMax,0),num(trim?.dcMaxKw,175));
        const curves={
          dc175:[[0,150],[10,175],[20,170],[30,160],[40,145],[50,125],[60,105],[70,85],[80,60],[85,42],[90,28],[95,16],[98,10],[100,6]],
          dc200:[[0,165],[10,200],[20,195],[30,185],[40,165],[50,145],[60,120],[70,95],[80,68],[85,48],[90,32],[95,18],[98,10],[100,6]],
          dc250:[[0,180],[10,245],[20,250],[30,235],[40,205],[50,175],[60,145],[70,110],[80,75],[85,55],[90,38],[95,22],[98,12],[100,6]]
        };
        const pts=curves[trim?.curve]||curves.dc175;let p=pts[pts.length-1][1];
        for(let i=1;i<pts.length;i++){if(soc<=pts[i][0]){const [x1,y1]=pts[i-1],[x2,y2]=pts[i];p=y1+(y2-y1)*(soc-x1)/(x2-x1);break;}}
        const cf=condition==='warm'?1:(condition==='cold'?.68:.86),pf=profile==='optimistic'?1.08:(profile==='conservative'?.88:1);
        return Math.max(3,Math.min(max,p*cf*pf));
      };
      wrapped.__tccVehicleWrapped=true;window.dcCurvePower=wrapped;try{dcCurvePower=wrapped}catch(e){}
    }
  }

  function wrapperFor(id){const el=$(id);return el?.closest('.full')||el?.parentElement;}
  function moveControl(id,target,className='v8-field'){
    const wrap=wrapperFor(id);if(!wrap||!target)return;wrap.className=className;target.appendChild(wrap);
  }
  function installCompareLayout(){
    const compare=$('compare'),card=compare?.querySelector('.card');
    if(!card||$('v8VehicleSummary'))return false;
    const grid=card.querySelector('.grid');if(!grid||!$('augVehicleBox')||!$('augCompareFilters'))return false;
    document.body.classList.add('v8-redesign');card.id='v8CompareCard';

    const summary=document.createElement('div');summary.id='v8VehicleSummary';summary.className='v8-vehicle-summary';card.insertBefore(summary,grid);
    const core=document.createElement('div');core.className='v8-core-grid';card.insertBefore(core,grid);
    ['simOrigin','simNow','simTarget','simUnplugTime'].forEach(id=>moveControl(id,core,id==='simOrigin'?'v8-field v8-span-2':'v8-field'));
    const dateTime=document.createElement('div');dateTime.className='v8-date-time-grid';core.appendChild(dateTime);
    moveControl('simDate',dateTime);moveControl('simTime',dateTime);

    const filterDetails=document.createElement('details');filterDetails.className='v8-details v8-filter-details';filterDetails.open=false;
    filterDetails.innerHTML='<summary>Filtres & classement <span>type, rayon, opérateurs</span></summary><div class="v8-details-body" id="v8FilterBody"></div>';
    card.insertBefore(filterDetails,grid);const filterBody=$('v8FilterBody');
    moveControl('simMaxDistance',filterBody);moveControl('simRanking',filterBody);moveControl('simCondition',filterBody);moveControl('simProfile',filterBody);
    const augFilters=$('augCompareFilters');if(augFilters){augFilters.classList.add('v8-aug-filters');filterBody.appendChild(augFilters);}

    const calcDetails=document.createElement('details');calcDetails.className='v8-details';calcDetails.innerHTML='<summary>Réglages de calcul <span>consommations & préconditionnement</span></summary><div class="v8-details-body" id="v8CalcBody"></div>';
    card.insertBefore(calcDetails,grid);$('v8CalcBody').appendChild($('augVehicleBox'));
    const capWrap=wrapperFor('simBatteryCapacity');if(capWrap)capWrap.classList.add('v8-hidden-capacity');

    grid.remove();
    const buttons=[...card.querySelectorAll(':scope > button')];
    const actions=document.createElement('div');actions.className='v8-actions';
    buttons.forEach(btn=>actions.appendChild(btn));card.insertBefore(actions,$('routeStatus'));
    const primary=actions.querySelector('.primary');if(primary){primary.classList.add('v8-simulate');primary.textContent='Simuler';}
    const route=$('routeButton');if(route)route.textContent='Recalculer les trajets';
    updateVehicleSummary();return true;
  }

  function installVehicleSettings(){
    const panel=$('fx');if(!panel||$('v8VehicleCard'))return;
    const card=document.createElement('div');card.className='card v8-vehicle-card';card.id='v8VehicleCard';
    card.innerHTML=`<div class="v8-card-title"><div><span class="v8-eyebrow">Profil véhicule</span><h3>Ma Tesla</h3></div><span class="badge">2020 → aujourd’hui</span></div>
      <div class="v8-settings-grid">
        <div><label>Modèle</label><select id="v8VehicleModel"></select></div>
        <div><label>Finition</label><select id="v8VehicleTrim"></select></div>
        <div><label>Année</label><select id="v8VehicleYear"></select></div>
      </div>
      <div id="v8VehicleSpec" class="small box v8-spec"></div>
      <div class="v8-capacity-box">
        <div class="v8-segmented"><button type="button" data-capmode="simple">Capacité utile actuelle</button><button type="button" data-capmode="advanced">Capacité neuve + dégradation</button></div>
        <div id="v8CapacitySimple"><label>Capacité utile actuelle (kWh)</label><input id="v8UsableCapacity" type="number" min="20" max="150" step="0.1" inputmode="decimal"><div class="small">À renseigner selon ton véhicule / ton estimation. Elle n’est pas déduite automatiquement du modèle.</div></div>
        <div id="v8CapacityAdvanced" class="hidden"><div class="v8-settings-grid"><div><label>Capacité utile à neuf (kWh)</label><input id="v8NewCapacity" type="number" min="20" max="150" step="0.1" inputmode="decimal"></div><div><label>Dégradation (%)</label><input id="v8Degradation" type="number" min="0" max="40" step="0.1" inputmode="decimal"></div></div><div id="v8CapacityCalculated" class="small box"></div></div>
      </div>
      <div class="small">Le profil adapte les consommations de référence et les limites AC/DC. Les valeurs restent modifiables dans <b>Réglages de calcul</b> de l’onglet Comparer.</div>`;
    const about=panel.querySelector('.card');about?.insertAdjacentElement('afterend',card);
    fillVehicleControls();bindVehicleControls();
  }

  function fillVehicleControls(){
    const state=readState(),modelSel=$('v8VehicleModel'),trimSel=$('v8VehicleTrim'),yearSel=$('v8VehicleYear');if(!modelSel)return;
    modelSel.innerHTML=CATALOG.models.map(m=>`<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');modelSel.value=state.model;
    const model=modelById(modelSel.value);trimSel.innerHTML=(model?.trims||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
    if((model?.trims||[]).some(t=>t.id===state.trim))trimSel.value=state.trim;
    const trim=trimById(model,trimSel.value);yearSel.innerHTML=(trim?.years||[]).slice().sort((a,b)=>b-a).map(y=>`<option value="${y}">${y}</option>`).join('');
    yearSel.value=String(trim?.years?.includes(Number(state.year))?state.year:(trim?.years?.slice(-1)[0]||2026));
    $('v8UsableCapacity').value=state.usableCapacity;$('v8NewCapacity').value=state.newCapacity;$('v8Degradation').value=state.degradation;renderVehicleSettings();
  }
  function saveFromControls({profileChanged=false}={}){
    if(applying)return;let state=readState();
    state.model=$('v8VehicleModel')?.value||state.model;state.trim=$('v8VehicleTrim')?.value||state.trim;state.year=num($('v8VehicleYear')?.value,state.year);
    state.usableCapacity=num($('v8UsableCapacity')?.value,state.usableCapacity);state.newCapacity=num($('v8NewCapacity')?.value,state.newCapacity);state.degradation=num($('v8Degradation')?.value,state.degradation);
    if(profileChanged)state.consumptionOverride=null;writeState(state);applyProfileToEngine(state,profileChanged);renderVehicleSettings();
  }
  function renderVehicleSettings(){
    const state=readState(),{trim}=currentSpec(state),advanced=state.capacityMode==='advanced';
    document.querySelectorAll('[data-capmode]').forEach(b=>b.classList.toggle('active',b.dataset.capmode===state.capacityMode));
    $('v8CapacitySimple')?.classList.toggle('hidden',advanced);$('v8CapacityAdvanced')?.classList.toggle('hidden',!advanced);
    const cap=currentUsableCapacity(state);if($('v8CapacityCalculated'))$('v8CapacityCalculated').innerHTML=`Capacité utile estimée aujourd’hui : <b>${cap.toFixed(1)} kWh</b>`;
    if($('v8VehicleSpec'))$('v8VehicleSpec').innerHTML=`Référence Companion : <b>${num(trim?.referenceConsumption).toFixed(1)} kWh/100 km</b> · AC <b>${num(trim?.acMaxKw,11)} kW</b> · DC <b>${num(trim?.dcMaxKw,175)} kW max</b>. Capacité batterie : <b>saisie utilisateur</b>.`;
  }
  function bindVehicleControls(){
    $('v8VehicleModel')?.addEventListener('change',()=>{const state=readState(),m=modelById($('v8VehicleModel').value),t=m?.trims?.[0];state.model=m.id;state.trim=t.id;state.year=t.years.slice(-1)[0];state.consumptionOverride=null;writeState(state);fillVehicleControls();applyProfileToEngine(state,true);});
    $('v8VehicleTrim')?.addEventListener('change',()=>{const state=readState(),m=modelById($('v8VehicleModel').value),t=trimById(m,$('v8VehicleTrim').value);state.model=m.id;state.trim=t.id;state.year=t.years.slice(-1)[0];state.consumptionOverride=null;writeState(state);fillVehicleControls();applyProfileToEngine(state,true);});
    $('v8VehicleYear')?.addEventListener('change',()=>saveFromControls({profileChanged:true}));
    ['v8UsableCapacity','v8NewCapacity','v8Degradation'].forEach(id=>$(id)?.addEventListener('change',()=>saveFromControls()));
    document.querySelectorAll('[data-capmode]').forEach(btn=>btn.addEventListener('click',()=>{const s=readState();s.capacityMode=btn.dataset.capmode;writeState(s);renderVehicleSettings();applyProfileToEngine(s);}));
  }
  function bindConsumptionOverride(){
    ['simConsumption','simCityConsumption','simFastConsumption','simMotorwayConsumption'].forEach(id=>$(id)?.addEventListener('change',()=>{if(applying)return;const s=readState();s.consumptionOverride={reference:num($('simConsumption')?.value),city:num($('simCityConsumption')?.value),fast:num($('simFastConsumption')?.value),motorway:num($('simMotorwayConsumption')?.value)};writeState(s);},{passive:true}));
  }
  function enhanceEditButtons(){
    const section=$('edit'),card=section?.querySelector('.card');if(!card||$('v8CancelEdit'))return;
    const save=[...card.querySelectorAll('button')].find(b=>/Enregistrer la borne/i.test(b.textContent));if(!save)return;
    const cancel=document.createElement('button');cancel.type='button';cancel.id='v8CancelEdit';cancel.className='secondary';cancel.textContent='Annuler';cancel.onclick=()=>{if(typeof resetForm==='function')resetForm();document.querySelector('nav button[data-tab="stations"]')?.click();};
    save.insertAdjacentElement('afterend',cancel);
  }
  function bindDynamicAreaRefresh(){
    let timer;const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>window.TCCV8DynamicOperators?.preload?.().catch(()=>{}),500);};
    $('simOrigin')?.addEventListener('change',refresh);$('simMaxDistance')?.addEventListener('change',refresh);
  }
  function updateChrome(){
    document.title='Tesla Charge Companion V8 RC3';document.querySelector('meta[name="tcc-build"]')?.setAttribute('content',BUILD);
    const p=document.querySelector('header>p');if(p)p.textContent='V8 RC3 · profils véhicule & multi-tarifs';
    const about=$('fx')?.querySelector('.card .small');if(about)about.innerHTML=about.innerHTML.replace(/V8 RC\d+/,'V8 RC3');
  }
  function install(){
    if(!installCompareLayout())return false;installVehicleSettings();installPowerLimits();bindConsumptionOverride();enhanceEditButtons();bindDynamicAreaRefresh();applyProfileToEngine();updateChrome();return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>180)clearInterval(timer);},100);
  window.TCCV8Vehicle={getState:readState,getSpec:currentSpec,getUsableCapacity:currentUsableCapacity,apply:applyProfileToEngine};
})();
