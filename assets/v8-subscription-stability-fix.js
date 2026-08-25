// Tesla Charge Companion V8 RC4.8 — stabilisation unique de l'UI abonnements + garde-fou de classement.
(function(){
  'use strict';
  const REVISION='rc48bi-subscription-stable-ui';
  const KEY='tccSubscriptionsV1';
  const $=id=>document.getElementById(id);
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const esc=v=>window.escapeHtml?window.escapeHtml(v):text(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const BUILTIN=[{id:'labornebleue-annual',selectionId:'labornebleue-annual',provider:'La Borne Bleue — Abonnement',monthlyFeeLabel:'10 €/an',control:true}];
  let plans=[],loading=null,expansionWrapped=false,observer=null,busy=false;

  function readState(){try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');return{selected:Array.isArray(s.selected)?s.selected:[]}}catch(e){return{selected:[]}}}
  function selectedSet(){return new Set(readState().selected)}
  function save(ids){localStorage.setItem(KEY,JSON.stringify({selected:[...ids],updatedAt:new Date().toISOString()}));}
  function selectionId(p){return text(p?.selectionId||p?.id)}
  function planLabel(p){if(p?.monthlyFeeLabel)return p.monthlyFeeLabel;if(Number.isFinite(Number(p?.monthlyFeeEur)))return`${Number(p.monthlyFeeEur).toFixed(2).replace('.',',')} €/mois`;return'abonnement'}
  function mergePlans(source){const by=new Map();for(const p of [...(source||[]),...BUILTIN]){const id=selectionId(p);if(!id)continue;if(!by.has(id)||by.get(id).control===false)by.set(id,{...p});}plans=[...by.values()].filter(p=>p.control!==false);return plans;}
  async function loadPlans(){
    if(loading)return loading;
    loading=(async()=>{
      let source=window.TCCV8Subscriptions?.plans||window.TCC_TARIFF_OVERLAY_V1?.subscriptions||null;
      if(!source&&typeof fetch==='function'){
        try{const r=await fetch(`data/tariff_overlay_v1.json?v=${REVISION}`,{cache:'no-store'});if(r.ok)source=(await r.json())?.subscriptions||null;}catch(e){}
      }
      return mergePlans(source||[]);
    })().finally(()=>{loading=null;});
    return loading;
  }

  function isLbbStation(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name].map(norm).filter(Boolean).some(v=>v.includes('la borne bleue')||v==='labornebleue')}
  function inferSubscriptionId(st){
    const explicit=text(st?.subscriptionId||st?.subscriptionSelectionId);if(explicit)return explicit;
    const provider=norm(st?.configurationLabel||st?.label||st?.offerProvider||'');
    if(provider.includes('belib direct abonne non resident'))return'belib-nonresident';
    if(provider.includes('belib direct abonne resident'))return'belib-resident';
    if(provider.includes('la borne bleue direct abonne')||provider.includes('la borne bleue abonne'))return'labornebleue-annual';
    if(isLbbStation(st)&&(provider==='abonne'||provider.startsWith('abonne ')||provider.endsWith(' abonne')))return'labornebleue-annual';
    return'';
  }
  function eligible(st){const id=inferSubscriptionId(st);return !id||selectedSet().has(id)}

  function installExpansionGuard(){
    const current=window.expandConfigurations;if(typeof current!=='function')return false;
    if(current.__tccSubscriptionStabilityV1){expansionWrapped=true;return true;}
    const wrapped=function(baseStations){const out=current.call(this,baseStations)||[];return out.filter(eligible)};
    for(const key of ['__tccOverlayExpansionGuard','__tccDirectResolverPowerV1','__tccDirectSmokeFix'])if(current[key])wrapped[key]=current[key];
    wrapped.__tccSubscriptionStabilityV1=true;wrapped.__tccOriginal=current;
    window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}expansionWrapped=true;return true;
  }

  function injectStyle(){if($('v8SubscriptionStableStyle'))return;const s=document.createElement('style');s.id='v8SubscriptionStableStyle';s.textContent=`
    #v8SubscriptionsBox{display:none!important}
    .v8-sub-stable{margin-top:12px;padding:12px;border:1px solid #303038;border-radius:14px;background:#0f0f13}
    .v8-sub-stable-head{display:flex;justify-content:space-between;gap:10px;align-items:center}
    .v8-sub-stable-count{font-size:10px;color:#9a9aa2;font-weight:700}
    .v8-sub-stable select{width:100%;margin-top:9px;min-height:40px}
    .v8-sub-stable-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
    .v8-sub-stable-chip{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid #35363c;border-radius:10px;background:#151519;font-size:10px}
    .v8-sub-stable-chip span{color:#9a9aa2}.v8-sub-stable-remove{border:0;background:transparent;color:#e0a9a9;font-size:17px;line-height:1;padding:0 2px}
  `;document.head.appendChild(s)}

  async function render(force=false){
    const host=$('v8FilterBody');if(!host)return false;injectStyle();await loadPlans();
    let box=$('v8SubscriptionsStableBox');if(!box){box=document.createElement('div');box.id='v8SubscriptionsStableBox';box.className='v8-sub-stable';host.appendChild(box);}
    const selected=selectedSet(),available=plans.filter(p=>!selected.has(selectionId(p))),active=plans.filter(p=>selected.has(selectionId(p))),sig=`${plans.map(selectionId).join('|')}::${[...selected].sort().join('|')}`;
    if(!force&&box.dataset.sig===sig)return true;
    box.innerHTML=`<div class="v8-sub-stable-head"><div><b>Mes abonnements</b><div class="small" style="margin-top:4px">Seuls les abonnements ajoutés ici participent au classement.</div></div><div class="v8-sub-stable-count">${active.length?`${active.length} actif${active.length>1?'s':''}`:'Aucun actif'}</div></div><select id="v8SubscriptionStableSelect"><option value="">${available.length?'Ajouter un abonnement…':'Tous les abonnements sont déjà ajoutés'}</option>${available.map(p=>`<option value="${esc(selectionId(p))}">${esc(p.provider)} · ${esc(planLabel(p))}</option>`).join('')}</select><div class="v8-sub-stable-chips">${active.length?active.map(p=>`<div class="v8-sub-stable-chip"><div><b>${esc(p.provider)}</b><br><span>${esc(planLabel(p))}</span></div><button type="button" class="v8-sub-stable-remove" data-remove="${esc(selectionId(p))}" aria-label="Retirer ${esc(p.provider)}">×</button></div>`).join(''):'<span class="small">Aucun abonnement sélectionné.</span>'}</div>`;
    $('v8SubscriptionStableSelect')?.addEventListener('change',e=>{const id=text(e.target.value);if(!id)return;const ids=selectedSet();ids.add(id);save(ids);afterChange();});
    box.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',()=>{const ids=selectedSet();ids.delete(btn.dataset.remove);save(ids);afterChange();}));
    box.dataset.sig=sig;return true;
  }

  function afterChange(){render(true);window.TCCV8Subscriptions?.applyAll?.(true);const run=window.compare;if(typeof run==='function')setTimeout(()=>{try{Promise.resolve(run()).then(()=>window.TCCV8Subscriptions?.applyAll?.(true)).catch(()=>{})}catch(e){}},0)}
  function installObserver(){if(observer)return true;const root=document.documentElement;if(!root)return false;let timer=null;observer=new MutationObserver(()=>{if(busy)return;clearTimeout(timer);timer=setTimeout(()=>{busy=true;Promise.resolve(render(false)).finally(()=>{installExpansionGuard();busy=false})},150)});observer.observe(root,{childList:true,subtree:true});return true}
  function markRevision(){const banner=$('tccPreviewBanner');if(banner&&/RC4\.8/.test(text(banner.textContent))&&!/abonnements stabilises/i.test(norm(banner.textContent)))banner.textContent=`${text(banner.textContent)} · abonnements stabilisés`}

  let tries=0;const timer=setInterval(()=>{tries++;installExpansionGuard();render(false);installObserver();markRevision();if(tries>600)clearInterval(timer)},100);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{installExpansionGuard();render(true);installObserver();markRevision()},{once:true});else{installExpansionGuard();render(true);installObserver();markRevision()}
  window.TCCV8SubscriptionStability={revision:REVISION,render,eligible,inferSubscriptionId,selectedSet,installExpansionGuard};
  console.info('[TCC V8] UI abonnements stabilisée : source unique + exclusion fail-closed avant classement.');
})();
