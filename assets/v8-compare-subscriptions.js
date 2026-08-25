// Tesla Charge Companion V8 RC4.8 — UI abonnements compacte et unique pour la page Comparer.
// Une seule UI, repliable, stable iOS et alimentée par le catalogue complet des abonnements.
(function(){
  'use strict';

  const REVISION='rc48bt-compare-subscriptions';
  const KEY='tccSubscriptionsV1';
  const OPEN_KEY='tccSubscriptionsPanelOpenV1';
  const BUILTIN=[
    {id:'labornebleue-annual',selectionId:'labornebleue-annual',provider:'La Borne Bleue — Abonnement',monthlyFeeLabel:'10 €/an',control:true}
  ];
  const BUILTIN_IDS=new Set(BUILTIN.map(p=>String(p.selectionId||p.id)));
  const $=id=>document.getElementById(id);
  const text=v=>String(v==null?'':v).trim();
  const esc=v=>window.escapeHtml?window.escapeHtml(v):text(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  let plans=[];
  let loading=null;
  let observer=null;
  let renderTimer=null;
  let bootAttempts=0;

  function selectionId(plan){return text(plan?.selectionId||plan?.id)}
  function planLabel(plan){
    if(plan?.monthlyFeeLabel)return text(plan.monthlyFeeLabel);
    if(Number.isFinite(Number(plan?.monthlyFeeEur)))return `${Number(plan.monthlyFeeEur).toFixed(2).replace('.',',')} €/mois`;
    return 'abonnement';
  }
  function readSelected(){
    try{const state=JSON.parse(localStorage.getItem(KEY)||'{}');return new Set(Array.isArray(state?.selected)?state.selected:[])}catch(e){return new Set()}
  }
  function writeSelected(ids){localStorage.setItem(KEY,JSON.stringify({selected:[...ids],updatedAt:new Date().toISOString()}));}
  function readOpen(){try{return localStorage.getItem(OPEN_KEY)==='1'}catch(e){return false}}
  function writeOpen(open){try{localStorage.setItem(OPEN_KEY,open?'1':'0')}catch(e){}}
  function hasExternalPlan(source){return Array.isArray(source)&&source.some(plan=>{const id=selectionId(plan);return id&&!BUILTIN_IDS.has(id)})}

  function mergePlans(source){
    const byId=new Map();
    for(const plan of [...(Array.isArray(source)?source:[]),...BUILTIN]){
      const id=selectionId(plan);if(!id)continue;
      const current=byId.get(id);
      if(!current||current.control===false||plan.control===true)byId.set(id,{...current,...plan});
    }
    plans=[...byId.values()].filter(plan=>plan.control!==false);
    return plans;
  }

  async function loadPlans(force=false){
    if(hasExternalPlan(plans)&&!force)return plans;
    if(loading)return loading;
    loading=(async()=>{
      let source=null;

      // TCCV8Subscriptions peut être exposé avant que son propre boot asynchrone ait
      // remplacé le seul plan builtin La Borne Bleue par le catalogue JSON complet.
      // On appelle donc explicitement loadPlans(), même si api.plans n'est pas vide.
      if(typeof window.TCCV8Subscriptions?.loadPlans==='function'){
        try{
          const upstream=await window.TCCV8Subscriptions.loadPlans();
          if(Array.isArray(upstream)&&upstream.length)source=upstream;
        }catch(e){}
      }

      const globalPlans=window.TCC_TARIFF_OVERLAY_V1?.subscriptions;
      if(!hasExternalPlan(source)&&Array.isArray(globalPlans)&&globalPlans.length)source=globalPlans;

      if(!hasExternalPlan(source)&&typeof fetch==='function'){
        try{
          const response=await fetch('data/tariff_overlay_v1.json?v=rc48bt-subscriptions-20260825',{cache:'no-store'});
          if(response.ok){
            const remote=(await response.json())?.subscriptions;
            if(Array.isArray(remote)&&remote.length)source=remote;
          }
        }catch(e){}
      }

      if(!source){
        const exposed=window.TCCV8Subscriptions?.plans;
        if(Array.isArray(exposed)&&exposed.length)source=exposed;
      }
      return mergePlans(source||[]);
    })().finally(()=>{loading=null});
    return loading;
  }

  function host(){return $('v8CompareCard')||$('compare')?.querySelector('.card')||$('compare')||null}
  function place(box){
    const root=host();if(!root)return false;
    const filters=root.querySelector?.('.v8-filter-details');
    if(filters){if(box.parentElement!==root||box.nextElementSibling!==filters)root.insertBefore(box,filters);return true;}
    const core=root.querySelector?.('.v8-core-grid');
    if(core){if(box.previousElementSibling!==core)core.insertAdjacentElement('afterend',box);return true;}
    if(box.parentElement!==root)root.appendChild(box);
    return true;
  }

  function installStyle(){
    if($('v8CompareSubscriptionsStyle'))return;
    const style=document.createElement('style');style.id='v8CompareSubscriptionsStyle';
    style.textContent=`
      #v8SubscriptionsBox,#v8SubscriptionsStableBox,#v8SubscriptionsHotfixBox{display:none!important}
      #v8SubscriptionsCompactBox{margin:10px 0;border:1px solid #303038;border-radius:13px;background:#0f0f13;overflow:hidden;position:relative;z-index:2}
      #v8SubscriptionsCompactBox>summary{display:flex;align-items:center;gap:10px;min-height:46px;padding:9px 12px;cursor:pointer;list-style:none;user-select:none;-webkit-user-select:none}
      #v8SubscriptionsCompactBox>summary::-webkit-details-marker{display:none}
      #v8SubscriptionsCompactBox>summary:before{content:'▸';color:#a9a9b0;font-size:13px;flex:0 0 auto;transition:transform .12s ease}
      #v8SubscriptionsCompactBox[open]>summary:before{transform:rotate(90deg)}
      .v8-compact-sub-main{min-width:0;flex:1}.v8-compact-sub-title{font-size:12px;font-weight:900}.v8-compact-sub-summary{font-size:10px;color:#9a9aa2;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .v8-compact-sub-count{font-size:10px;font-weight:800;color:#c0c0c8;white-space:nowrap;flex:0 0 auto}
      .v8-compact-sub-body{border-top:1px solid #292930;padding:10px 12px 12px}
      .v8-compact-sub-help{font-size:10px;color:#96969e;line-height:1.35;margin-bottom:9px}
      .v8-compact-sub-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
      .v8-compact-sub-choice{display:flex;align-items:flex-start;gap:8px;padding:8px 9px;border:1px solid #33343a;border-radius:10px;background:#151519;cursor:pointer;min-width:0}
      .v8-compact-sub-choice.is-active{border-color:#4d664f;background:#132017}
      .v8-compact-sub-choice input{width:auto!important;margin:2px 0 0;flex:0 0 auto}.v8-compact-sub-choice span{min-width:0}.v8-compact-sub-choice b{display:block;font-size:10.5px;line-height:1.25}.v8-compact-sub-choice small{display:block;color:#919199;font-size:9px;margin-top:2px}
      @media(max-width:680px){#v8SubscriptionsCompactBox{margin:8px 0}.v8-compact-sub-grid{grid-template-columns:1fr}#v8SubscriptionsCompactBox>summary{min-height:44px;padding:8px 10px}}
    `;
    document.head.appendChild(style);
  }

  function activeSummary(active){
    if(!active.length)return 'Aucun abonnement actif';
    const names=active.map(plan=>text(plan.provider).replace(/\s*[—-]\s*Abonnement$/i,'')).filter(Boolean);
    if(names.length<=2)return names.join(' · ');
    return `${names.slice(0,2).join(' · ')} · +${names.length-2}`;
  }
  function signature(){return `${plans.map(selectionId).join('|')}::${[...readSelected()].sort().join('|')}`}

  function updateSummary(box){
    const selected=readSelected();
    const active=plans.filter(plan=>selected.has(selectionId(plan)));
    const summary=box.querySelector('.v8-compact-sub-summary');if(summary)summary.textContent=activeSummary(active);
    const count=box.querySelector('.v8-compact-sub-count');if(count)count.textContent=active.length?`${active.length} actif${active.length>1?'s':''}`:'0 actif';
    box.querySelectorAll('[data-subscription-compact]').forEach(input=>{
      const on=selected.has(text(input.dataset.subscriptionCompact));
      input.checked=on;input.closest('.v8-compact-sub-choice')?.classList.toggle('is-active',on);
    });
  }

  function notifySelection(){
    try{window.TCCV8Subscriptions?.applyAll?.(true)}catch(e){}
    try{window.TCCV8Subscriptions?.selectionChanged?.()}catch(e){}
    document.dispatchEvent(new CustomEvent('tcc:subscriptions-changed'));
  }

  async function render(force=false){
    installStyle();
    const root=host();if(!root)return false;
    await loadPlans(force&&!hasExternalPlan(plans));
    if(!plans.length)return false;

    let box=$('v8SubscriptionsCompactBox');
    if(!box){
      box=document.createElement('details');box.id='v8SubscriptionsCompactBox';box.open=readOpen();
      box.addEventListener('toggle',()=>writeOpen(box.open));
    }
    place(box);

    const sig=signature();
    if(!force&&box.dataset.sig===sig){updateSummary(box);return true;}
    const selected=readSelected();
    const active=plans.filter(plan=>selected.has(selectionId(plan)));
    const ordered=[...plans].sort((a,b)=>Number(selected.has(selectionId(b)))-Number(selected.has(selectionId(a)))||text(a.provider).localeCompare(text(b.provider),'fr'));
    box.innerHTML=`<summary><div class="v8-compact-sub-main"><div class="v8-compact-sub-title">Mes abonnements</div><div class="v8-compact-sub-summary">${esc(activeSummary(active))}</div></div><div class="v8-compact-sub-count">${active.length?`${active.length} actif${active.length>1?'s':''}`:'0 actif'}</div></summary><div class="v8-compact-sub-body"><div class="v8-compact-sub-help">Coche uniquement les abonnements que tu possèdes. Leur coût fixe n'est jamais ajouté à une recharge.</div><div class="v8-compact-sub-grid">${ordered.map(plan=>{const id=selectionId(plan),on=selected.has(id);return `<label class="v8-compact-sub-choice${on?' is-active':''}"><input type="checkbox" data-subscription-compact="${esc(id)}" ${on?'checked':''}><span><b>${esc(plan.provider)}</b><small>${esc(planLabel(plan))}</small></span></label>`}).join('')}</div></div>`;
    box.querySelectorAll('[data-subscription-compact]').forEach(input=>input.addEventListener('change',()=>{
      const ids=readSelected(),id=text(input.dataset.subscriptionCompact);if(input.checked)ids.add(id);else ids.delete(id);writeSelected(ids);updateSummary(box);box.dataset.sig=signature();notifySelection();
    }));
    box.dataset.sig=sig;
    return true;
  }

  function scheduleRender(force=false,delay=120){clearTimeout(renderTimer);renderTimer=setTimeout(()=>render(force),delay)}
  function observeCompare(){
    if(observer)return true;
    const root=$('compare');if(!root)return false;
    observer=new MutationObserver(mutations=>{
      const relevant=mutations.some(m=>!m.target?.closest?.('#v8SubscriptionsCompactBox'));
      if(!relevant)return;
      const box=$('v8SubscriptionsCompactBox'),targetHost=host();
      if(!box||!targetHost||box.parentElement!==targetHost)scheduleRender(false,100);
    });
    observer.observe(root,{childList:true,subtree:true});return true;
  }

  function boot(){
    bootAttempts++;
    const needsCatalogue=!hasExternalPlan(plans);
    Promise.resolve(render(needsCatalogue)).finally(()=>{
      observeCompare();
      if((!$('v8SubscriptionsCompactBox')||!window.TCCV8Subscriptions||!hasExternalPlan(plans))&&bootAttempts<30)setTimeout(boot,200);
    });
  }

  document.addEventListener('tcc:subscription-plan-registered',()=>loadPlans(true).then(()=>render(true)));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();

  window.TCCV8CompareSubscriptions={revision:REVISION,render,loadPlans,selectedSet:readSelected,writeSelected,host,get plans(){return plans.slice()}};
  document.dispatchEvent(new CustomEvent('tcc:compare-subscriptions-ready'));
  console.info('[TCC V8] rc48bt : UI abonnements compacte alimentée par le catalogue complet.');
})();
