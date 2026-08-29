(function(){
  'use strict';
  const STORAGE_KEY='tccSubscriptionsV1';
  const META_URL='data/v9/subscription-entitlements-global.json';
  const COUNTRY_LABELS={FR:'France',ES:'Espagne',IT:'Italie',NL:'Pays-Bas',DE:'Allemagne',BE:'Belgique',CH:'Suisse',GB:'Royaume-Uni',DK:'Danemark',PT:'Portugal'};
  const COUNTRY_FLAGS={FR:'🇫🇷',ES:'🇪🇸',IT:'🇮🇹',NL:'🇳🇱',DE:'🇩🇪',BE:'🇧🇪',CH:'🇨🇭',GB:'🇬🇧',DK:'🇩🇰',PT:'🇵🇹'};

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function loadSelected(){try{return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'));}catch(_){return new Set();}}
  function saveSelected(set){localStorage.setItem(STORAGE_KEY,JSON.stringify([...set].sort()));window.dispatchEvent(new CustomEvent('tcc:subscriptions-changed',{detail:{subscriptionIds:[...set]}}));}
  function countries(plan){return [...new Set((plan.entitlements||[]).map(e=>e.country).filter(Boolean))].sort();}
  function networks(plan){return [...new Set((plan.entitlements||[]).flatMap(e=>e.networkAliases||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));}
  function fee(plan){const f=plan.fee||{};if(f.monthly!=null)return `${Number(f.monthly).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:2})} ${f.currency||'EUR'}/mois`;if(f.dependsOnResidenceCountry)return 'Frais selon pays de résidence';return '';}
  function countryBadges(plan){const cs=countries(plan);if(cs.length>=5)return '<span class="v9-sub-badge">Europe</span>';return cs.map(c=>`<span class="v9-sub-badge" title="${esc(COUNTRY_LABELS[c]||c)}">${COUNTRY_FLAGS[c]||''} ${esc(c)}</span>`).join('');}
  function networkText(plan){const ns=networks(plan);if(!ns.length)return '';const own=String(plan.provider||'').toLowerCase();const partners=ns.filter(n=>!String(n).toLowerCase().includes(own)&&!own.includes(String(n).toLowerCase()));return partners.length?`+ ${partners.slice(0,4).join(' · ')}${partners.length>4?' …':''}`:ns.join(' · ');}
  function searchText(plan){return [plan.id,plan.provider,plan.label,...countries(plan).map(c=>COUNTRY_LABELS[c]||c),...networks(plan)].join(' ').toLowerCase();}

  async function getPlans(){
    if(Array.isArray(window.TCC_V9_SUBSCRIPTIONS))return window.TCC_V9_SUBSCRIPTIONS;
    const r=await fetch(META_URL,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=await r.json();return Array.isArray(j.plans)?j.plans:[];
  }

  function render(root,plans){
    const selected=loadSelected();
    const providers=[...new Set(plans.map(p=>p.provider||'Autre'))].sort((a,b)=>a.localeCompare(b,'fr'));
    root.innerHTML=`<details class="v9-subscriptions" open>
      <summary><span>Mes abonnements</span><span class="v9-sub-count">${selected.size} actif${selected.size>1?'s':''}</span></summary>
      <div class="v9-sub-body">
        <div class="v9-sub-help">Un abonnement est sélectionné une seule fois. TCC applique automatiquement ses avantages selon le pays et le réseau de la borne.</div>
        <input class="v9-sub-search" type="search" placeholder="Rechercher un abonnement ou un opérateur" aria-label="Rechercher un abonnement ou un opérateur">
        <div class="v9-sub-filters" role="group" aria-label="Filtres abonnements">
          <button type="button" data-filter="all" class="active">Tous</button>
          <button type="button" data-filter="active">Actifs</button>
          <button type="button" data-filter="FR">France</button>
          <button type="button" data-filter="ES">Espagne</button>
          <button type="button" data-filter="multi">Multi-pays</button>
        </div>
        <div class="v9-sub-list"></div>
      </div>
    </details>`;
    const list=root.querySelector('.v9-sub-list');const search=root.querySelector('.v9-sub-search');const filters=[...root.querySelectorAll('.v9-sub-filters button')];let mode='all';
    function draw(){
      const q=(search.value||'').trim().toLowerCase();
      let visible=plans.filter(p=>{
        if(q&&!searchText(p).includes(q))return false;
        const cs=countries(p);if(mode==='active'&&!selected.has(p.id))return false;if(mode==='FR'&&!cs.includes('FR'))return false;if(mode==='ES'&&!cs.includes('ES'))return false;if(mode==='multi'&&cs.length<2)return false;return true;
      });
      visible.sort((a,b)=>(selected.has(b.id)-selected.has(a.id))||String(a.provider||'').localeCompare(String(b.provider||''),'fr')||String(a.label||a.id).localeCompare(String(b.label||b.id),'fr'));
      const groups=new Map();visible.forEach(p=>{const k=p.provider||'Autre';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);});
      list.innerHTML=[...groups.entries()].map(([provider,items])=>`<section class="v9-sub-group"><h4>${esc(provider)}</h4>${items.map(p=>{
        const checked=selected.has(p.id);const partners=networkText(p);return `<label class="v9-sub-row${checked?' selected':''}" data-search="${esc(searchText(p))}">
          <input type="checkbox" class="v9-sub-choice" value="${esc(p.id)}" ${checked?'checked':''}>
          <span class="v9-sub-main"><span class="v9-sub-title">${esc(p.label||p.id)}</span><span class="v9-sub-meta">${countryBadges(p)}${fee(p)?`<span class="v9-sub-fee">${esc(fee(p))}</span>`:''}</span>${partners?`<span class="v9-sub-partners">${esc(partners)}</span>`:''}</span>
        </label>`;
      }).join('')}</section>`).join('')||'<div class="v9-sub-empty">Aucun abonnement ne correspond à ce filtre.</div>';
      root.querySelector('.v9-sub-count').textContent=`${selected.size} actif${selected.size>1?'s':''}`;
      root.querySelectorAll('.v9-sub-choice').forEach(cb=>cb.addEventListener('change',()=>{cb.checked?selected.add(cb.value):selected.delete(cb.value);saveSelected(selected);draw();}));
    }
    search.addEventListener('input',draw);filters.forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.filter;filters.forEach(x=>x.classList.toggle('active',x===b));draw();}));draw();
  }

  async function init(){const root=document.querySelector('#v9SubscriptionsBox,#v8SubscriptionsBox,[data-tcc-subscriptions]');if(!root)return;try{render(root,await getPlans());}catch(err){root.innerHTML='<div class="small warn">Impossible de charger le référentiel des abonnements.</div>';console.warn('[TCC V9 subscriptions]',err);}}
  window.TCCV9Subscriptions={init,loadSelected,saveSelected};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
