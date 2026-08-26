// Tesla Charge Companion V8 — comparaison des offres par station physique + puissance.
// Electroverse, Electra et les futures offres (abonnement / opérateur direct)
// restent distinctes pour le calcul, puis sont regroupées visuellement.
(function(){
  'use strict';

  function text(v){return String(v==null?'':v).trim();}
  function esc(v){return (window.escapeHtml?window.escapeHtml(v):text(v).replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[ch])));}
  function providerFromStation(st){
    const label=text(st?.configurationLabel);
    const match=label.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    if(match&&match[1])return match[1].trim();
    return text(st?.offerProvider)||text(st?.operator)||'Tarif disponible';
  }
  function physicalKey(row){
    const st=row?.st||{};
    const base=text(st.catalogStationId)||text(st.baseStationId)||text(st.id).split('::')[0];
    const power=Number(st.powerKw||0);
    return `${base}|${text(st.kind).toUpperCase()}|${Number.isFinite(power)?power.toFixed(2):'0'}`;
  }
  function finiteCost(row){return !row?.r?.unavailable&&!row?.r?.unknown&&Number.isFinite(row?.r?.total);}
  function subscriptionIdForProvider(value){
    const api=window.TCCV8Subscriptions;if(api?.subscriptionIdForProvider)return api.subscriptionIdForProvider(value);
    const provider=text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
    if(provider.includes('belib direct abonne non resident'))return'belib-nonresident';
    if(provider.includes('belib direct abonne resident'))return'belib-resident';
    return'';
  }
  function selectedSubscriptions(){
    if(window.TCCV8Subscriptions?.selectedSet)return window.TCCV8Subscriptions.selectedSet();
    try{const value=JSON.parse(localStorage.getItem('tccSubscriptionsV1')||'{}');return new Set(Array.isArray(value.selected)?value.selected:[])}catch(e){return new Set()}
  }
  function providerEligible(provider){const id=subscriptionIdForProvider(provider);return !id||selectedSubscriptions().has(id);}
  function stationEligible(st){
    if(window.TCCV8Subscriptions?.isStationEligible)return window.TCCV8Subscriptions.isStationEligible(st);
    return providerEligible(providerFromStation(st));
  }
  function gPower(st){const p=Number(st?.powerKw);return Number.isFinite(p)?p:0;}
  function cloneWinner(row,variants){
    const known=variants.filter(finiteCost).sort((a,b)=>a.r.total-b.r.total||providerFromStation(a.st).localeCompare(providerFromStation(b.st),'fr'));
    const eligibleVariants=variants.filter(v=>stationEligible(v.st));
    const eligibleKnown=known.filter(v=>stationEligible(v.st));
    // Fail closed : une offre avec abonnement non sélectionné ne doit jamais redevenir
    // gagnante via un fallback lorsque toutes les offres tarifées éligibles ont disparu.
    let winner=eligibleKnown[0]||eligibleVariants.slice().sort((a,b)=>(a.distanceKm??Infinity)-(b.distanceKm??Infinity))[0];
    if(!winner)return null;
    const st={...winner.st};
    const offers=(known.length?known:variants).map(v=>({provider:providerFromStation(v.st),total:Number.isFinite(v?.r?.total)?v.r.total:null,configurationId:v?.st?.configurationId||null,configurationLabel:v?.st?.configurationLabel||'',subscriptionId:subscriptionIdForProvider(providerFromStation(v.st))||null})).sort((a,b)=>(a.total??Infinity)-(b.total??Infinity)||a.provider.localeCompare(b.provider,'fr'));
    const uniqueProviders=[...new Set(offers.map(o=>o.provider).filter(Boolean))];
    const min=eligibleKnown.length?eligibleKnown[0].r.total:null;
    const cheapest=min==null?[]:[...new Set(eligibleKnown.filter(v=>Math.abs(v.r.total-min)<0.01).map(v=>providerFromStation(v.st)))];
    const power=Number(st.powerKw||0);
    const baseLabel=`${st.kind||''} ${Number.isFinite(power)?power:gPower(st)} kW`.trim();
    if(known.length>1)st.configurationLabel=cheapest.length>1?`${baseLabel} · meilleur tarif ex æquo ${cheapest.join(' / ')}`:`${baseLabel} · meilleur tarif ${cheapest[0]||providerFromStation(st)}`;
    st._offerComparison={count:variants.length,pricedCount:known.length,providers:uniqueProviders,cheapestProviders:cheapest,offers};
    return {...winner,st};
  }
  function collapseOfferVariants(rows){
    const groups=new Map();
    for(const row of rows||[]){const key=physicalKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    return [...groups.values()].map(group=>cloneWinner(group[0],group)).filter(Boolean);
  }

  // Compatibilité avec l'ancien comparateur V7.x.
  if(typeof rankByPriceDistance==='function'){
    const originalRank=rankByPriceDistance;
    rankByPriceDistance=function(rows,mode){
      const collapsed=collapseOfferVariants(rows);
      window.TCC_LAST_OFFER_GROUPING={raw:(rows||[]).length,collapsed:collapsed.length,groups:collapsed.map(x=>x.st?._offerComparison).filter(Boolean)};
      return originalRank(collapsed,mode);
    };
  }

  function parseTitle(card){
    const h3=card.querySelector('h3');
    const raw=text(h3?.textContent).replace(/^\d+\.\s*/,'');
    // Catalogue national : « Nom station — Electroverse · AC 22 kW ».
    const m=raw.match(/^(.*)\s+—\s+(.+?)\s*·\s*(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW(?:\b|$)/i);
    if(m)return{h3,station:m[1].trim(),provider:m[2].trim(),kind:m[3].toUpperCase(),power:Number(m[4].replace(',','.'))};
    const simple=raw.match(/^(.*)\s+—\s+(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW(?:\b|$)/i);
    if(simple)return{h3,station:simple[1].trim(),provider:'',kind:simple[2].toUpperCase(),power:Number(simple[3].replace(',','.'))};
    return{h3,station:raw,provider:'',kind:'',power:0};
  }
  function parseDisplayedCost(card){
    const el=card.querySelector('.cost');if(!el)return null;
    const own=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ').trim()||text(el.textContent);
    const m=own.replace(/\u00a0/g,' ').match(/-?\d[\d\s]*(?:[.,]\d+)?/);
    if(!m)return null;
    const n=Number(m[0].replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;
  }
  function tariffText(card){
    for(const el of card.querySelectorAll('.small')){
      const t=text(el.textContent);
      const m=t.match(/Tarif\s*:\s*([^·\n]+)/i);
      if(m)return m[1].trim();
    }
    return 'Tarif variable';
  }
  function providerName(info,card){
    if(info.provider)return info.provider;
    const t=text(info.h3?.textContent);
    if(/Electroverse/i.test(t))return'Electroverse';
    if(/Electra/i.test(t))return'Electra';
    return'Tarif disponible';
  }
  function groupKey(card){
    const info=parseTitle(card);
    const base=text(card.dataset.resultId)||info.station;
    return `${base}|${info.kind}|${Number(info.power||0).toFixed(2)}`;
  }
  function formatEuro(v){
    if(!Number.isFinite(v))return'Total à calculer';
    try{return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(v)}catch(e){return`${v.toFixed(2)} €`;}
  }
  function ensureOfferStyle(){
    if(document.getElementById('tccV8OfferStyle'))return;
    const style=document.createElement('style');style.id='tccV8OfferStyle';
    style.textContent=`
      .v8-offer-box{margin:12px 0;padding:12px;border:1px solid #343438;border-radius:14px;background:#101012}
      .v8-offer-title{font-size:12px;font-weight:800;margin-bottom:8px;color:#c9c9cf}
      .v8-offer-row{display:grid;grid-template-columns:minmax(92px,1fr) minmax(96px,1fr) auto;gap:8px;align-items:center;padding:8px 9px;margin-top:6px;border:1px solid #2d2d31;border-radius:10px;font-size:12px}
      .v8-offer-row.best{border-color:#2d6b43;background:rgba(39,120,70,.13)}
      .v8-offer-provider{font-weight:800}.v8-offer-price{color:#c7c7cc}.v8-offer-total{font-weight:900;text-align:right;white-space:nowrap}
      .v8-offer-best{display:inline-block;margin-left:5px;color:#55d984;font-size:10px;font-weight:900}
      .v8-offer-note{margin-top:8px;color:#8f8f96;font-size:10px}
      @media(max-width:520px){.v8-offer-row{grid-template-columns:1fr auto}.v8-offer-price{grid-column:1 / -1}.v8-offer-total{grid-column:2;grid-row:1}}
    `;
    document.head.appendChild(style);
  }
  function maybeFixPhysicalOperator(card,stationName){
    const badge=card.querySelector('.operator-badge');if(!badge)return;
    const current=text(badge.textContent).toLowerCase();
    if((!current||current.includes('non renseign')||current==='autre')&&/^lidl\b/i.test(stationName))badge.textContent='Lidl';
  }
  function renderOfferBox(entries,minCost){
    const cheapest=entries.filter(x=>providerEligible(x.provider)&&Number.isFinite(x.cost)&&Number.isFinite(minCost)&&Math.abs(x.cost-minCost)<0.01);
    return `<div class="v8-offer-box"><div class="v8-offer-title">Tarifs disponibles pour cette puissance</div>${entries.map(x=>{
      const best=providerEligible(x.provider)&&Number.isFinite(x.cost)&&Number.isFinite(minCost)&&Math.abs(x.cost-minCost)<0.01;
      const bestText=best?(cheapest.length>1?'✓ meilleur ex æquo':'✓ moins cher'):'';
      return `<div class="v8-offer-row${best?' best':''}"><div class="v8-offer-provider">${esc(x.provider)}${bestText?`<span class="v8-offer-best">${bestText}</span>`:''}</div><div class="v8-offer-price">${esc(x.tariff)}</div><div class="v8-offer-total">${esc(formatEuro(x.cost))}</div></div>`;
    }).join('')}<div class="v8-offer-note">Le meilleur tarif est choisi sur le coût total de la session simulée (énergie + frais éventuels), pas uniquement sur le €/kWh.</div></div>`;
  }
  function decorateAndCollapseAugustResults(){
    const root=document.getElementById('results');if(!root)return;
    ensureOfferStyle();
    const cards=[...root.querySelectorAll('.result-card[data-result-id]')];if(!cards.length)return;
    const groups=new Map();
    cards.forEach((card,index)=>{const key=groupKey(card);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({card,index,info:parseTitle(card),cost:parseDisplayedCost(card),tariff:tariffText(card)});});

    for(const entries of groups.values()){
      entries.forEach(e=>e.provider=providerName(e.info,e.card));
      const eligibleEntries=entries.filter(e=>providerEligible(e.provider));
      // Si le groupe ne contient que des variantes d'abonnement non sélectionnées,
      // aucune carte ne doit subsister comme résultat classable.
      if(!eligibleEntries.length){entries.forEach(e=>e.card.remove());continue;}
      const known=entries.filter(e=>Number.isFinite(e.cost));
      const eligibleKnown=known.filter(e=>providerEligible(e.provider));
      const minCost=eligibleKnown.length?Math.min(...eligibleKnown.map(e=>e.cost)):null;
      const winner=eligibleKnown.length?eligibleKnown.slice().sort((a,b)=>a.cost-b.cost||a.index-b.index)[0]:eligibleEntries.slice().sort((a,b)=>a.index-b.index)[0];
      const anchor=entries.slice().sort((a,b)=>a.index-b.index)[0];
      if(winner.card!==anchor.card)anchor.card.parentNode.insertBefore(winner.card,anchor.card);

      const info=winner.info;
      maybeFixPhysicalOperator(winner.card,info.station);
      if(info.h3&&info.kind&&info.power){
        const number=(text(info.h3.textContent).match(/^(\d+)\./)||[])[1]||'';
        info.h3.textContent=`${number?number+'. ':''}${info.station} — ${info.kind} ${info.power} kW`;
      }
      winner.card.querySelector('.v8-offer-box')?.remove();
      const head=winner.card.querySelector('.station-head');
      if(head)head.insertAdjacentHTML('afterend',renderOfferBox(entries,minCost));
      for(const e of entries){if(e.card!==winner.card)e.card.remove();}
    }

    const remaining=[...root.querySelectorAll('.result-card[data-result-id]')];
    remaining.forEach((card,i)=>{const h3=card.querySelector('h3');if(h3)h3.textContent=text(h3.textContent).replace(/^\d+\.\s*/,`${i+1}. `);});
    const status=document.getElementById('routeStatus');
    if(status)status.innerHTML=status.innerHTML.replace(/\d+\s+résultat\(s\)/i,`${remaining.length} résultat(s)`);
    window.TCC_LAST_OFFER_DOM={before:cards.length,after:remaining.length,groups:[...groups.values()].map(g=>g.length)};
  }

  // August RC charge son comparateur après DOMContentLoaded via august-release.js.
  // On attend donc précisément compareAugust avant d'installer le post-traitement.
  function installAugustWrapper(){
    const current=window.compare;
    if(typeof current!=='function'||current.__tccV8OfferDomWrapped)return false;
    if(current.name!=='compareAugust')return false;
    const wrapped=async function(...args){const result=await current.apply(this,args);decorateAndCollapseAugustResults();return result;};
    wrapped.__tccV8OfferDomWrapped=true;
    wrapped.__tccV8Original=current;
    window.compare=wrapped;
    try{compare=wrapped}catch(e){}
    return true;
  }
  function waitForAugust(){
    let attempts=0;
    const timer=setInterval(()=>{attempts++;if(installAugustWrapper()||attempts>120)clearInterval(timer);},100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',waitForAugust,{once:true});else waitForAugust();

  // En V8 la synchronisation devient une fonction personnelle avancée.
  if(typeof customStationsForSync==='function'){
    customStationsForSync=function(){return stations.filter(st=>st?.source==='custom').map(st=>({...st,_syncUpdatedAt:stationSyncTime(st,st.lastUpdated?`${st.lastUpdated}T00:00:00Z`:'1970-01-01T00:00:00Z')}));};
  }
  if(typeof applyMergedCustomState==='function'){
    applyMergedCustomState=function(state){const cloud=parseCustomCloudData(state);const published=stations.filter(st=>st?.source!=='custom');const custom=cloud.stations.map(st=>normalizeStation({...st,source:st?.source||'custom'}));stations=[...published,...custom];saveCustomDeletions(cloud.deletedIds||{});saveLocal();renderStations();};
  }

  window.openAdvancedSync=function(){document.querySelectorAll('nav button,.panel').forEach(x=>x.classList.remove('active'));const panel=document.getElementById('sync');if(panel)panel.classList.add('active');if(typeof loadGithubSettingsForm==='function')loadGithubSettingsForm();window.scrollTo({top:0,behavior:'smooth'});};
  window.openSettingsPanel=function(){document.querySelectorAll('nav button,.panel').forEach(x=>x.classList.remove('active'));const button=document.querySelector('nav button[data-tab="fx"]');if(button)button.classList.add('active');const panel=document.getElementById('fx');if(panel)panel.classList.add('active');if(typeof renderFxRates==='function')renderFxRates();window.scrollTo({top:0,behavior:'smooth'});};

  window.TCCV8OfferSelection={collapseOfferVariants,providerFromStation,decorateAndCollapseAugustResults,subscriptionIdForProvider,providerEligible,stationEligible};
  console.info('[TCC V8] Comparaison multi-offres par station physique + puissance prête.');
})();