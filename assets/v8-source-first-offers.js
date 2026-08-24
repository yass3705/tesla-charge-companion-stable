// Tesla Charge Companion V8 RC4.8 — affichage tarifaire directement depuis les configurations chargées.
// Aucun rechargement de station et aucun lien externe : on conserve les objets pricing exacts
// renvoyés par candidateStations(), puis on les utilise pour enrichir les cartes après simulation.
(function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).toLowerCase().replace(/\s+/g,' ');
  const fmt=(v,d=3)=>Number(v||0).toFixed(d).replace(/0+$/,'').replace(/\.$/,'');
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
  let lastPrepared=[];

  function providerFromStation(st){
    const label=text(st?.configurationLabel);
    const m=label.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    return m?.[1]?.trim()||text(st?.offerProvider)||text(st?.operator)||'Tarif disponible';
  }
  function cleanProvider(v){return text(v).replace(/\s*✓.*$/,'').replace(/\s+abonnement.*$/i,'').trim();}
  function normId(v){return text(v).replace(/^france-catalog:/i,'').split('::')[0];}
  function baseId(st){return normId(st?.baseStationId||st?.catalogStationId||st?.id);}

  function installCandidateCapture(){
    const current=window.candidateStations;
    if(typeof current!=='function'||current.__tccSourceCandidateCapture)return false;
    const wrapped=async function(...args){
      const out=await current.apply(this,args);
      if(Array.isArray(out?.stations)){
        lastPrepared=out.stations.slice();
        window.TCC_SOURCE_PREPARED_STATIONS=lastPrepared;
        window.TCC_SOURCE_PREPARED_AT=Date.now();
      }
      return out;
    };
    wrapped.__tccSourceCandidateCapture=true;
    wrapped.__tccOriginal=current;
    window.candidateStations=wrapped;
    try{candidateStations=wrapped}catch(e){}
    return true;
  }

  function mins(v){const m=String(v||'00:00').match(/^(\d{1,2}):(\d{2})$/);return m?(Number(m[1])*60+Number(m[2]))%1440:0;}
  function inWindow(t,start,end){
    const a=mins(start||'00:00'),b=end==='24:00'?1440:mins(end||'24:00');
    if(a===b)return true;
    if(a<b)return t>=a&&t<b;
    return t>=a||t<b;
  }
  function activeRule(pricing,time){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
    if(!rules.length)return null;
    const t=mins(time);
    const windows=rules.filter(r=>r?.scope==='timeWindow'&&inWindow(t,r.start,r.end));
    if(windows.length)return windows[windows.length-1];
    return rules.find(r=>r?.scope==='allDay')||rules[0];
  }
  function tariffLabel(pricing,time){
    const r=activeRule(pricing,time);if(!r)return'Tarif non disponible';
    const c=text(r.currency||'EUR').toUpperCase(),parts=[];
    if(Number(r.pricePerKwh||0)>0)parts.push(`${fmt(r.pricePerKwh)} ${c}/kWh`);
    if(Number(r.chargePerMinute||0)>0)parts.push(`${fmt(r.chargePerMinute)} ${c}/min`);
    if(Number(r.belibConnectedTimePerMinute||0)>0)parts.push(`${fmt(r.belibConnectedTimePerMinute)} ${c}/min de branchement`);
    if(Number(r.connectionFee||0)>0)parts.push(`${fmt(r.connectionFee,2)} ${c} fixe`);
    if(Number(r.idlePerMinute||0)>0)parts.push(`${fmt(r.idlePerMinute)} ${c}/min stationnement après charge`);
    if(Number(r.afterMinutesRate||0)>0&&Number(r.afterMinutesThreshold||0)>0)parts.push(`${fmt(r.afterMinutesRate)} ${c}/min après ${Math.round(Number(r.afterMinutesThreshold))} min`);
    if(r.scope==='timeWindow'&&(r.start||r.end))parts.push(`créneau ${r.start||'00:00'}–${r.end||'24:00'}`);
    return parts.length?parts.join(' + '):'Tarif variable';
  }
  function simpleRate(pricing,time){const r=activeRule(pricing,time);return Number(r?.pricePerKwh||0);}

  function cardInfo(card){
    const h=text(card.querySelector('h3')?.textContent).replace(/^\d+\.\s*/, '');
    const m=h.match(/^(.*?)\s+—\s+(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return {id:normId(card.dataset.resultId),name:m?.[1]?.trim()||h.split('—')[0].trim(),kind:m?.[2]?.toUpperCase()||'',power:m?Number(m[3].replace(',','.')):0};
  }
  function rowRate(row){
    const t=text(row.querySelector('.v8-offer-price')?.textContent);
    const m=t.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:EUR|€)\/kWh/i);
    return m?Number(m[1].replace(',','.')):NaN;
  }
  function candidatesFor(card,provider){
    const info=cardInfo(card),p=norm(cleanProvider(provider));
    return (lastPrepared||[]).filter(st=>{
      if(info.id&&baseId(st)!==info.id)return false;
      if(info.kind&&text(st?.kind).toUpperCase()!==info.kind)return false;
      if(info.power&&Math.abs(Number(st?.powerKw||0)-info.power)>.25)return false;
      return norm(providerFromStation(st))===p;
    });
  }
  function chooseCandidate(card,row,provider,time){
    const all=candidatesFor(card,provider);if(!all.length)return null;if(all.length===1)return all[0];
    const shown=rowRate(row);
    if(Number.isFinite(shown)){
      const ranked=all.map(st=>({st,d:Math.abs(simpleRate(st.pricing,time)-shown)})).sort((a,b)=>a.d-b.d);
      if(ranked[0])return ranked[0].st;
    }
    return all[0];
  }

  function parseChargeMinutes(card){
    for(const cell of card.querySelectorAll('.result-metrics>div')){
      if(!/^Recharge$/i.test(text(cell.querySelector('span')?.textContent)))continue;
      const t=text(cell.querySelector('b')?.textContent);let total=0;
      const h=t.match(/(\d+)\s*h/i),m=t.match(/(\d+)\s*min/i);
      if(h)total+=Number(h[1])*60;if(m)total+=Number(m[1]);
      if(!h&&!m){const n=Number((t.match(/\d+/)||[])[0]);if(Number.isFinite(n))total=n;}
      return total;
    }
    return 0;
  }
  function parseKwh(card){const m=text(card.textContent).match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);return m?Number(m[1].replace(',','.')):0;}
  function sourceCosts(pricing,time,minutes,kwh){
    if(!(minutes>0)||!(kwh>=0))return null;
    const energyPerMinute=kwh/minutes,start=mins(time);let energy=0,duration=0;
    const first=activeRule(pricing,time);if(!first)return null;
    const connection=Number(first.connectionFee||0);
    for(let i=0;i<Math.ceil(minutes);i++){
      const fraction=Math.min(1,minutes-i),t=(start+i)%1440;
      const hh=String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
      const r=activeRule(pricing,hh);if(!r)continue;
      energy+=energyPerMinute*fraction*Number(r.pricePerKwh||0);
      duration+=fraction*Number(r.chargePerMinute||0);
    }
    return{energy,duration,connection};
  }

  function decorateCard(card){
    const time=document.getElementById('simTime')?.value||'00:00';
    let bestStation=null;
    for(const row of card.querySelectorAll('.v8-offer-row')){
      const provider=cleanProvider(row.querySelector('.v8-offer-provider')?.textContent);
      if(!provider||/^Electra\+/i.test(provider))continue;
      const st=chooseCandidate(card,row,provider,time);if(!st)continue;
      const el=row.querySelector('.v8-offer-price');if(el)el.textContent=tariffLabel(st.pricing,time);
      if(row.classList.contains('best'))bestStation=st;
    }
    if(bestStation){
      const label=tariffLabel(bestStation.pricing,time);
      for(const el of card.querySelectorAll('.small')){
        if(/Tarif\s*:/i.test(text(el.textContent))){const b=el.querySelector('b');if(b)b.textContent=label;break;}
      }
    }
    card.querySelector('.v8-source-breakdown')?.remove();
    if(bestStation){
      const costs=sourceCosts(bestStation.pricing,time,parseChargeMinutes(card),parseKwh(card));
      if(costs&&(costs.duration>0.005||costs.connection>0.005)){
        const parts=[];
        if(costs.energy>0.005)parts.push(`énergie ≈ ${euro(costs.energy)}`);
        if(costs.duration>0.005)parts.push(`durée ≈ ${euro(costs.duration)}`);
        if(costs.connection>0.005)parts.push(`connexion ${euro(costs.connection)}`);
        const box=document.createElement('div');box.className='v8-source-breakdown small';
        box.style.cssText='margin:8px 0;padding:9px 11px;border:1px solid #2d2d31;border-radius:10px;color:#b9b9c0';
        box.innerHTML=`<b>Détail tarifaire source</b> · ${parts.join(' · ')}`;
        const offerBox=card.querySelector('.v8-offer-box');if(offerBox)offerBox.insertAdjacentElement('afterend',box);
      }
    }
  }
  function decorate(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(decorateCard);}
  function installObserver(){
    const root=document.getElementById('results');if(!root||root.__tccSourcePreparedObserver)return false;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorate,180);});
    obs.observe(root,{childList:true,subtree:true,characterData:true});root.__tccSourcePreparedObserver=obs;decorate();return true;
  }

  let tries=0;const timer=setInterval(()=>{
    tries++;
    const a=installCandidateCapture(),b=installObserver();
    if((a&&b)||tries>180)clearInterval(timer);
  },100);
  console.info('[TCC V8] Tarifs source-first reliés aux configurations réellement chargées.');
})();
