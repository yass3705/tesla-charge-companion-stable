// Tesla Charge Companion V8 RC4.8 — afficher les tarifs Electra ambigus sans les classer.
(function(){
  'use strict';
  const VERSION='rc48l';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const normId=v=>text(v).replace(/^france-catalog:/i,'').split('::')[0];
  const fmt=(v,d=3)=>Number(v||0).toFixed(d).replace(/0+$/,'').replace(/\.$/,'');
  function mins(v){const m=text(v).match(/^(\d{1,2}):(\d{2})/);return m?((Number(m[1])*60+Number(m[2]))%1440):0;}
  function inWindow(t,start,end){const a=mins(start||'00:00'),b=end==='24:00'?1440:mins(end||'24:00');if(a===b)return true;if(a<b)return t>=a&&t<b;return t>=a||t<b;}
  function activeRule(pricing,time){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];if(!rules.length)return null;
    const t=mins(time),windows=rules.filter(r=>r?.scope==='timeWindow'&&inWindow(t,r.start,r.end));
    return windows.at(-1)||rules.find(r=>r?.scope==='allDay')||rules[0];
  }
  function label(pricing,time){
    const r=activeRule(pricing,time);if(!r)return'Tarif Electra source';
    const c=text(r.currency||'EUR').toUpperCase(),parts=[];
    if(Number(r.pricePerKwh||0)>0)parts.push(`${fmt(r.pricePerKwh)} ${c}/kWh`);
    if(Number(r.chargePerMinute||0)>0)parts.push(`${fmt(r.chargePerMinute)} ${c}/min`);
    if(Number(r.connectionFee||0)>0)parts.push(`${fmt(r.connectionFee,2)} ${c} fixe`);
    if(Number(r.idlePerMinute||0)>0)parts.push(`${fmt(r.idlePerMinute)} ${c}/min occupation`);
    if(Number(r.afterMinutesRate||0)>0&&Number(r.afterMinutesThreshold||0)>0)parts.push(`${fmt(r.afterMinutesRate)} ${c}/min après ${Math.round(Number(r.afterMinutesThreshold))} min`);
    if(r.scope==='timeWindow'&&(r.start||r.end))parts.push(`créneau ${r.start||'00:00'}–${r.end||'24:00'}`);
    return parts.length?parts.join(' + '):'Tarif Electra variable';
  }
  function shortLabel(value){
    return text(value)
      .replace(/(\d)\.(\d)/g,'$1,$2')
      .replace(/\s+EUR\/kWh/g,' €/kWh')
      .replace(/\s+EUR\/min/g,' €/min')
      .replace(/\s+EUR\s+fixe/g,' € fixe');
  }
  function sig(pricing){
    return JSON.stringify((pricing?.rules||[]).map(r=>[r.scope||'',r.start||'',r.end||'',r.currency||'EUR',Number(r.pricePerKwh||0),Number(r.chargePerMinute||0),Number(r.connectionFee||0),Number(r.idlePerMinute||0),Number(r.afterMinutesRate||0),Number(r.afterMinutesThreshold||0)]));
  }
  function provider(c,st){
    const l=text(c?.label||c?.configurationLabel);const m=l.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    return m?.[1]?.trim()||text(c?.offerProvider)||text(st?.operator)||'';
  }
  function cardInfo(card){
    const raw=text(card.querySelector('h3')?.textContent).replace(/^\d+\.\s*/,'');
    const m=raw.match(/^(.*?)\s+—\s+(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return{id:normId(card.dataset.resultId),kind:m?.[2]?.toUpperCase()||'',power:m?Number(m[3].replace(',','.')):0};
  }
  function electraVariants(card){
    const info=cardInfo(card),all=window.TCC_SOURCE_INTEGRITY_STATIONS||[];
    const st=all.find(s=>normId(s?.id||s?.catalogStationId||s?.baseStationId)===info.id);if(!st)return[];

    // Priorité aux tarifs ambigus explicitement préservés par le loader : ils ne font
    // pas partie des configurations simulables et ne peuvent donc jamais influencer le classement.
    const preserved=Array.isArray(st.ambiguousSourceOffers)?st.ambiguousSourceOffers:[];
    const sourceMatches=preserved.filter(a=>norm(a?.provider)==='electra'&&(!info.kind||text(a?.kind).toUpperCase()===info.kind)&&(!info.power||Math.abs(Number(a?.powerKw||0)-info.power)<.25));
    if(sourceMatches.length){
      const unique=new Map();
      for(const a of sourceMatches)for(const p of (a?.pricings||[])){const k=sig(p);if(k&&!unique.has(k))unique.set(k,p);}
      return [...unique.values()];
    }

    // Compatibilité avec les anciens snapshots où les variantes étaient encore dans chargingConfigurations.
    const configs=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations:[];
    const matches=configs.filter(c=>norm(provider(c,st))==='electra'&&(!info.kind||text(c?.kind||st.kind).toUpperCase()===info.kind)&&(!info.power||Math.abs(Number(c?.powerKw||st.powerKw||0)-info.power)<.25));
    const unique=new Map();for(const c of matches){const p=c?.pricing||st.pricing,k=sig(p);if(k&&!unique.has(k))unique.set(k,p);}
    return [...unique.values()];
  }
  function decorateCard(card){
    const box=card.querySelector('.v8-offer-box');if(!box)return;
    const variants=electraVariants(card);if(variants.length<=1)return;
    const time=document.getElementById('simTime')?.value||'00:00';
    const labels=[...new Set(variants.map(p=>label(p,time)).filter(Boolean))];if(labels.length<=1)return;
    for(const row of [...box.querySelectorAll('.v8-offer-row')]){
      const p=text(row.querySelector('.v8-offer-provider')?.textContent).replace(/\s*✓.*$/,'').trim();
      if(/^Electra(?:\s|$)/i.test(p)&&!/^Electra\+/i.test(p))row.remove();
    }
    if(box.querySelector('.v8-electra-ambiguous-warning'))return;
    const row=document.createElement('div');row.className='v8-offer-row v8-offer-ambiguous v8-electra-ambiguous-warning';row.style.borderColor='#a97816';row.style.background='rgba(169,120,22,.10)';
    row.innerHTML='<div class="v8-offer-provider">Electra <span style="color:#ffc45f">⚠ prix à vérifier</span></div><div class="v8-offer-price"></div><div class="v8-offer-total"></div>';
    row.querySelector('.v8-offer-price').textContent='Plusieurs tarifs source non attribués avec certitude à cette prise';
    const total=row.querySelector('.v8-offer-total');
    total.textContent=labels.map(shortLabel).join(' / ');
    total.style.whiteSpace='normal';total.style.maxWidth='48%';total.style.lineHeight='1.25';
    const note=box.querySelector('.v8-offer-note');if(note)note.insertAdjacentElement('beforebegin',row);else box.appendChild(row);
    if(!box.querySelector('.v8-electra-ambiguous-note')){
      const n=document.createElement('div');n.className='v8-offer-note v8-electra-ambiguous-note';n.style.color='#d6a84a';n.textContent='⚠ Electra fournit plusieurs tarifs au niveau du site sans attribution certaine à cette prise. Vérifie le prix dans Electra avant de charger. Ces tarifs restent affichés à titre informatif mais ne sont pas pris en compte dans le classement.';box.appendChild(n);
    }
    card.dataset.tccElectraWarning=VERSION;
  }
  function decorate(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(decorateCard);}
  function install(){
    const root=document.getElementById('results');if(!root||root.__tccElectraAmbiguousObserver)return false;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorate,550);});obs.observe(root,{childList:true,subtree:true,characterData:true});root.__tccElectraAmbiguousObserver=obs;
    setTimeout(decorate,700);return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>200)clearInterval(timer);},100);
  console.info('[TCC V8] Tarifs Electra ambigus affichés avec alerte, valeurs visibles et exclus du classement.');
})();