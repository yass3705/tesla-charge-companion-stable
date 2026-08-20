// Tesla Charge Companion V8 RC4.8 — références tarifaires opérateur non classables.
// Affiche les grilles officiellement validées lorsque le prix exact dépend encore
// de la station / du contexte. Ces lignes ne participent jamais au classement.
(function(){
  'use strict';
  const VERSION='rc48-reference-2';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const esc=v=>(window.escapeHtml?window.escapeHtml(String(v??'')):String(v??''));

  const refs=[
    {id:'ionity-direct',aliases:['IONITY','Ionity'],provider:'IONITY direct',label:'à partir de 0,55 €/kWh · prix exact selon station',note:'Tarif direct officiel France publié comme minimum.'},
    {id:'ionity-app',aliases:['IONITY','Ionity'],provider:'IONITY App',label:'à partir de 0,52 €/kWh · sans abonnement',note:'Prix exact affiché avant la session.'},
    {id:'ionity-motion',aliases:['IONITY','Ionity'],provider:'IONITY Motion',label:'5,99 €/mois · à partir de 0,39 €/kWh',note:'Abonnement officiel, prix station pouvant être supérieur au minimum publié.'},
    {id:'ionity-power',aliases:['IONITY','Ionity'],provider:'IONITY Power',label:'11,99 €/mois · à partir de 0,31 €/kWh',note:'Abonnement officiel, prix station pouvant être supérieur au minimum publié.'},

    {id:'allego-direct',aliases:['Allego'],provider:'Allego direct',label:'France : 0,39 / 0,49 / 0,59 €/kWh selon borne et classe',note:'Allego précise que le prix exact peut varier selon le point de charge.'},
    {id:'allego-plus',aliases:['Allego'],provider:'Allego Plus',label:'9,99 €/mois · économie annoncée jusqu’à 34 %',note:'Le tarif exact de la borne doit encore être récupéré avant classement.'},

    {id:'vianeo-direct',aliases:['ENGIE Vianeo','Vianeo','Engie Vianeo'],provider:'Vianeo direct',label:'carte/QR : à partir de 0,60 €/kWh autoroute · moyenne publiée 0,59 €/kWh hors autoroute',note:'Prix public exact et éventuels frais minute variables par station.'},
    {id:'vianeo-app',aliases:['ENGIE Vianeo','Vianeo','Engie Vianeo'],provider:'Vianeo App',label:'-10 % vs tarif public · à partir de 0,54 €/kWh autoroute',note:'Prix exact et frais minute à vérifier sur la station.'},
    {id:'vianeo-max',aliases:['ENGIE Vianeo','Vianeo','Engie Vianeo'],provider:'Vianeo Max',label:'9,99 €/mois · 0,33 €/kWh',note:'Tarif énergie national ; des frais minute propres à la station peuvent encore s’ajouter.'},

    {id:'total-station-service',aliases:['TotalEnergies','Total Energies','TOTALENERGIES','Total Access'],provider:'TotalEnergies station-service',label:ctx=>`${ctx.power<=50?'0,52':'0,62'} €/kWh · 0,50 €/min après 45 min connecté`,note:'Référence valable uniquement pour les bornes de stations-service TotalEnergies en France ; les concessions locales peuvent différer.'},
    {id:'total-zen',aliases:['TotalEnergies','Total Energies','TOTALENERGIES','Total Access'],provider:'Charge+ Zen',minPowerKw:50,label:'3,90 €/mois · -15 % sur le tarif public des bornes TotalEnergies éligibles ≥50 kW',note:'Éligibilité station par station ; hors classement tant que la famille de borne n’est pas confirmée.'},

    {id:'evadea-grid',aliases:['e-Vadea','eVadea','E-Vadea'],provider:'e-Vadea direct',label:ctx=>{
      const p=ctx.power;
      const motorway=p>=100?'0,62 €/kWh':'0,48 €/kWh';
      const off=p<30?'0,40 €/kWh':p<60?'0,48 €/kWh':'0,58 €/kWh';
      return `autoroute ${motorway} · hors autoroute ${off} · frais d’occupation après 5 min sans énergie`;
    },note:'Le contexte autoroute / hors autoroute doit être identifié avant de classer le prix.'},

    {id:'powerdot-direct',aliases:['Powerdot','Power Dot'],provider:'Powerdot direct',label:'prix exact par connecteur via QR / application de mobilité',note:'Aucun tarif CPO direct national unique n’est publié.'},
    {id:'qovoltis-direct',aliases:['Qovoltis','QOVOLTIS'],provider:'Qovoltis direct',label:'prix exact dans Qovoltis / ChargeNow',note:'Nomad Open, Nomad Gold et paiement ad hoc utilisent un tarif station spécifique.'},
    {id:'bump-direct',aliases:['Bump','BUMP'],provider:'Bump direct',label:'prix défini par le site et affiché dans l’app',note:'Frais de durée, occupation ou parking possibles selon la station.'},
    {id:'etotem-direct',aliases:['e-Totem','e Totem','eTotem','E-TOTEM'],provider:'e-Totem direct',label:'tarif réseau / site spécifique · badge 0 €/mois · 0 % de commission',note:'Plusieurs réseaux e-Totem utilisent des grilles différentes ; aucun prix France unique n’est retenu.'},
    {id:'driveco-reference',aliases:['DRIVECO','Driveco','Driveco France'],provider:'DRIVECO direct',label:'références publiées : 0,39 €/kWh lent · 0,51 €/kWh rapide · 0,55–0,59 €/kWh ultra-rapide',note:'Chaque borne DRIVECO conserve sa propre grille exacte.'},
    {id:'freshmile-direct',aliases:['Freshmile','FRESHMILE'],provider:'Freshmile direct',label:'prix exact réseau / station dans la carte Freshmile',note:'Le tarif peut combiner énergie et temps de connexion.'},
    {id:'electric55-info',aliases:['Electric 55 Charging','Electric55','E55C','Electric 55'],provider:'Electric 55',label:'tarif consommateur direct non validé',note:'La grille publique identifiée est une grille CPO → eMSP ; elle n’est volontairement pas utilisée comme prix conducteur.'}
  ];

  function injectStyle(){
    if(document.getElementById('v8ReferenceOfferStyle'))return;
    const s=document.createElement('style');s.id='v8ReferenceOfferStyle';s.textContent=`
      .v8-reference-row{border-color:#6e5721!important;background:rgba(126,95,21,.08)!important}
      .v8-reference-row .v8-ref-tag{display:inline-block;margin-left:6px;color:#d6aa4c;font-size:9px;font-weight:900}
      .v8-reference-row .v8-offer-total{color:#d6aa4c!important;font-size:10px!important;white-space:nowrap}
      .v8-reference-row .v8-ref-note{margin-top:4px;color:#9d9276;font-size:9px;line-height:1.35}
    `;document.head.appendChild(s);
  }
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
    if(r.kind&&ctx.kind!==String(r.kind).toUpperCase())return false;
    if(Number.isFinite(Number(r.minPowerKw))&&ctx.power<Number(r.minPowerKw))return false;
    if(Number.isFinite(Number(r.maxPowerKw))&&ctx.power>Number(r.maxPowerKw))return false;
    return true;
  }
  function labelFor(r,ctx){return typeof r.label==='function'?r.label(ctx):r.label;}
  function hasRankableProvider(box,provider){
    const wanted=norm(provider);
    return [...box.querySelectorAll('.v8-offer-row:not(.v8-reference-row) .v8-offer-provider')]
      .some(el=>norm(el.textContent).startsWith(wanted));
  }
  function ensureCard(card){
    const box=card.querySelector('.v8-offer-box');if(!box)return;
    injectStyle();
    const ctx=cardContext(card),note=box.querySelector('.v8-offer-note');
    for(const r of refs){
      if(!matches(ctx,r))continue;
      const existing=box.querySelector(`[data-reference-offer-id="${r.id}"]`);
      if(r.id==='evadea-grid'&&hasRankableProvider(box,'e-Vadea direct')){existing?.remove();continue;}
      if(existing)continue;
      const row=document.createElement('div');
      row.className='v8-offer-row v8-reference-row v8-offer-ambiguous';
      row.dataset.referenceOfferId=r.id;row.dataset.tccProvider=r.provider;
      row.innerHTML=`<div class="v8-offer-provider">${esc(r.provider)}<span class="v8-ref-tag">référence · hors classement</span></div><div class="v8-offer-price">${esc(labelFor(r,ctx))}</div>${r.note?`<div class="v8-ref-note">${esc(r.note)}</div>`:''}<div class="v8-offer-total">hors classement</div>`;
      note?.before(row) || box.appendChild(row);
    }
    card.dataset.tccReferenceVersion=VERSION;
  }
  function apply(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(ensureCard);}
  function install(){
    const root=document.getElementById('results');if(!root||root.__tccReferenceObserver)return false;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(apply,350)});obs.observe(root,{childList:true,subtree:true});root.__tccReferenceObserver=obs;
    setTimeout(apply,500);return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>180)clearInterval(timer);},100);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(apply,600),{once:true});else setTimeout(apply,600);
  window.TCCV8ReferenceOffers={version:VERSION,apply,refs:refs.slice()};
  console.info('[TCC V8] Références opérateur non classables actives.');
})();
