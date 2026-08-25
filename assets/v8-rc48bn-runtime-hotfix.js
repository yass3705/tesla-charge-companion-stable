// Tesla Charge Companion V8 RC4.8 — correctif runtime ciblé rc48bn.
(function(){
  'use strict';
  const REVISION='rc48bn-runtime-hotfix';
  const KEY='tccSubscriptionsV1';
  const text=v=>String(v==null?'':v).trim();
  const esc=v=>window.escapeHtml?window.escapeHtml(v):text(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const $=id=>document.getElementById(id);
  const BUILTIN=[{id:'labornebleue-annual',selectionId:'labornebleue-annual',provider:'La Borne Bleue — Abonnement',monthlyFeeLabel:'10 €/an',control:true}];
  let plans=[],plansLoading=null,observer=null,busy=false;

  function mergeRawMetadata(rawList,normalized){
    if(!Array.isArray(normalized))return normalized;
    const raw=Array.isArray(rawList)?rawList:[];
    const byId=new Map(raw.map((cfg,index)=>[String(cfg?.id||`#${index}`),cfg||{}]));
    return normalized.map((cfg,index)=>({...((byId.get(String(cfg?.id||`#${index}`))||raw[index]||{})),...cfg}));
  }

  function installMetadataGuard(){
    let installed=false;
    const n=window.normalizeConfigurations;
    if(typeof n==='function'&&!n.__tccRc48bnMetadataHotfix){
      const wrapped=function(configs,st){return mergeRawMetadata(configs,n.call(this,configs,st));};
      wrapped.__tccRc48bnMetadataHotfix=true;wrapped.__tccOriginal=n;
      window.normalizeConfigurations=wrapped;try{normalizeConfigurations=wrapped}catch(e){}
      installed=true;
    }else if(typeof n==='function')installed=true;
    const sc=window.stationConfigurations;
    if(typeof sc==='function'&&!sc.__tccRc48bnMetadataHotfix){
      const wrapped=function(st){return mergeRawMetadata(st?.chargingConfigurations,sc.call(this,st));};
      wrapped.__tccRc48bnMetadataHotfix=true;wrapped.__tccOriginal=sc;
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
    if(plansLoading)return plansLoading;
    plansLoading=(async()=>{
      let source=window.TCCV8Subscriptions?.plans||window.TCC_TARIFF_OVERLAY_V1?.subscriptions||null;
      if((!source||!source.length)&&typeof fetch==='function'){
        try{const r=await fetch('data/tariff_overlay_v1.json?v=rc48bn-hotfix-20260825',{cache:'no-store'});if(r.ok)source=(await r.json())?.subscriptions||[];}catch(e){}
      }
      return mergePlans(source||[]);
    })().finally(()=>{plansLoading=null;});
    return plansLoading;
  }

  function topHost(){return $('v8CompareCard')||$('compare')?.querySelector('.card')||$('compare')||null}
  function installStyle(){
    if($('v8Rc48bnHotfixStyle'))return;
    const s=document.createElement('style');s.id='v8Rc48bnHotfixStyle';
    s.textContent=`#v8SubscriptionsBox,#v8SubscriptionsStableBox{display:none!important}#v8SubscriptionsHotfixBox{display:block!important;margin:12px 0;padding:12px;border:1px solid #303038;border-radius:14px;background:#0f0f13;position:relative;z-index:20}#v8SubscriptionsHotfixBox .v8-hotfix-head{display:flex;justify-content:space-between;gap:10px;align-items:center}#v8SubscriptionsHotfixBox .v8-hotfix-count{font-size:10px;color:#9a9aa2;font-weight:700;white-space:nowrap}#v8SubscriptionsHotfixBox select{width:100%;margin-top:9px;min-height:40px}#v8SubscriptionsHotfixBox .v8-hotfix-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}#v8SubscriptionsHotfixBox .v8-hotfix-chip{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid #35363c;border-radius:10px;background:#151519;font-size:10px}#v8SubscriptionsHotfixBox .v8-hotfix-chip span{color:#9a9aa2}#v8SubscriptionsHotfixBox .v8-hotfix-remove{border:0;background:transparent;color:#e0a9a9;font-size:17px;line-height:1;padding:0 2px}#tccPreviewBanner::after{content:'V8 Preview · RC4.8 · rc48bn · abonnements visibles · métadonnées offres préservées · La Borne Bleue direct calculable · données canoniques France · auto-mise à jour désactivée'!important}`;
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
  async function renderSubscriptions(force=false){
    const host=topHost();if(!host)return false;installStyle();await loadPlans();
    let box=$('v8SubscriptionsHotfixBox');if(!box){box=document.createElement('div');box.id='v8SubscriptionsHotfixBox';}
    placeBox(box,host);
    const selected=readSelected(),available=plans.filter(p=>!selected.has(selectionId(p))),active=plans.filter(p=>selected.has(selectionId(p)));
    const sig=`${plans.map(selectionId).join('|')}::${[...selected].sort().join('|')}`;
    if(!force&&box.dataset.sig===sig)return true;
    box.innerHTML=`<div class="v8-hotfix-head"><div><b>Mes abonnements</b><div class="small" style="margin-top:4px">Seuls les abonnements ajoutés ici participent au classement.</div></div><div class="v8-hotfix-count">${active.length?`${active.length} actif${active.length>1?'s':''}`:'Aucun actif'}</div></div><select id="v8SubscriptionHotfixSelect"><option value="">${available.length?'Ajouter un abonnement…':'Tous les abonnements sont déjà ajoutés'}</option>${available.map(p=>`<option value="${esc(selectionId(p))}">${esc(p.provider)} · ${esc(planLabel(p))}</option>`).join('')}</select><div class="v8-hotfix-chips">${active.length?active.map(p=>`<div class="v8-hotfix-chip"><div><b>${esc(p.provider)}</b><br><span>${esc(planLabel(p))}</span></div><button type="button" class="v8-hotfix-remove" data-remove="${esc(selectionId(p))}" aria-label="Retirer ${esc(p.provider)}">×</button></div>`).join(''):'<span class="small">Aucun abonnement sélectionné.</span>'}</div>`;
    $('v8SubscriptionHotfixSelect')?.addEventListener('change',e=>{const id=text(e.target.value);if(!id)return;const ids=readSelected();ids.add(id);writeSelected(ids);afterSelectionChange();});
    box.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',()=>{const ids=readSelected();ids.delete(btn.dataset.remove);writeSelected(ids);afterSelectionChange();}));
    box.dataset.sig=sig;return true;
  }
  function afterSelectionChange(){
    renderSubscriptions(true);
    try{window.TCCV8Subscriptions?.selectionChanged?.();}catch(e){}
    try{window.TCCV8Subscriptions?.applyAll?.(true);}catch(e){}
    const run=window.compare;if(typeof run==='function')setTimeout(()=>{try{Promise.resolve(run()).then(()=>window.TCCV8Subscriptions?.applyAll?.(true)).catch(()=>{})}catch(e){}},0);
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
  function markRevision(){
    installStyle();const banner=$('tccPreviewBanner');if(!banner)return;
    const label='V8 Preview · RC4.8 · rc48bn · abonnements visibles · métadonnées offres préservées · La Borne Bleue direct calculable · données canoniques France · auto-mise à jour désactivée';
    banner.dataset.stableLabel=label;banner.setAttribute('aria-label',label);
  }
  function tick(){installMetadataGuard();renderSubscriptions(false);cleanDirectFallbacks();markRevision();}
  function installObserver(){
    if(observer||!document.documentElement)return;
    let timer=null;observer=new MutationObserver(()=>{if(busy)return;clearTimeout(timer);timer=setTimeout(()=>{busy=true;Promise.resolve(tick()).finally(()=>{busy=false})},80)});
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }

  installStyle();tick();installObserver();
  let tries=0;const timer=setInterval(()=>{tries++;tick();if(tries>1200)clearInterval(timer)},100);
  document.addEventListener('click',event=>{if(event.target?.closest?.('.v8-simulate,#routeButton'))installMetadataGuard();},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{tick();installObserver()},{once:true});
  window.TCCV8RC48BNHotfix={revision:REVISION,installMetadataGuard,renderSubscriptions,cleanDirectFallbacks};
  console.info('[TCC V8] rc48bn hotfix actif : identité des offres préservée + abonnements visibles hors filtres.');
})();