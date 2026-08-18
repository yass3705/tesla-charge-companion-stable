// Tesla Charge Companion V8 — filtre opérateurs dynamique selon la zone chargée.
(function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const esc=v=>window.escapeHtml?window.escapeHtml(v):text(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const aliases={
    'total energies':'TotalEnergies','totalenergies':'TotalEnergies','total energie':'TotalEnergies',
    'tesla':'Tesla','swish':'Swish','izivia':'Izivia','alize':'Alizé','alizé':'Alizé',
    'kilowatt':'Kilowatt','iecharge':'IECharge','fastvolt':'FastVolt','lidl france':'Lidl','lidl':'Lidl'
  };

  function plain(v){return text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
  function operatorOf(st){
    if(st?.source==='teslaSupercharger')return'Tesla';
    const raw=text(st?.operator);
    const key=plain(raw);
    return aliases[key]||raw||'Autre / opérateur non renseigné';
  }

  function refreshOperatorChoicesDynamic(sourceStations){
    const host=document.getElementById('augOperatorChoices');
    if(!host)return;
    const current=[...host.querySelectorAll('input[type=checkbox]')];
    const previous=new Map(current.map(x=>[x.value,x.checked]));
    const previousAll=current.length>0&&current.every(x=>x.checked);
    const touched=host.dataset.tccUserTouched==='1';

    const ops=[...new Set((sourceStations||[]).map(operatorOf).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'fr'));

    host.innerHTML=ops.map(op=>{
      let checked;
      if(previous.has(op))checked=previous.get(op);
      else if(previousAll)checked=true;
      else if(!touched)checked=(op==='Tesla');
      else checked=false;
      return `<label class="operator-choice"><input type="checkbox" value="${esc(op)}" ${checked?'checked':''}> ${esc(op)}</label>`;
    }).join('');

    host.dataset.tccDynamic='1';
    let hint=document.getElementById('tccDynamicOperatorHint');
    if(!hint){
      hint=document.createElement('div');
      hint.id='tccDynamicOperatorHint';
      hint.className='small';
      hint.style.margin='8px 0';
      host.parentNode.insertBefore(hint,host);
    }
    hint.textContent=`${ops.length} opérateur(s) disponibles dans la zone chargée.`;
  }

  async function preloadAreaOperators(){
    if(typeof candidateStations!=='function')return null;
    const raw=String(document.getElementById('simMaxDistance')?.value??'').trim();
    const maxDistanceKm=raw===''?0:Math.max(0,Number(raw)||0);
    const prepared=await candidateStations('all',maxDistanceKm);
    if(prepared?.stations)refreshOperatorChoicesDynamic(prepared.stations);
    return prepared;
  }

  function markOperatorInteraction(){
    const host=document.getElementById('augOperatorChoices');
    if(host)host.dataset.tccUserTouched='1';
  }

  function installInteractionTracking(){
    const host=document.getElementById('augOperatorChoices');
    if(host&&!host.__tccDynamicBound){
      host.addEventListener('change',markOperatorInteraction);
      host.__tccDynamicBound=true;
    }
    if(typeof window.augSelectAllOperators==='function'&&!window.augSelectAllOperators.__tccDynamicWrapped){
      const original=window.augSelectAllOperators;
      const wrapped=function(on){markOperatorInteraction();return original(on);};
      wrapped.__tccDynamicWrapped=true;
      window.augSelectAllOperators=wrapped;
      try{augSelectAllOperators=wrapped}catch(e){}
    }
  }

  function installCompareWrapper(){
    const current=window.compare;
    if(typeof current!=='function'||current.__tccDynamicOperatorsWrapped)return false;
    // On se place à l'extérieur du wrapper multi-offres afin de conserver
    // l'ordre : préchargement zone -> comparaison -> regroupement tarifs.
    if(!current.__tccV8OfferDomWrapped)return false;
    const wrapped=async function(...args){
      installInteractionTracking();
      try{await preloadAreaOperators();}
      catch(err){console.warn('[TCC V8] Filtre opérateurs dynamique indisponible :',err?.message||err);}
      return current.apply(this,args);
    };
    wrapped.__tccDynamicOperatorsWrapped=true;
    wrapped.__tccV8OfferDomWrapped=true;
    wrapped.__tccDynamicOriginal=current;
    window.compare=wrapped;
    try{compare=wrapped}catch(e){}
    return true;
  }

  function waitForAugust(){
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      installInteractionTracking();
      if(installCompareWrapper()||attempts>150)clearInterval(timer);
    },100);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',waitForAugust,{once:true});
  else waitForAugust();

  window.TCCV8DynamicOperators={refresh:refreshOperatorChoicesDynamic,preload:preloadAreaOperators};
  console.info('[TCC V8] Filtre opérateurs dynamique prêt.');
})();
