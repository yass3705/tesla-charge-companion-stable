// Tesla Charge Companion V8 — workflow zone -> simulation Top 20.
// La mise à jour des bornes est placée directement à côté de l'adresse ;
// la simulation reste à son emplacement principal et réutilise la zone préparée.
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
    // La date est incluse : le catalogue compact filtre certains tarifs selon le jour de semaine.
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

  async function refreshArea(){
    if(busy||typeof originalCandidateStations!=='function')return;
    const update=$('routeButton');
    const radius=radiusValue();
    busy=true;setReady(false);
    if(update){update.disabled=true;update.classList.add('loading');setUpdateLabel(update,true);}
    status('Chargement des bornes du périmètre et calcul des distances routières…');
    try{
      // Appel direct à la vraie fonction : elle résout l’adresse, charge le catalogue France,
      // calcule les distances OSRM et applique strictement le rayon routier.
      const prepared=await originalCandidateStations('all',radius);
      areaCache={key:areaKey(radius),prepared,at:Date.now()};
      if(window.TCCV8DynamicOperators?.refresh&&prepared?.stations){
        window.TCCV8DynamicOperators.refresh(prepared.stations);
      }
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
      if(update){update.disabled=false;update.classList.remove('loading');setUpdateLabel(update,false);}
    }
  }

  function installCandidateCache(){
    if(originalCandidateStations||typeof candidateStations!=='function')return !!originalCandidateStations;
    originalCandidateStations=candidateStations;
    const wrapped=async function(filterMode='tesla',maxDistanceKm=0){
      const radius=Number(maxDistanceKm)||0;
      if(filterMode==='all'&&areaCache&&areaCache.key===areaKey(radius)){
        // candidateStations a déjà rempli routeResults lors de la mise à jour de zone.
        // On conserve donc exactement les mêmes distances pour la simulation finale.
        return areaCache.prepared;
      }
      return originalCandidateStations(filterMode,maxDistanceKm);
    };
    wrapped.__tccAreaCacheWrapped=true;
    wrapped.__tccAreaOriginal=originalCandidateStations;
    candidateStations=wrapped;
    try{window.candidateStations=wrapped}catch(e){}
    return true;
  }

  function wireButtons(){
    const card=$('v8CompareCard')||$('compare')?.querySelector('.card');
    const update=$('routeButton');
    const origin=$('simOrigin');
    const sim=card?.querySelector('.v8-simulate')||card?.querySelector('button.primary');
    if(!card||!update||!origin||!sim||update.__tccAreaWorkflow)return false;

    // Le bouton de mise à jour appartient visuellement au champ d'adresse.
    const originWrap=origin.closest('.v8-field')||origin.parentElement;
    let line=$('v8OriginRefreshRow');
    if(!line){
      line=document.createElement('div');
      line.id='v8OriginRefreshRow';
      line.className='v8-origin-refresh';
      origin.parentNode.insertBefore(line,origin);
      line.appendChild(origin);
    }
    update.style.cssText='';
    update.classList.add('v8-area-refresh-btn');
    line.appendChild(update);

    // Le bouton de simulation reste dans la zone d'actions principale.
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
      .v8-origin-refresh{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:stretch}
      .v8-origin-refresh #simOrigin{min-width:0;width:100%}
      .v8-area-refresh-btn{width:auto!important;margin:0!important;min-height:42px;padding:0 14px!important;white-space:nowrap;border-color:#555560!important;font-size:11px!important;font-weight:850!important}
      .v8-update-short{display:none}
      .v8-area-actions{grid-template-columns:2fr 1fr!important;align-items:stretch}
      .v8-area-actions .v8-simulate{grid-column:1!important;grid-row:1!important;min-height:46px}
      .v8-area-actions .v8-save-origin{grid-column:2!important;grid-row:1!important}
      .v8-area-actions .v8-area-not-ready{opacity:.46;cursor:not-allowed}
      #routeStatus.good{color:#55d984}#routeStatus.warn{color:#e9bd54}#routeStatus.bad{color:#ff7474}
      @media(max-width:680px){
        .v8-origin-refresh{grid-template-columns:minmax(0,1fr) auto;gap:6px}
        .v8-area-refresh-btn{padding:0 10px!important;min-width:104px}
        .v8-update-long{display:none}.v8-update-short{display:inline}
        .v8-area-actions{grid-template-columns:1fr!important}
        .v8-area-actions .v8-simulate{grid-column:1!important;grid-row:1!important}
        .v8-area-actions .v8-save-origin{grid-column:1!important;grid-row:2!important}
      }
    `;document.head.appendChild(s);
  }

  function install(){injectStyle();const cache=installCandidateCache();const ui=wireButtons();return cache&&ui;}
  let attempts=0;const timer=setInterval(()=>{attempts++;if(install()||attempts>180)clearInterval(timer);},100);
  window.TCCV8AreaWorkflow={refresh:refreshArea,invalidate,get cache(){return areaCache;}};
})();
