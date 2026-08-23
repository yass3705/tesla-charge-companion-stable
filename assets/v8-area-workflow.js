// Tesla Charge Companion V8 — workflow zone -> simulation Top 20.
// Adresse, rayon et mise à jour des bornes sont regroupés ; les filtres bornes
// restent séparés des paramètres batterie / calcul.
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const text=v=>String(v==null?'':v).trim();
  let originalCandidateStations=null;
  let areaCache=null;
  let busy=false;

  function radiusValue(){
    const raw=text($('simMaxDistance')?.value);
    return raw===''?0:Math.max(0,Number(raw)||0);
  }
  function originValue(){return text($('simOrigin')?.value)||text(localStorage.getItem('tccDefaultOrigin'))||'Ma position';}
  function areaKey(radius=radiusValue()){
    return JSON.stringify([originValue().toLowerCase(),Number(radius)||0,text($('simDate')?.value)]);
  }
  function status(message,kind=''){
    const el=$('routeStatus');if(!el)return;
    el.className=`small ${kind}`.trim();el.textContent=message;
  }
  function physicalCount(stations){
    const keys=new Set();
    for(const st of stations||[]){
      const id=text(st?.catalogStationId)||text(st?.baseStationId)||text(st?.id).split('::')[0];
      if(id)keys.add(id);
    }
    return keys.size;
  }
  function setReady(on){
    const sim=document.querySelector('#v8CompareCard .v8-simulate')||document.querySelector('#compare button.primary');
    if(sim){sim.disabled=!on;sim.classList.toggle('v8-area-not-ready',!on);}
  }
  function setUpdateLabel(button,loading=false){
    if(!button)return;
    if(loading){button.textContent='Mise à jour…';return;}
    button.innerHTML='<span class="v8-update-long">Mettre à jour les bornes</span><span class="v8-update-short">Mettre à jour</span>';
  }
  function invalidate(reason='Zone à mettre à jour.'){
    areaCache=null;setReady(false);status(`${reason} Utilise « Mettre à jour les bornes » à côté de l’adresse avant de simuler.`,'warn');
  }

  function collapseFiltersForRefresh(){
    const details=$('v8FilterBody')?.closest('details');
    if(!details)return()=>{};
    const wasOpen=!!details.open;
    if(wasOpen){
      details.open=false;
      details.classList.add('v8-refresh-collapsed');
      details.setAttribute('aria-busy','true');
    }
    return()=>{
      details.removeAttribute('aria-busy');
      details.classList.remove('v8-refresh-collapsed');
      if(wasOpen){
        requestAnimationFrame(()=>{details.open=true;});
      }
    };
  }
  function letBrowserPaint(){
    return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  }
  function refreshOperatorsFromPrepared(prepared){
    if(!prepared?.stations?.length||!window.TCCV8DynamicOperators?.refresh)return;
    const apply=()=>{
      try{window.TCCV8DynamicOperators.refresh(prepared.stations);}
      catch(err){console.warn('[TCC V8] Mise à jour opérateurs :',err?.message||err);}
    };
    // L'initialisation August historique peut réécrire la liste des opérateurs juste
    // après le premier chargement. On réapplique donc la zone préparée sans refaire
    // les trajets. Cela supprime le besoin d'appuyer une deuxième fois sur « Mettre à jour ».
    apply();
    requestAnimationFrame(apply);
    setTimeout(apply,180);
    setTimeout(apply,550);
    setTimeout(apply,1000);
  }

  async function refreshArea(){
    if(busy||typeof originalCandidateStations!=='function')return;
    const update=$('routeButton');
    const radius=radiusValue();
    const restoreFilters=collapseFiltersForRefresh();
    busy=true;setReady(false);
    document.body.classList.add('v8-area-refreshing');
    if(update){update.disabled=true;update.classList.add('loading');setUpdateLabel(update,true);}
    status('Chargement des bornes du périmètre et calcul des distances routières…');
    try{
      // Laisse Safari appliquer le repli du panneau avant le travail lourd.
      await letBrowserPaint();
      const prepared=await originalCandidateStations('all',radius);
      areaCache={key:areaKey(radius),prepared,at:Date.now()};
      refreshOperatorsFromPrepared(prepared);
      const count=physicalCount(prepared?.stations);
      const radiusText=radius>0?` dans un rayon routier maximal de ${radius} km`:' sans limite de rayon';
      status(`✓ ${count} borne(s) mise(s) à jour${radiusText}. Tu peux lancer la simulation.`,'good');
      setReady(true);
      window.TCC_V8_AREA_CACHE=areaCache;
    }catch(err){
      areaCache=null;setReady(false);
      status(`Mise à jour impossible : ${err?.message||err}`,'bad');
    }finally{
      busy=false;
      document.body.classList.remove('v8-area-refreshing');
      if(update){update.disabled=false;update.classList.remove('loading');setUpdateLabel(update,false);}
      restoreFilters();
    }
  }

  function installCandidateCache(){
    if(originalCandidateStations||typeof candidateStations!=='function')return !!originalCandidateStations;
    originalCandidateStations=candidateStations;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){
      const radius=Number(maxDistanceKm)||0;
      if(filterMode==='all'&&areaCache&&areaCache.key===areaKey(radius))return areaCache.prepared;
      return originalCandidateStations(filterMode,maxDistanceKm);
    };
    wrapped.__tccAreaCacheWrapped=true;
    wrapped.__tccAreaOriginal=originalCandidateStations;
    candidateStations=wrapped;
    try{window.candidateStations=wrapped}catch(e){}
    return true;
  }

  function moveSearchControls(){
    const origin=$('simOrigin'),radius=$('simMaxDistance'),update=$('routeButton');
    if(!origin||!radius||!update)return false;
    const originWrap=origin.closest('.v8-field')||origin.parentElement;
    const radiusWrap=radius.closest('.v8-field')||radius.parentElement;
    if(!originWrap||!radiusWrap)return false;

    let line=$('v8OriginRefreshRow');
    if(!line){
      line=document.createElement('div');
      line.id='v8OriginRefreshRow';
      line.className='v8-location-row';

      const addressBox=document.createElement('div');
      addressBox.className='v8-location-address';
      const originLabel=[...originWrap.children].find(x=>x.tagName==='LABEL');
      if(originLabel)addressBox.appendChild(originLabel);
      addressBox.appendChild(origin);
      line.appendChild(addressBox);

      radiusWrap.classList.add('v8-location-radius');
      const radiusLabel=radiusWrap.querySelector('label');
      if(radiusLabel)radiusLabel.textContent='Rayon (km)';
      const radiusHelp=radiusWrap.querySelector('.small');
      if(radiusHelp)radiusHelp.classList.add('v8-location-help-hidden');
      line.appendChild(radiusWrap);

      update.style.cssText='';
      update.classList.add('v8-area-refresh-btn');
      line.appendChild(update);

      originWrap.appendChild(line);
      originWrap.classList.add('v8-location-shell');
    }else if(update.parentElement!==line){
      line.appendChild(update);
    }
    setUpdateLabel(update,false);
    return true;
  }

  function separateFiltersAndBattery(){
    const filterBody=$('v8FilterBody'),calcBody=$('v8CalcBody');
    if(!filterBody||!calcBody)return false;

    const filterDetails=filterBody.closest('details');
    const calcDetails=calcBody.closest('details');
    const filterSummary=filterDetails?.querySelector(':scope > summary');
    const calcSummary=calcDetails?.querySelector(':scope > summary');
    if(filterSummary)filterSummary.innerHTML='Filtres bornes <span>type, opérateurs, classement</span>';
    if(calcSummary)calcSummary.innerHTML='Batterie & calcul <span>température, consommation, préconditionnement</span>';

    for(const id of ['simCondition','simProfile']){
      const el=$(id),wrap=el?.closest('.v8-field')||el?.parentElement;
      if(wrap&&wrap.parentElement!==calcBody){wrap.className='v8-field';calcBody.insertBefore(wrap,calcBody.firstChild);}
    }

    const augFilters=$('augCompareFilters');
    const title=augFilters?.querySelector('.aug-section-title b');
    if(title)title.textContent='Opérateurs et type de recharge';
    return true;
  }

  function wireButtons(){
    const card=$('v8CompareCard')||$('compare')?.querySelector('.card');
    const update=$('routeButton');
    const origin=$('simOrigin');
    const sim=card?.querySelector('.v8-simulate')||card?.querySelector('button.primary');
    if(!card||!update||!origin||!sim)return false;

    moveSearchControls();
    separateFiltersAndBattery();

    if(update.__tccAreaWorkflow){
      // August peut réécrire le libellé et les handlers après notre première passe.
      // On restaure alors l'état final sans ajouter une seconde fois les listeners.
      moveSearchControls();separateFiltersAndBattery();
      update.removeAttribute('onclick');update.onclick=refreshArea;setUpdateLabel(update,false);
      sim.removeAttribute('onclick');sim.textContent='Simuler les 20 meilleures';
      sim.onclick=async()=>{
        if(!areaCache||areaCache.key!==areaKey()){invalidate('La zone n’est pas prête.');return;}
        if(typeof window.compare==='function')await window.compare();
        else if(typeof compare==='function')await compare();
      };
      return true;
    }
    const actions=sim.closest('.v8-actions')||sim.parentElement;
    if(actions){
      actions.classList.add('v8-area-actions');
      const save=[...actions.querySelectorAll('button')].find(b=>/Enregistrer cette adresse/i.test(text(b.textContent))||String(b.getAttribute('onclick')||'').includes('saveDefaultOrigin'));
      if(save)save.classList.add('v8-save-origin');
    }

    update.removeAttribute('onclick');update.onclick=refreshArea;setUpdateLabel(update,false);
    sim.removeAttribute('onclick');
    sim.textContent='Simuler les 20 meilleures';
    sim.onclick=async()=>{
      if(!areaCache||areaCache.key!==areaKey()){
        invalidate('La zone n’est pas prête.');return;
      }
      if(typeof window.compare==='function')await window.compare();
      else if(typeof compare==='function')await compare();
    };
    update.__tccAreaWorkflow=true;
    setReady(false);
    status('Renseigne l’adresse et le rayon, puis mets à jour les bornes avant de lancer la simulation.');

    const invalidateAddress=()=>invalidate('Adresse ou périmètre modifié.');
    origin.addEventListener('input',invalidateAddress);
    $('simMaxDistance')?.addEventListener('change',invalidateAddress);
    $('simDate')?.addEventListener('change',()=>invalidate('Date modifiée.'));
    return true;
  }

  function injectStyle(){
    if($('tccV8AreaStyle'))return;
    const s=document.createElement('style');s.id='tccV8AreaStyle';
    s.textContent=`
      .v8-location-shell{grid-column:1/-1!important}
      .v8-location-row{display:grid;grid-template-columns:minmax(0,1fr) 105px auto;gap:8px;align-items:end}
      .v8-location-address,.v8-location-radius{min-width:0}
      .v8-location-address label,.v8-location-radius label{display:block;font-size:10px;color:#aaaab2;margin-bottom:5px}
      .v8-location-address #simOrigin,.v8-location-radius #simMaxDistance{width:100%;min-width:0;min-height:42px}
      .v8-location-radius{margin:0!important}
      .v8-location-help-hidden{display:none!important}
      .v8-area-refresh-btn{width:auto!important;margin:0!important;min-height:42px;padding:0 13px!important;white-space:nowrap;border-color:#555560!important;font-size:11px!important;font-weight:850!important}
      .v8-update-short{display:none}
      .v8-area-actions{grid-template-columns:2fr 1fr!important;align-items:stretch}
      .v8-area-actions .v8-simulate{grid-column:1!important;grid-row:1!important;min-height:46px}
      .v8-area-actions .v8-save-origin{grid-column:2!important;grid-row:1!important}
      .v8-area-actions .v8-area-not-ready{opacity:.46;cursor:not-allowed}
      #routeStatus.good{color:#55d984}#routeStatus.warn{color:#e9bd54}#routeStatus.bad{color:#ff7474}
      #v8FilterBody #augCompareFilters{grid-column:1/-1}
      #v8CalcBody #augVehicleBox{grid-column:1/-1}
      details.v8-refresh-collapsed>summary{opacity:.72}
      body.v8-area-refreshing .operator-choices{pointer-events:none}
      @media(max-width:680px){
        .v8-location-row{grid-template-columns:minmax(0,1fr) 76px 96px;gap:6px}
        .v8-area-refresh-btn{padding:0 8px!important;min-width:0}
        .v8-update-long{display:none}.v8-update-short{display:inline}
        .v8-area-actions{grid-template-columns:1fr!important}
        .v8-area-actions .v8-simulate{grid-column:1!important;grid-row:1!important}
        .v8-area-actions .v8-save-origin{grid-column:1!important;grid-row:2!important}
      }
      @media(max-width:520px){
        .v8-location-row{grid-template-columns:minmax(0,1fr) 96px;gap:6px}
        .v8-location-address{grid-column:1/-1}
        .v8-location-radius{grid-column:1}
        .v8-area-refresh-btn{grid-column:2}
      }
      @media(max-width:360px){
        .v8-location-row{grid-template-columns:minmax(0,1fr) 82px;gap:5px}
        .v8-location-address{grid-column:1/-1}
        .v8-location-radius{grid-column:1}
        .v8-area-refresh-btn{grid-column:2;font-size:10px!important;padding:0 5px!important}
      }
    `;document.head.appendChild(s);
  }

  function install(){
    injectStyle();
    const cache=installCandidateCache();
    const ui=wireButtons();
    separateFiltersAndBattery();
    return cache&&ui;
  }
  let attempts=0,stablePasses=0;
  const timer=setInterval(()=>{
    attempts++;
    const ok=install(),update=$('routeButton');
    const stable=ok&&/Mettre à jour/i.test(text(update?.textContent))&&update?.__tccAreaWorkflow;
    stablePasses=stable?stablePasses+1:0;
    // Plusieurs couches August terminent leur initialisation après DOMContentLoaded.
    // Trente passes stables empêchent une réécriture tardive de survivre.
    if(stablePasses>=30||attempts>180)clearInterval(timer);
  },100);
  window.TCCV8AreaWorkflow={refresh:refreshArea,invalidate,repair:install,get cache(){return areaCache;}};
})();
