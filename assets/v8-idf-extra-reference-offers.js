// Tesla Charge Companion V8 RC4.8 — références IDF supplémentaires validées, non classables.
(function(){
  'use strict';
  const VERSION='rc48aq-idf-extra-1';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const esc=v=>(window.escapeHtml?window.escapeHtml(String(v??'')):String(v??''));

  const refs=[
    {
      id:'volti-direct-up-to-22',
      aliases:['VOLTi','Volti','VOLTI'],
      provider:'VOLTi direct',
      maxPowerKw:22,
      label:'non-abonné 0,40 €/kWh · abonné 0,35 €/kWh · 7h–22h : 0,25 €/min après 3 h · 22h–7h : 0 €/min',
      note:'Grille officielle SDEVO/VOLTi. Accès via badge/app VOLTi, QR web anonyme et carte bancaire sur les bornes équipées. L’itinérance tierce peut appliquer un autre tarif.'
    },
    {
      id:'volti-direct-over-22',
      aliases:['VOLTi','Volti','VOLTI'],
      provider:'VOLTi direct',
      minPowerKw:22.01,
      label:'non-abonné 0,80 €/kWh · abonné 0,70 €/kWh · 0,25 €/min après 60 min',
      note:'Grille officielle SDEVO/VOLTi. Accès via badge/app VOLTi, QR web anonyme et carte bancaire sur les bornes équipées. L’itinérance tierce peut appliquer un autre tarif.'
    },
    {
      id:'sieely-direct-up-to-7-4',
      aliases:['SIE-ELY','SIEELY','SIEELY BORNE','SIE ELY'],
      provider:'SIE-ELY direct',
      maxPowerKw:7.4,
      label:'1 € de connexion + 0,30 €/kWh · 8h–20h : 0,50 €/h · 20h–8h : 0 €/h',
      note:'Tarif direct officiel du réseau SIE-ELY. Badge SIEELY, compte Alizé ou QR ; les badges d’itinérance partenaires peuvent appliquer un tarif différent.'
    },
    {
      id:'sieely-direct-22',
      aliases:['SIE-ELY','SIEELY','SIEELY BORNE','SIE ELY'],
      provider:'SIE-ELY direct',
      minPowerKw:7.41,
      maxPowerKw:22,
      label:'1 € de connexion + 0,30 €/kWh · 8h–20h : 1 €/h pendant 2 h puis 4 €/h · 20h–8h : 0,30 €/h',
      note:'Tarif direct officiel du réseau SIE-ELY. Badge SIEELY, compte Alizé ou QR ; les badges d’itinérance partenaires peuvent appliquer un tarif différent.'
    }
  ];

  function cardContext(card){
    const op=text(card.querySelector('.operator-badge')?.textContent);
    const h=text(card.querySelector('h3')?.textContent);
    const m=h.match(/\b(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return {operator:op,title:h,kind:m?.[1]?.toUpperCase()||'',power:m?Number(m[2].replace(',','.')):0};
  }
  function matches(ctx,r){
    const values=[norm(ctx.operator),norm(ctx.title)].filter(Boolean);
    const aliases=(r.aliases||[]).map(norm).filter(Boolean);
    if(!aliases.some(a=>values.some(v=>v===a||v.includes(a)||a.includes(v))))return false;
    if(Number.isFinite(Number(r.minPowerKw))&&ctx.power<Number(r.minPowerKw))return false;
    if(Number.isFinite(Number(r.maxPowerKw))&&ctx.power>Number(r.maxPowerKw))return false;
    return true;
  }
  function ensureStyle(){
    if(document.getElementById('v8ReferenceOfferStyle')||document.getElementById('v8IdfExtraReferenceStyle'))return;
    const s=document.createElement('style');s.id='v8IdfExtraReferenceStyle';s.textContent='.v8-reference-row{border-color:#6e5721!important;background:rgba(126,95,21,.08)!important}.v8-reference-row .v8-ref-tag{display:inline-block;margin-left:6px;color:#d6aa4c;font-size:9px;font-weight:900}.v8-reference-row .v8-offer-total{color:#d6aa4c!important;font-size:10px!important}.v8-reference-row .v8-ref-note{margin-top:4px;color:#9d9276;font-size:9px;line-height:1.35}';document.head.appendChild(s);
  }
  function ensureCard(card){
    const box=card.querySelector('.v8-offer-box');if(!box)return;
    ensureStyle();const ctx=cardContext(card),note=box.querySelector('.v8-offer-note');
    for(const r of refs){
      if(!matches(ctx,r)||box.querySelector(`[data-reference-offer-id="${r.id}"]`))continue;
      const row=document.createElement('div');row.className='v8-offer-row v8-reference-row v8-offer-ambiguous';
      row.dataset.referenceOfferId=r.id;row.dataset.tccProvider=r.provider;
      row.innerHTML=`<div class="v8-offer-provider">${esc(r.provider)}<span class="v8-ref-tag">référence · hors classement</span></div><div class="v8-offer-price">${esc(r.label)}</div><div class="v8-ref-note">${esc(r.note)}</div><div class="v8-offer-total">hors classement</div>`;
      note?.before(row)||box.appendChild(row);
    }
    card.dataset.tccIdfExtraReferenceVersion=VERSION;
  }
  function apply(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(ensureCard);}
  function install(){
    const root=document.getElementById('results');if(!root||root.__tccIdfExtraReferenceObserver)return false;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(apply,350)});obs.observe(root,{childList:true,subtree:true});root.__tccIdfExtraReferenceObserver=obs;
    setTimeout(apply,500);return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>180)clearInterval(timer);},100);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(apply,600),{once:true});else setTimeout(apply,600);
  window.TCCV8IDFExtraReferenceOffers={version:VERSION,apply,refs:refs.slice()};
  console.info('[TCC V8] Références VOLTi + SIE-ELY actives.');
})();
