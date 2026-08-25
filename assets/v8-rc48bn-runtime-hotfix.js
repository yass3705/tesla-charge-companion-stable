// Tesla Charge Companion V8 RC4.8 — correctif runtime ciblé rc48bo.
(function(){
  'use strict';
  const REVISION='rc48bo-runtime-hotfix';
  const KEY='tccSubscriptionsV1';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const esc=v=>window.escapeHtml?window.escapeHtml(v):text(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const $=id=>document.getElementById(id);
  const BUILTIN=[{id:'labornebleue-annual',selectionId:'labornebleue-annual',provider:'La Borne Bleue — Abonnement',monthlyFeeLabel:'10 €/an',control:true}];
  let plans=[],plansLoading=null,compareObserver=null,resultsObserver=null,busy=false,renderTimer=null,lockUntil=0,pendingRender=false;

  function mergeRawMetadata(rawList,normalized){
    if(!Array.isArray(normalized))return normalized;
    const raw=Array.isArray(rawList)?rawList:[];
    const byId=new Map(raw.map((cfg,index)=>[String(cfg?.id||`#${index}`),cfg||{}]));
    return normalized.map((cfg,index)=>({...((byId.get(String(cfg?.id||`#${index}`))||raw[index]||{})),...cfg}));
  }

  function installMetadataGuard(){
    let installed=false;
    const n=window.normalizeConfigurations;
    if(typeof n==='function'&&!n.__tccRc48boMetadataHotfix){
      const wrapped=function(configs,st){return mergeRawMetadata(configs,n.call(this,configs,st));};
      wrapped.__tccRc48boMetadataHotfix=true;wrapped.__tccOriginal=n;
      window.normalizeConfigurations=wrapped;try{normalizeConfigurations=wrapped}catch(e){}
      installed=true;
    }else if(typeof n==='function')installed=true;
    const sc=window.stationConfigurations;
    if(typeof sc==='function'&&!sc.__tccRc48boMetadataHotfix){
      const wrapped=function(st){return mergeRawMetadata(st?.chargingConfigurations,sc.call(this,st));};
      wrapped.__tccRc48boMetadataHotfix=true;wrapped.__tccOriginal=sc;
      window.stationConfigurations=wrapped;try{stationConfigurations=wrapped}catch(e){}
      installed=true;
    }else if(typeof sc==='function')installed=true;
    return installed;
  }

  function selectionId(p){return text(p?.selectionId||p?.id)}
  function planLabel(p){if(p?.monthlyFeeLabel)return p.monthlyFeeLabel;if(Number.isFinite(Number(p?.monthlyFeeEur)))return`${Number(p.monthlyFeeEur).toFixed(2).replace('.',',')} €/mois`;return'abonnement'}
  function readSelected(){try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');return new Set(Array.isArray(s.selected)?s.selected:[])}catch(e){return new Set()}}
  function writeSelected(ids){localStorage.setItem(KEY,JSON.stringify({selected:[...ids],updatedAt:new Date().toISOString()}));}
  function mergePlans(source){
    const by=new Map();
    for(const p of [...(source||[]),...BUILTIN]){
      const id=selectionId(p);if(!id)continue;
      const current=by.get(id);
      if(!current||current.control===false||p.control===true)by.set(id,{...p});
    }
    plans=[...by.values()].filter(p=>p.control!==false);return plans;
  }
  async function loadPlans(){
    if(plans.length)return plans;
    if(plansLoading)return plansLoading;
    plansLoading=(async()=>{
      let source=window.TCCV8Subscriptions?.plans||window.TCC_TARIFF_OVERLAY_V1?.subscriptions||null;
      if((!source||!source.length)&&typeof fetch==='function'){
        try{const r=await fetch('data/tariff_overlay_v1.json?v=rc48bo-subscriptions-20260825',{cache:'no-store'});if(r.ok)source=(await r.json())?.subscriptions||[];}catch(e){}
      }
      return mergePlans(source||[]);
    })().finally(()=>{plansLoading=null;});
    return plansLoading;
  }

  function topHost(){return $('v8CompareCard')||$('compare')?.querySelector('.card')||$('compare')||null}
  function installStyle(){
    if($('v8Rc48bnHotfixStyle'))return;
    const s=document.createElement('style');s.id='v8Rc48bnHotfixStyle';
    s.textContent=`#v8SubscriptionsBox,#v8SubscriptionsStableBox{display:none!important}#v8SubscriptionsHotfixBox{display:block!important;margin:12px 0;padding:12px;border:1px solid #303038;border-radius:14px;background:#0f0f13;position:relative;z-index:20}#v8SubscriptionsHotfixBox .v8-hotfix-head{display:flex;justify-content:space-between;gap:10px;align-items:center}#v8SubscriptionsHotfixBox .v8-hotfix-count{font-size:10px;color:#9a9aa2;font-weight:700;white-space:nowrap}#v8SubscriptionsHotfixBox .v8-hotfix-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}#v8SubscriptionsHotfixBox .v8-hotfix-choice{display:flex;align-items:flex-start;gap:9px;padding:9px 10px;border:1px solid #35363c;border-radius:11px;background:#151519;font-size:10px;cursor:pointer;min-width:0}#v8SubscriptionsHotfixBox .v8-hotfix-choice input{width:auto!important;margin:2px 0 0;flex:0 0 auto}#v8SubscriptionsHotfixBox .v8-hotfix-choice span{min-width:0}#v8SubscriptionsHotfixBox .v8-hotfix-choice b{display:block;font-size:11px}#v8SubscriptionsHotfixBox .v8-hotfix-choice small{display:block;color:#9a9aa2;margin-top:2px}@media(max-width:680px){#v8SubscriptionsHotfixBox .v8-hotfix-list{grid-template-columns:1fr}}#tccPreviewBanner::after{content:'V8 Preview · RC4.8 · rc48bo · abonnements stables iOS · métadonnées offres préservées · La Borne Bleue direct calculable · données canoniques France · auto-mise à jour désactivée'!important}`;
    document.head.appendChild(s);
  }
  function placeBox(box,host){
    if(!host)return false;
    const filters=host.querySelector?.('.v8-filter-details');
    if(filters){if(box.parentElement!==host||box.nextElementSibling!==filters)host.insertBefore(box,filters);return true;}
    const core=host.querySelector?.('.v8-core-grid');
    if(core){if(box.previousElementSibling!==core)core.insertAdjacentElement('afterend',box);return true;}
    if(box.parentElement!==host)host.appendChild(box);return true;
  }
  function interactionLocked(box){return Date.now()<lockUntil||!!(box&&box.contains(document.activeElement));}
  function armInteractionLock(){lockUntil=Date.now()+1800;}
  function scheduleRender(force=false,delay=140){
    clearTimeout(renderTimer);renderTimer=setTimeout(()=>{renderTimer=null;if(Date.now()<lockUntil){pendingRender=true;return;}renderSubscriptions(force);},delay);
  }
  async function renderSubscriptions(force=false){
    const host=topHost();if(!host)return false;installStyle();await loadPlans();
    let box=$('v8SubscriptionsHotfixBox');
    if(box&&interactionLocked(box)){pendingRender=true;return true;}
    if(!box){box=document.createElement('div');box.id='v8SubscriptionsHotfixBox';}
    placeBox(box,host);
    const selected=readSelected(),active=plans.filter(p=>selected.has(selectionId(p)));
    const sig=`${plans.map(selectionId).join('|')}::${[...selected].sort().join('|')}`;
    if(!force&&box.dataset.sig===sig)return true;
    box.innerHTML=`<div class="v8-hotfix-head"><div><b>Mes abonnements</b><div class="small" style="margin-top:4px">Coche les forfaits dont tu disposes. Seuls ceux-ci participent au classement.</div></div><div class="v8-hotfix-count">${active.length?`${active.length} actif${active.length>1?'s':''}`:'Aucun actif'}</div></div><div class="v8-hotfix-list">${plans.map(p=>{const id=selectionId(p);return `<label class="v8-hotfix-choice"><input type="checkbox" data-subscription-hotfix="${esc(id)}" ${selected.has(id)?'checked':''}><span><b>${esc(p.provider)}</b><small>${esc(planLabel(p))}</small></span></label>`}).join('')}</div>`;
    box.querySelectorAll('[data-subscription-hotfix]').forEach(input=>{
      const lock=()=>armInteractionLock();
      input.addEventListener('pointerdown',lock,{passive:true});input.addEventListener('touchstart',lock,{passive:true});input.addEventListener('focus',lock,{passive:true});
      input.addEventListener('change',()=>{
        armInteractionLock();const ids=readSelected(),id=text(input.dataset.subscriptionHotfix);if(input.checked)ids.add(id);else ids.delete(id);writeSelected(ids);
        const count=box.querySelector('.v8-hotfix-count');if(count)count.textContent=ids.size?`${ids.size} actif${ids.size>1?'s':''}`:'Aucun actif';
        afterSelectionChange();
      });
      input.addEventListener('blur',()=>{lockUntil=Date.now()+120;if(pendingRender){pendingRender=false;scheduleRender(true,160);}});
    });
    box.dataset.sig=sig;return true;
  }
  function afterSelectionChange(){
    pendingRender=true;
    try{window.TCCV8Subscriptions?.selectionChanged?.();}catch(e){}
    try{prepareLbbSubscriptionRows();window.TCCV8Subscriptions?.applyAll?.(true);}catch(e){}
    const run=window.compare;if(typeof run==='function')setTimeout(()=>{try{Promise.resolve(run()).then(()=>{prepareLbbSubscriptionRows();window.TCCV8Subscriptions?.applyAll?.(true);scheduleRender(true,220)}).catch(()=>{})}catch(e){}},0);
    setTimeout(()=>{lockUntil=0;if(pendingRender){pendingRender=false;scheduleRender(true,40)}},500);
  }

  function isLbbCard(card){
    const head=[card?.querySelector('h3')?.textContent,card?.querySelector('.operator-badge')?.textContent,card?.querySelector('.station-head')?.textContent].map(norm).join(' ');
    return head.includes('la borne bleue');
  }
  function prepareLbbSubscriptionRows(){
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      if(!isLbbCard(card))return;
      card.querySelectorAll('.v8-offer-row').forEach(row=>{
        const provider=norm(row.querySelector('.v8-offer-provider')?.textContent);
        if(provider==='abonne'||provider.startsWith('abonne ')||provider.includes('la borne bleue direct abonne')||provider.includes('la borne bleue abonne'))row.dataset.subscriptionId='labornebleue-annual';
      });
    });
  }
  function cleanDirectFallbacks(){
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      const rows=[...card.querySelectorAll('.v8-offer-row')];
      const calculable=rows.some(row=>{
        if(row.classList.contains('v8-direct-fallback-row')||row.classList.contains('v8-reference-row'))return false;
        const p=text(row.querySelector('.v8-offer-provider')?.textContent).toLowerCase();
        const total=text(row.querySelector('.v8-offer-total')?.textContent);
        return p.startsWith('la borne bleue direct')&&/\d/.test(total)&&/€|eur/i.test(total);
      });
      if(calculable)card.querySelectorAll('.v8-direct-fallback-row').forEach(row=>row.remove());
    });
  }
  function refreshResults(){
    prepareLbbSubscriptionRows();cleanDirectFallbacks();
    try{window.TCCV8Subscriptions?.applyAll?.(true);}catch(e){}
  }
  function markRevision(){
    installStyle();const banner=$('tccPreviewBanner');if(!banner)return;
    const label='V8 Preview · RC4.8 · rc48bo · abonnements stables iOS · métadonnées offres préservées · La Borne Bleue direct calculable · données canoniques France · auto-mise à jour désactivée';
    banner.dataset.stableLabel=label;banner.setAttribute('aria-label',label);
  }
  function tick(){installMetadataGuard();renderSubscriptions(false);markRevision();}
  function installObservers(){
    const compare=$('compare');
    if(compare&&!compareObserver){
      let timer=null;compareObserver=new MutationObserver(mutations=>{
        if(busy||Date.now()<lockUntil)return;
        const relevant=mutations.some(m=>!m.target?.closest?.('#v8SubscriptionsHotfixBox'));
        if(!relevant)return;clearTimeout(timer);timer=setTimeout(()=>{busy=true;Promise.resolve(renderSubscriptions(false)).finally(()=>{busy=false})},140);
      });compareObserver.observe(compare,{childList:true,subtree:true});
    }
    const results=$('results');
    if(results&&!resultsObserver){
      let timer=null;resultsObserver=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(refreshResults,220)});resultsObserver.observe(results,{childList:true,subtree:true,characterData:true});
    }
  }

  installStyle();tick();installObservers();
  let tries=0;const bootTimer=setInterval(()=>{tries++;installMetadataGuard();installObservers();renderSubscriptions(false);markRevision();if(($('v8SubscriptionsHotfixBox')&&$('v8CompareCard'))||tries>=60)clearInterval(bootTimer)},250);
  document.addEventListener('click',event=>{if(event.target?.closest?.('.v8-simulate,#routeButton'))installMetadataGuard();},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{tick();installObservers()},{once:true});
  window.TCCV8RC48BNHotfix={revision:REVISION,installMetadataGuard,renderSubscriptions,cleanDirectFallbacks,prepareLbbSubscriptionRows,refreshResults};
  console.info('[TCC V8] rc48bo actif : abonnements persistants sans select natif iOS + identité des offres préservée.');
})();