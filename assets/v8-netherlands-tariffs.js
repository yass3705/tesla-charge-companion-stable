// Tesla Charge Companion V8 — overlays opérateurs/abonnements Pays-Bas.
// DOT-NL reste le fallback national; cette couche ajoute uniquement les tarifs
// officiels opérateur applicables aux stations physiquement exploitées par le réseau.
(function(root){
  'use strict';
  const VERSION='nl-tariffs-20260829-1';
  const DATA_URL='data/netherlands_direct_tariffs_v1.json';
  let dataPromise=null,observer=null,applyTimer=null,registerTimer=null,busy=false;

  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
  const esc=v=>(root.escapeHtml?root.escapeHtml(text(v)):text(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));

  async function loadData(){
    if(!dataPromise)dataPromise=fetch(`${DATA_URL}?v=${VERSION}`,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`tarifs directs Pays-Bas indisponibles (${r.status})`);return r.json();
    }).then(data=>{
      if(Number(data?.schemaVersion)!==1||String(data?.country||'').toUpperCase()!=='NL')throw new Error('overlay tarifs Pays-Bas invalide');
      if(!Array.isArray(data.directOffers)||!Array.isArray(data.subscriptionOffers))throw new Error('offres Pays-Bas absentes');
      root.TCC_NETHERLANDS_DIRECT_TARIFFS_V1=data;return data;
    }).catch(err=>{dataPromise=null;console.warn('[TCC V8] Tarifs Pays-Bas non chargés:',err?.message||err);return null;});
    return dataPromise;
  }

  function isNetherlandsCard(card){return text(card?.dataset?.resultId).startsWith('netherlands-catalog:');}
  function cardContext(card){
    const operator=text(card?.querySelector('.operator-badge')?.textContent);
    const title=text(card?.querySelector('h3')?.textContent);
    const m=title.match(/\b(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return {operator,title,kind:m?.[1]?.toUpperCase()||'',power:m?Number(m[2].replace(',','.')):0};
  }
  function operatorMatches(ctx,offer){
    const op=norm(ctx?.operator);if(!op)return false;
    return (offer?.operatorAliases||[]).map(norm).filter(Boolean).some(alias=>op===alias||op.startsWith(alias+' ')||alias.startsWith(op+' '));
  }
  function offerMatches(ctx,offer){
    if(!operatorMatches(ctx,offer))return false;
    if(offer?.kind&&text(offer.kind).toUpperCase()!==text(ctx?.kind).toUpperCase())return false;
    const p=Number(ctx?.power||0),min=Number(offer?.minPowerKw),max=Number(offer?.maxPowerKw);
    if(Number.isFinite(min)&&p<min-1e-9)return false;
    if(Number.isFinite(max)&&p>max+1e-9)return false;
    return Number.isFinite(Number(offer?.pricePerKwh));
  }
  function wallKwh(card){const m=text(card?.textContent).replace(/\s+/g,' ').match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);return m?Number(m[1].replace(',','.')):NaN;}
  function priceLabel(offer){const p=Number(offer.pricePerKwh);return `${p.toFixed(2).replace('.',',')} ${offer.currency||'EUR'}/kWh`;}
  function rowTotal(kwh,offer){return Math.max(0,Number(kwh||0))*Math.max(0,Number(offer.pricePerKwh||0));}
  function insertBeforeNote(box,row){const note=box.querySelector('.v8-offer-note');if(note)note.before(row);else box.appendChild(row);}
  function setRowContent(row,offer,kwh,{subscription=false}={}){
    const total=rowTotal(kwh,offer),planFee=subscription?(offer.monthlyFeeLabel||Number.isFinite(Number(offer.monthlyFeeEur))?`${Number(offer.monthlyFeeEur).toFixed(2).replace('.',',')} €/mois`:''):'';
    row.dataset.tccProvider=offer.provider;
    if(subscription){row.dataset.subscriptionId=offer.selectionId||offer.id;row.dataset.subscriptionOfferId=offer.id;}
    row.innerHTML=`<div class="v8-offer-provider">${esc(offer.provider)}${subscription?'<span class="v8-electra-tag">abonnement</span>':''}${planFee?`<span class="v8-electra-planfee">${esc(planFee)}</span>`:''}</div><div class="v8-offer-price">${esc(priceLabel(offer))}</div><div class="v8-offer-total">${euro(total)}</div>`;
    return total;
  }

  function ensureDirectRows(card,box,data,kwh){
    let changed=false;const ctx=cardContext(card);
    for(const offer of data.directOffers||[]){
      if(!offerMatches(ctx,offer))continue;
      let row=box.querySelector(`[data-netherlands-direct-offer-id="${CSS.escape(offer.id)}"]`);
      if(!row){row=document.createElement('div');row.className='v8-offer-row v8-nl-direct-row';row.dataset.netherlandsDirectOfferId=offer.id;insertBeforeNote(box,row);changed=true;}
      const expected=`${offer.provider}|${priceLabel(offer)}|${euro(rowTotal(kwh,offer))}`;
      if(row.dataset.nlSignature!==expected){setRowContent(row,offer,kwh);row.dataset.nlSignature=expected;changed=true;}
    }
    return changed;
  }
  function ensureSubscriptionRows(card,box,data,kwh){
    let changed=false;const ctx=cardContext(card);
    for(const offer of data.subscriptionOffers||[]){
      if(!offerMatches(ctx,offer))continue;
      let row=box.querySelector(`[data-subscription-offer-id="${CSS.escape(offer.id)}"]`);
      if(!row&&offer.selectionId==='fastned-gold')row=box.querySelector('[data-subscription-offer-id="fastned-gold"]');
      if(!row){row=document.createElement('div');row.className='v8-offer-row v8-nl-subscription-row';row.dataset.subscriptionOfferId=offer.id;insertBeforeNote(box,row);changed=true;}
      row.classList.add('v8-nl-subscription-row');
      const expected=`${offer.provider}|${priceLabel(offer)}|${euro(rowTotal(kwh,offer))}|${offer.selectionId||offer.id}`;
      if(row.dataset.nlSignature!==expected){setRowContent(row,offer,kwh,{subscription:true});row.dataset.nlSignature=expected;changed=true;}
    }
    return changed;
  }
  function pruneWrongIonityReferences(card){
    let changed=false;
    card.querySelectorAll('.v8-reference-row[data-reference-offer-id="ionity-direct"],.v8-reference-row[data-reference-offer-id="ionity-app"],.v8-reference-row[data-reference-offer-id="ionity-motion"],.v8-reference-row[data-reference-offer-id="ionity-power"]').forEach(row=>{row.remove();changed=true;});
    return changed;
  }
  function applyCard(card,data){
    if(!isNetherlandsCard(card))return false;const box=card.querySelector('.v8-offer-box'),kwh=wallKwh(card);if(!box||!Number.isFinite(kwh))return false;
    let changed=false;changed=ensureDirectRows(card,box,data,kwh)||changed;changed=ensureSubscriptionRows(card,box,data,kwh)||changed;changed=pruneWrongIonityReferences(card)||changed;
    if(changed)card.dataset.tccNlTariffs=VERSION;return changed;
  }
  async function applyAll(){
    if(busy)return false;const data=root.TCC_NETHERLANDS_DIRECT_TARIFFS_V1||await loadData();if(!data)return false;
    busy=true;let changed=false;try{document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{changed=applyCard(card,data)||changed;});}finally{busy=false;}
    if(changed&&root.TCCV8Subscriptions?.applyAll)setTimeout(()=>{try{root.TCCV8Subscriptions.applyAll(true);}catch(e){}},0);
    if(changed&&root.TCCV8ReferenceOffers?.apply)setTimeout(()=>{try{root.TCCV8ReferenceOffers.apply();}catch(e){}setTimeout(()=>{document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{if(isNetherlandsCard(card))pruneWrongIonityReferences(card);});},40);},0);
    return changed;
  }

  function registerSubscriptionControls(data){
    const api=root.TCCV8Subscriptions;if(!api?.registerPlan)return false;
    const existing=new Set((api.plans||[]).map(p=>text(p.selectionId||p.id)));
    const controls=[
      {id:'ionity-motion-control',selectionId:'ionity-motion',provider:'IONITY Motion',offerType:'subscription',monthlyFeeEur:5.99,defaultSelected:false,source:'https://www.ionity.eu/nl/abonnementen'},
      {id:'ionity-power-control',selectionId:'ionity-power',provider:'IONITY Power',offerType:'subscription',monthlyFeeEur:11.99,defaultSelected:false,source:'https://www.ionity.eu/nl/abonnementen'}
    ];
    for(const plan of controls)if(!existing.has(plan.selectionId))api.registerPlan(plan);
    const fastned=(data?.subscriptionOffers||[]).find(x=>x.selectionId==='fastned-gold');
    if(fastned&&!existing.has('fastned-gold'))api.registerPlan({id:'fastned-gold-control',selectionId:'fastned-gold',provider:'Fastned Gold',offerType:'subscription',monthlyFeeEur:fastned.monthlyFeeEur,monthlyFeeLabel:fastned.monthlyFeeLabel,defaultSelected:false,source:fastned.source});
    return true;
  }
  async function ensureRegistered(){const data=root.TCC_NETHERLANDS_DIRECT_TARIFFS_V1||await loadData();return data?registerSubscriptionControls(data):false;}
  function installObserver(){
    const results=document.getElementById('results');if(!results)return false;if(observer)return true;
    observer=new MutationObserver(()=>{if(busy)return;clearTimeout(applyTimer);applyTimer=setTimeout(()=>applyAll().catch(()=>{}),120);});
    observer.observe(results,{childList:true,subtree:true,characterData:true});setTimeout(()=>applyAll().catch(()=>{}),150);return true;
  }
  function boot(){
    loadData().then(data=>{if(data)registerSubscriptionControls(data);}).catch(()=>{});
    let tries=0;registerTimer=setInterval(()=>{tries++;const a=installObserver();ensureRegistered().catch(()=>{});if(a&&root.TCCV8Subscriptions?.registerPlan||tries>180){if(a&&root.TCCV8Subscriptions?.registerPlan){clearInterval(registerTimer);registerTimer=null;setTimeout(()=>applyAll().catch(()=>{}),250);}}},100);
  }

  const api={version:VERSION,loadData,isNetherlandsCard,cardContext,operatorMatches,offerMatches,rowTotal,applyCard,applyAll,registerSubscriptionControls};
  root.TCCNetherlandsTariffs=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();}
  console.info('[TCC V8] Tarifs directs et abonnements Pays-Bas prêts (Fastned, IONITY, Lidl).');
})(typeof window!=='undefined'?window:globalThis);
