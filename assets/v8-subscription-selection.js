// Tesla Charge Companion V8 RC4.8 — sélection multi-abonnements.
// Les offres avec abonnement restent visibles mais ne participent au tri coût
// que si l'utilisateur a explicitement sélectionné le forfait correspondant.
(function(){
  'use strict';
  const VERSION='rc48-multi-subs-9-lbb-selector';
  const KEY='tccSubscriptionsV1';
  const OLD_ELECTRA_KEY='tccElectraPlusV1';
  const $=id=>document.getElementById(id);
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
  const BUILTIN_PLANS=[
    {id:'labornebleue-annual',selectionId:'labornebleue-annual',provider:'La Borne Bleue — Abonnement',offerType:'subscription',runtime:'existing_labornebleue_direct',monthlyFeeLabel:'10 €/an',defaultSelected:false,operatorAliases:['La Borne Bleue'],directOperatorOnly:true,source:'data-lab/labornebleue_official_idf.json'}
  ];
  let plans=BUILTIN_PLANS.map(p=>({...p}));let busy=false;let observer=null;

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(e){return fallback}}
  function state(){
    let s=readJson(KEY,null);
    if(!s){
      const old=readJson(OLD_ELECTRA_KEY,{})||{};
      s={selected:old.includeRanking?['electra-essential','electra-smart']:[]};
      localStorage.setItem(KEY,JSON.stringify(s));
    }
    return {selected:Array.isArray(s.selected)?s.selected:[]};
  }
  function selectedSet(){return new Set(state().selected)}
  function saveSelected(ids){localStorage.setItem(KEY,JSON.stringify({selected:[...ids],updatedAt:new Date().toISOString()}));}
  function subscriptionIdForProvider(value){
    const provider=norm(value);
    if(provider.includes('belib direct abonne non resident'))return'belib-nonresident';
    if(provider.includes('belib direct abonne resident'))return'belib-resident';
    if(provider.includes('la borne bleue direct abonne')||provider.includes('la borne bleue abonne'))return'labornebleue-annual';
    return'';
  }
  function isLabornebleueStation(st){
    return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name].map(norm).filter(Boolean).some(v=>v.includes('la borne bleue')||v==='labornebleue');
  }
  function isGenericSubscriberLabel(value){
    const p=norm(value);return p==='abonne'||p.startsWith('abonne ')||p.endsWith(' abonne');
  }
  function subscriptionIdForStation(st){
    const explicit=text(st?.subscriptionId||st?.subscriptionSelectionId);if(explicit)return explicit;
    const provider=text(st?.configurationLabel||st?.label||st?.offerProvider),mapped=subscriptionIdForProvider(provider);if(mapped)return mapped;
    if(isLabornebleueStation(st)&&isGenericSubscriberLabel(provider))return'labornebleue-annual';
    return'';
  }
  function isStationEligible(st,selected=selectedSet()){
    const id=subscriptionIdForStation(st);return !id||selected.has(id);
  }
  function selectionChanged(){
    applyAll(true);
    const root=$('results'),run=window.compare;
    if(typeof run!=='function'||!root?.querySelector('.result-card'))return;
    setTimeout(()=>{try{Promise.resolve(run()).then(()=>setTimeout(()=>applyAll(true),80)).catch(err=>console.warn('[TCC V8] Reclassement abonnements impossible :',err?.message||err))}catch(err){console.warn('[TCC V8] Reclassement abonnements impossible :',err?.message||err)}},0);
  }
  function forceLegacyElectraOff(){const old=readJson(OLD_ELECTRA_KEY,{})||{};if(old.includeRanking){old.includeRanking=false;localStorage.setItem(OLD_ELECTRA_KEY,JSON.stringify(old));}const box=$('v8ElectraBox');if(box)box.style.display='none';}
  function selectionId(p){return text(p?.selectionId||p?.id)}
  function upsertPlan(plan){
    const id=selectionId(plan);if(!id)return false;
    const index=plans.findIndex(p=>selectionId(p)===id);
    if(index>=0)plans[index]={...plans[index],...plan};else plans.push({...plan});
    return true;
  }
  function seedBuiltinPlans(){for(const p of BUILTIN_PLANS)upsertPlan(p);}

  async function loadPlans(){
    let overlay=window.TCC_TARIFF_OVERLAY_V1||null;
    if(!overlay){try{overlay=await window.TCCV8OperatorOverlay?.loadOverlay?.()||null}catch(e){}}
    if(!overlay&&typeof fetch==='function'){
      try{const r=await fetch(`data/tariff_overlay_v1.json?v=${VERSION}`,{cache:'no-store'});if(r.ok)overlay=await r.json()}catch(e){}
    }
    plans=Array.isArray(overlay?.subscriptions)?overlay.subscriptions.slice():[];
    seedBuiltinPlans();
    return plans;
  }
  function registerPlan(plan){
    if(!upsertPlan(plan))return false;
    try{injectControls()}catch(e){}
    setTimeout(()=>{try{window.TCCV8DirectResolver?.renderSubscriptionDropdown?.(true)}catch(e){}},0);
    try{applyAll(true)}catch(e){}
    return true;
  }
  function controlPlans(){
    const byId=new Map();
    for(const p of plans){
      const id=selectionId(p);if(!id)continue;
      if(!byId.has(id)||byId.get(id).control===false)byId.set(id,p);
    }
    return [...byId.values()].filter(p=>p.control!==false);
  }
  function planLabel(p){
    if(Number.isFinite(Number(p.monthlyFeeEur)))return `${Number(p.monthlyFeeEur).toFixed(2).replace('.',',')} €/mois`;
    return p.monthlyFeeLabel||'abonnement';
  }
  function injectStyle(){
    if($('v8SubscriptionStyle'))return;
    const s=document.createElement('style');s.id='v8SubscriptionStyle';s.textContent=`
      .v8-subscriptions-box{margin-top:12px;border:1px solid #303038;border-radius:14px;background:#0f0f13;overflow:hidden}
      .v8-subscriptions-box>summary{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px;cursor:pointer;font-size:12px;font-weight:900;list-style:none}
      .v8-subscriptions-box>summary::-webkit-details-marker{display:none}.v8-subscriptions-box>summary:after{content:'▾';color:#a9a9b0;font-size:14px}.v8-subscriptions-box[open]>summary:after{content:'▴'}
      .v8-subscriptions-count{color:#9a9aa2;font-size:10px;font-weight:700;margin-left:auto}
      .v8-subscriptions-body{padding:0 12px 12px;border-top:1px solid #292930}
      .v8-subscriptions-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px}
      .v8-subscription-choice{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border:1px solid #33333a;border-radius:11px;font-size:11px}
      .v8-subscription-choice input{width:auto!important;margin-top:2px}.v8-subscription-choice b{display:block}.v8-subscription-choice span{display:block;color:#8f8f96;font-size:9px;margin-top:2px}
      .v8-offer-row.v8-sub-inactive{opacity:.62;border-style:dashed}.v8-offer-row.v8-sub-active{border-color:#765d1f;background:rgba(126,95,21,.10)}
      .v8-sub-status{display:inline-block;margin-left:6px;font-size:9px;font-weight:900}.v8-sub-status.active{color:#55d984}.v8-sub-status.inactive{color:#d4a94c}
      .v8-ranking-offer-note{margin-top:8px;padding:8px 10px;border-radius:10px;background:#121820;border:1px solid #2b3948;font-size:10px;color:#bfc9d5}
      @media(max-width:680px){.v8-subscriptions-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }
  function injectControls(){
    const host=$('v8FilterBody'),controls=controlPlans();if(!host||!controls.length)return false;
    forceLegacyElectraOff();injectStyle();
    let box=$('v8SubscriptionsBox');
    if(!box){box=document.createElement('details');box.id='v8SubscriptionsBox';box.className='v8-subscriptions-box';host.appendChild(box);}
    const selected=selectedSet(),countLabel=selected.size?`${selected.size} sélectionné${selected.size>1?'s':''}`:'Aucun sélectionné';
    box.innerHTML=`<summary><span>Mes abonnements</span><span class="v8-subscriptions-count">${countLabel}</span></summary><div class="v8-subscriptions-body"><div style="font-size:12px;font-weight:800;margin-top:10px">Inclure dans le classement</div><div class="small" style="margin-top:5px">Les tarifs abonnés restent toujours affichés. Ils ne peuvent devenir le tarif retenu que si le forfait est coché. Le coût de l'abonnement n'est jamais imputé à une recharge.</div><div class="v8-subscriptions-grid">${controls.map(p=>{const id=selectionId(p);return `<label class="v8-subscription-choice"><input type="checkbox" data-subscription-choice="${id}" ${selected.has(id)?'checked':''}><span><b>${p.provider}</b><span>${planLabel(p)}</span></span></label>`}).join('')}</div></div>`;
    box.querySelectorAll('[data-subscription-choice]').forEach(input=>input.addEventListener('change',()=>{
      const ids=new Set([...box.querySelectorAll('[data-subscription-choice]:checked')].map(x=>x.dataset.subscriptionChoice));
      const label=box.querySelector('.v8-subscriptions-count');if(label)label.textContent=ids.size?`${ids.size} sélectionné${ids.size>1?'s':''}`:'Aucun sélectionné';
      saveSelected(ids);selectionChanged();
    }));
    return true;
  }

  function cleanProvider(row){
    if(row.dataset.tccProvider)return row.dataset.tccProvider;
    const el=row.querySelector('.v8-offer-provider');if(!el)return'';
    const clone=el.cloneNode(true);clone.querySelectorAll('.v8-offer-best,.v8-sub-status,.v8-electra-tag,.v8-electra-saving,.v8-electra-planfee').forEach(x=>x.remove());
    const p=text(clone.textContent).replace(/\s+abonnement$/i,'').trim();row.dataset.tccProvider=p;return p;
  }
  function numberFrom(v){const m=text(v).replace(/\u00a0/g,' ').match(/-?\d[\d\s]*(?:[.,]\d+)?/);return m?Number(m[0].replace(/\s/g,'').replace(',','.')):NaN}
  function rowTotal(row){return numberFrom(row.querySelector('.v8-offer-total')?.textContent)}
  function wallKwh(card){const m=text(card.textContent).match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);return m?Number(m[1].replace(',','.')):NaN}
  function physicalOperator(card){return text(card.querySelector('.operator-badge')?.textContent)}
  function operatorMatches(card,p){const op=norm(physicalOperator(card));return (p.operatorAliases||[]).some(a=>op===norm(a))}
  function kindPower(card){const h=text(card.querySelector('h3')?.textContent);const m=h.match(/\b(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);return{kind:m?.[1]?.toUpperCase()||'',power:m?Number(m[2].replace(',','.')):0}}
  function requiredDirectOfferPresent(card,p){
    if(p?.directOperatorOnly)return operatorMatches(card,p);
    if(!p?.requiredDirectProvider)return true;
    const required=norm(p.requiredDirectProvider);
    if(!required)return false;
    return [...card.querySelectorAll('.v8-offer-row:not([data-subscription-offer-id])')].some(row=>norm(cleanProvider(row))===required);
  }
  function planApplies(card,p){const kp=kindPower(card);if(p.kind&&kp.kind!==text(p.kind).toUpperCase())return false;if(Number.isFinite(Number(p.minPowerKw))&&kp.power<Number(p.minPowerKw))return false;if(Number.isFinite(Number(p.maxPowerKw))&&kp.power>Number(p.maxPowerKw))return false;if(!operatorMatches(card,p))return false;return requiredDirectOfferPresent(card,p)}
  function hmToMinutes(v){const m=text(v).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):NaN}
  function chargeMinutes(card){
    const t=text(card.textContent).replace(/\s+/g,' ');
    const m=t.match(/Recharge\s+(?:(\d+)\s*h(?:\s*(\d{1,2}))?|(\d+)\s*min)/i);
    if(!m)return NaN;
    if(m[1]!=null)return Number(m[1])*60+Number(m[2]||0);
    return Number(m[3]||0);
  }
  function occupiedMinutes(card){
    const start=hmToMinutes($('simTime')?.value),unplug=hmToMinutes($('simUnplugTime')?.value);
    if(Number.isFinite(start)&&Number.isFinite(unplug)){
      let d=unplug-start;if(d<0)d+=1440;return d;
    }
    return chargeMinutes(card);
  }
  function generatedPlanTotal(card,p,kwh){
    let total=kwh*Number(p.pricePerKwh)+Number(p.sessionFeeEur||0);
    const rate=Number(p.afterMinutesRate||0),threshold=Number(p.afterMinutesThreshold||0),occ=occupiedMinutes(card);
    if(rate>0&&threshold>=0&&Number.isFinite(occ)){
      let surcharge=Math.max(0,occ-threshold)*rate;
      const cap=Number(p.afterMinutesCap||0);if(cap>0)surcharge=Math.min(surcharge,cap);
      total+=surcharge;
    }
    return total;
  }
  function generatedPlanPriceLabel(p){
    const c=p.currency||'EUR',parts=[`${Number(p.pricePerKwh).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/kWh`];
    if(Number(p.sessionFeeEur||0)>0)parts.push(`${Number(p.sessionFeeEur).toFixed(2).replace('.',',')} ${c} fixe`);
    if(Number(p.afterMinutesRate||0)>0)parts.push(`${Number(p.afterMinutesRate).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min après ${Math.round(Number(p.afterMinutesThreshold||0))} min`);
    return parts.join(' + ');
  }
  function ensureGeneratedRows(card,box){
    const kwh=wallKwh(card);if(!Number.isFinite(kwh))return;
    const note=box.querySelector('.v8-offer-note');
    for(const p of plans){
      if(p.runtime==='existing_electra_plus'||p.runtime==='existing_labornebleue_direct'||!Number.isFinite(Number(p.pricePerKwh))||!planApplies(card,p))continue;
      const offerId=text(p.id),sid=selectionId(p);if(!offerId||!sid)continue;
      if(box.querySelector(`[data-subscription-offer-id="${offerId}"]`))continue;
      const total=generatedPlanTotal(card,p,kwh),row=document.createElement('div');
      row.className='v8-offer-row';row.dataset.subscriptionId=sid;row.dataset.subscriptionOfferId=offerId;row.dataset.tccProvider=p.provider;
      row.innerHTML=`<div class="v8-offer-provider">${p.provider}<span class="v8-electra-tag">abonnement</span><span class="v8-electra-planfee">${planLabel(p)}</span></div><div class="v8-offer-price">${generatedPlanPriceLabel(p)}</div><div class="v8-offer-total">${euro(total)}</div>`;
      note?.before(row);
    }
  }
  function mapExistingSubscriptions(card,box){
    box.querySelectorAll('.v8-electra-plus-row').forEach(row=>{
      const plan=text(row.dataset.plan).toLowerCase();row.dataset.subscriptionId=plan==='smart'?'electra-smart':'electra-essential';
      cleanProvider(row);
    });
    box.querySelectorAll('.v8-offer-row').forEach(row=>{
      const provider=cleanProvider(row),id=subscriptionIdForProvider(provider);
      if(id)row.dataset.subscriptionId=id;
      else if(norm(physicalOperator(card)).includes('la borne bleue')&&isGenericSubscriberLabel(provider))row.dataset.subscriptionId='labornebleue-annual';
    });
  }
  function clearBest(rows){rows.forEach(row=>{row.classList.remove('best');row.querySelectorAll('.v8-offer-best').forEach(x=>x.remove())})}
  function setStatus(row,active){
    row.classList.toggle('v8-sub-active',active);row.classList.toggle('v8-sub-inactive',!active);
    const el=row.querySelector('.v8-offer-provider');if(!el)return;el.querySelectorAll('.v8-sub-status').forEach(x=>x.remove());
    const s=document.createElement('span');s.className=`v8-sub-status ${active?'active':'inactive'}`;s.textContent=active?'✓ inclus':'hors classement';el.appendChild(s);
  }
  function markBest(row,tie){const p=row.querySelector('.v8-offer-provider');row.classList.add('best');if(p&&!p.querySelector('.v8-offer-best'))p.insertAdjacentHTML('beforeend',`<span class="v8-offer-best">${tie?'✓ meilleur ex æquo':'✓ moins cher'}</span>`)}

  function applyCard(card,force=false){
    const box=card.querySelector('.v8-offer-box');if(!box)return;
    ensureGeneratedRows(card,box);mapExistingSubscriptions(card,box);
    const selected=selectedSet(),rows=[...box.querySelectorAll('.v8-offer-row')];
    const sig=`${[...selected].sort().join(',')}|${rows.map(r=>`${r.dataset.subscriptionId||'-'}:${cleanProvider(r)}:${rowTotal(r)}`).join('|')}`;
    if(!force&&card.dataset.tccSubsSig===sig)return;
    clearBest(rows);
    for(const row of rows){const id=row.dataset.subscriptionId;if(id)setStatus(row,selected.has(id));else{row.classList.remove('v8-sub-active','v8-sub-inactive');row.querySelectorAll('.v8-sub-status').forEach(x=>x.remove())}}
    const eligible=rows.filter(r=>!r.classList.contains('v8-offer-ambiguous')&&(!r.dataset.subscriptionId||selected.has(r.dataset.subscriptionId))&&Number.isFinite(rowTotal(r)));
    const min=eligible.length?Math.min(...eligible.map(rowTotal)):NaN,ties=eligible.filter(r=>Math.abs(rowTotal(r)-min)<.01);
    ties.forEach(r=>markBest(r,ties.length>1));
    const winner=eligible.slice().sort((a,b)=>rowTotal(a)-rowTotal(b))[0],cost=card.querySelector('.station-head .cost')||card.querySelector('.cost');
    if(winner&&Number.isFinite(min)){
      if(cost)cost.textContent=euro(min);card.dataset.tccEffectiveCost=String(min);
      let note=card.querySelector('.v8-ranking-offer-note');if(!note){note=document.createElement('div');note.className='v8-ranking-offer-note';box.insertAdjacentElement('afterend',note);}
      const sub=winner.dataset.subscriptionId?` · abonnement sélectionné`:'';note.innerHTML=`Tarif retenu pour le classement : <b>${cleanProvider(winner)}</b>${sub}`;
    }
    card.dataset.tccSubsSig=sig;
  }
  function sortCost(){
    const mode=$('simRanking')?.value;if(mode!=='cost'&&mode!=='costPerKm')return;
    const root=$('results');if(!root)return;const cards=[...root.querySelectorAll('.result-card[data-result-id]')];
    const score=card=>{const cost=Number(card.dataset.tccEffectiveCost||Infinity);if(mode==='cost')return cost;const km=Number(card.dataset.recoveredKm||0);return Number.isFinite(cost)&&km>0?cost/km*100:Infinity;};
    cards.sort((a,b)=>score(a)-score(b)).forEach(c=>root.appendChild(c));
    cards.forEach((c,i)=>{const h=c.querySelector('h3');if(h)h.textContent=text(h.textContent).replace(/^\d+\.\s*/,`${i+1}. `)});
  }
  function applyAll(force=false){if(busy)return;busy=true;try{document.querySelectorAll('#results .result-card[data-result-id]').forEach(c=>applyCard(c,force));sortCost();}finally{busy=false}}

  function installObserver(){
    const root=$('results');if(!root||observer)return false;
    let timer=null;const obs=new MutationObserver(()=>{if(busy)return;clearTimeout(timer);timer=setTimeout(()=>applyAll(false),700)});obs.observe(root,{childList:true,subtree:true,characterData:true});observer=obs;
    $('simRanking')?.addEventListener('change',()=>setTimeout(()=>applyAll(true),50));return true;
  }
  async function boot(){
    await loadPlans();forceLegacyElectraOff();let tries=0;const timer=setInterval(()=>{tries++;const a=injectControls(),b=installObserver();forceLegacyElectraOff();if((a&&b)||tries>160){clearInterval(timer);setTimeout(()=>applyAll(true),900)}},100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.TCCV8Subscriptions={state,applyAll,selectionChanged,selectedSet,subscriptionIdForProvider,subscriptionIdForStation,isStationEligible,planApplies,generatedPlanTotal,registerPlan,loadPlans,get plans(){return plans.slice()}};
  console.info('[TCC V8] Sélection multi-abonnements active : liste native rechargée, classement opt-in strict et La Borne Bleue robuste.');
})();