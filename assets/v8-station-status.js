// Tesla Charge Companion V8 — filtre des statuts opérationnels France.
(function(){
  const AVAILABLE='available',OUT='out_of_service',UNKNOWN='unknown';
  const stationById=new Map();

  function normalized(st){
    return st?.operationalStatus===OUT?OUT:st?.operationalStatus===AVAILABLE?AVAILABLE:UNKNOWN;
  }
  function selected(){return document.getElementById('simStatusFilter')?.value||AVAILABLE}
  function matches(st,mode=selected()){
    const status=normalized(st);
    if(mode==='all')return true;
    if(mode===OUT)return status===OUT;
    // L'absence de statut n'exclut jamais Tesla, une borne manuelle ou une source non couverte.
    return status!==OUT;
  }
  function remember(list){
    (list||[]).forEach(st=>{
      const keys=[st.id,st.baseStationId,st.catalogStationId,`france-catalog:${st.catalogStationId||''}`].filter(Boolean);
      keys.forEach(k=>stationById.set(String(k).split('::')[0],st));
    });
  }
  function installCandidateFilter(){
    const current=window.candidateStations;
    if(typeof current!=='function'||current.__tccStatusFilter)return false;
    const wrapped=async function(...args){
      const result=await current.apply(this,args);
      if(result?.stations){remember(result.stations);result.stations=result.stations.filter(st=>matches(st));}
      return result;
    };
    wrapped.__tccStatusFilter=true;wrapped.__tccStatusOriginal=current;
    window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}
    return true;
  }
  function injectFilter(){
    if(document.getElementById('simStatusFilter'))return true;
    const kind=document.getElementById('simKindFilter');
    const grid=kind?.closest('.filter-grid');
    if(!grid)return false;
    const box=document.createElement('div');
    box.innerHTML='<label>Statut de la station</label><select id="simStatusFilter"><option value="available" selected>Disponible</option><option value="all">Tous les statuts</option><option value="out_of_service">Hors service</option></select><div class="small" style="margin-top:5px">Disponible inclut les bornes occupées et celles sans statut publié. Les horaires restent appliqués séparément au Top 20.</div>';
    grid.appendChild(box);
    return true;
  }
  function badge(st){
    const status=normalized(st);
    if(status===OUT)return ['Hors service','badge-unavailable'];
    if(status===AVAILABLE)return ['Disponible','badge-available'];
    return null;
  }
  function decorate(){
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      if(card.querySelector('.tcc-status-badge'))return;
      const key=String(card.dataset.resultId||'').split('::')[0];
      const st=stationById.get(key);const info=badge(st);if(!info)return;
      const el=document.createElement('span');el.className=`badge tcc-status-badge ${info[1]}`;el.textContent=info[0];
      card.querySelector('.operator-badge')?.insertAdjacentElement('afterend',el);
    });
  }
  function installStyles(){
    if(document.getElementById('tccStatusStyles'))return;
    const style=document.createElement('style');style.id='tccStatusStyles';
    style.textContent='.badge-available{background:#123c27!important;color:#61e493!important}.badge-unavailable{background:#491b20!important;color:#ff9099!important}';
    document.head.appendChild(style);
  }
  function boot(){
    installStyles();
    const uiReady=injectFilter();
    const candidateReady=installCandidateFilter();
    const results=document.getElementById('results');
    if(results&&!results.__tccStatusObserver){
      results.__tccStatusObserver=new MutationObserver(decorate);
      results.__tccStatusObserver.observe(results,{childList:true,subtree:true});
    }
    const filter=document.getElementById('simStatusFilter');
    if(filter&&!filter.__tccStatusBound){
      filter.addEventListener('change',()=>{if(typeof window.compare==='function')window.compare();});
      filter.__tccStatusBound=true;
    }
    return uiReady&&candidateReady;
  }
  function start(){
    let attempts=0;
    boot();
    const timer=setInterval(()=>{attempts++;if(boot()||attempts>240)clearInterval(timer);},250);
  }
  window.TCCStationStatus={normalized,matches,decorate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,0));else setTimeout(start,0);
})();
