// Tesla Charge Companion V8 RC4.8 — finition d'affichage des tarifs La Borne Bleue.
// Se place après le moteur d'abonnements afin que celui-ci ne puisse plus écraser
// les créneaux horaires et l'indication du plafond nocturne.
// Le bandeau Preview est volontairement hors périmètre : un seul propriétaire,
// preview-storage.js généré par le pipeline Pages, peut le modifier.
(function(){
  'use strict';
  const REVISION='rc48br-lbb-detail-finalizer';
  const SUBSCRIPTION_ID='labornebleue-annual';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
  const rate=v=>Number(v||0).toFixed(3).replace('.',',');
  let observer=null,wrappedApi=null,busy=false;

  function isLbbCard(card){
    const badge=norm(card?.querySelector('.operator-badge')?.textContent);
    return badge==='la borne bleue'||badge==='labornebleue';
  }
  function kindPower(card){
    const h=text(card?.querySelector('h3')?.textContent);
    const m=h.match(/\b(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return{kind:m?.[1]?.toUpperCase()||'',power:m?Number(m[2].replace(',','.')):0};
  }
  function chargeMinutes(card){
    const t=text(card?.textContent).replace(/\s+/g,' ');
    let m=t.match(/Recharge\s+([0-9]+)\s*h(?:\s*([0-9]{1,2}))?/i);
    if(m)return Number(m[1])*60+Number(m[2]||0);
    m=t.match(/Recharge\s+([0-9]+)\s*min/i);
    return m?Number(m[1]):NaN;
  }
  function travelMinutes(card){
    const m=text(card?.textContent).replace(/\s+/g,' ').match(/[0-9]+(?:[.,][0-9]+)?\s*km\s*[·•]\s*([0-9]+)\s*min/i);
    return m?Number(m[1]):0;
  }
  function hm(v){
    const m=text(v).match(/^(\d{1,2}):(\d{2})$/);
    return m?(Number(m[1])*60+Number(m[2]))%1440:NaN;
  }
  function hmText(v){
    const n=((Math.round(v)%1440)+1440)%1440;
    return`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  }
  function exactFallback(kind,power,subscriber){
    if(kind==='DC'&&power>50)return{model:'kwh_plus_elapsed',currency:'EUR',pricePerKwh:subscriber?.45:.50,afterMinutes:30,afterRatePerMinute:.20};
    if(kind!=='AC')return null;
    if(power>=3.7&&power<=7.4)return subscriber
      ?{model:'time_windows',currency:'EUR',windows:[{start:'08:00',end:'20:00',ratePerMinute:3.50/60},{start:'20:00',end:'08:00',ratePerMinute:2.50/60,capEur:12}]}
      :{model:'time_windows',currency:'EUR',windows:[{start:'08:00',end:'20:00',ratePerMinute:4.50/60},{start:'20:00',end:'08:00',ratePerMinute:3.50/60}]};
    if(power<=22.1)return subscriber
      ?{model:'time_windows',currency:'EUR',windows:[{start:'08:00',end:'20:00',ratePerMinute:5.50/60},{start:'20:00',end:'08:00',ratePerMinute:5.50/60,capEur:12}]}
      :{model:'per_minute',currency:'EUR',ratePerMinute:6.50/60};
    return{model:'per_minute',currency:'EUR',ratePerMinute:(subscriber?11:12)/60};
  }
  function exactTariff(kind,power,subscriber){
    const api=window.TCCV8LaBorneBleueResultGuard;
    if(typeof api?.exactTariff==='function'){
      try{const x=api.exactTariff(kind,power,subscriber);if(x)return x}catch(e){}
    }
    return exactFallback(kind,power,subscriber);
  }
  function capReached(card,exact){
    if(exact?.model!=='time_windows'||!(exact.windows||[]).some(w=>Number(w?.capEur||0)>0))return 0;
    const charge=chargeMinutes(card);if(!Number.isFinite(charge))return 0;
    const base=hm(document.getElementById('simTime')?.value||'');
    const start=Number.isFinite(base)?(base+travelMinutes(card))%1440:0;
    const startText=hmText(start),unplug=document.getElementById('simUnplugTime')?.value||'';
    const api=window.TCCV8LaBorneBleueResultGuard;
    if(typeof api?.cappedWindowReached==='function'){
      try{return Number(api.cappedWindowReached(exact,start,charge,unplug,startText)||0)}catch(e){}
    }
    return 0;
  }
  function detailedLabel(card,subscriber){
    const kp=kindPower(card),exact=exactTariff(kp.kind,kp.power,subscriber);if(!exact)return'';
    if(exact.model==='kwh_plus_elapsed')return`${Number(exact.pricePerKwh).toFixed(2).replace('.',',')} €/kWh + ${Number(exact.afterRatePerMinute).toFixed(2).replace('.',',')} €/min après ${Number(exact.afterMinutes)} min`;
    if(exact.model==='per_minute')return`${rate(exact.ratePerMinute)} €/min`;
    const cap=capReached(card,exact);
    const parts=(exact.windows||[]).map(w=>{
      const night=String(w.start)==='20:00'&&String(w.end)==='08:00';
      let s=`${w.start}–${w.end} : ${rate(w.ratePerMinute)} €/min`;
      if(Number(w.capEur)>0)s+=` · plafond nocturne ${euro(w.capEur)}`;
      if(night&&cap>0)s+=' atteint';
      return s;
    });
    return parts.join(' · ');
  }
  function rowType(row){
    const p=norm(row?.querySelector('.v8-offer-provider')?.textContent);
    const sid=text(row?.dataset?.subscriptionId);
    if(sid===SUBSCRIPTION_ID||p==='abonne'||p.startsWith('abonne ')||(p.includes('la borne bleue')&&p.includes('abonne')))return'subscriber';
    if(p==='la borne bleue direct'||(p.startsWith('la borne bleue direct ')&&!p.includes('abonne')))return'public';
    return'';
  }
  function decorateCard(card){
    if(!isLbbCard(card))return 0;
    let changed=0;
    card.querySelectorAll('.v8-offer-row').forEach(row=>{
      const type=rowType(row);if(!type)return;
      const label=detailedLabel(card,type==='subscriber');if(!label)return;
      const price=row.querySelector('.v8-offer-price');if(!price)return;
      if(text(price.textContent)!==label){price.textContent=label;changed++;}
      row.dataset.labornebleueDetailRevision=REVISION;
      if(type==='subscriber')row.dataset.subscriptionId=SUBSCRIPTION_ID;
    });
    return changed;
  }
  function decorateAll(){
    if(busy)return 0;busy=true;
    let changed=0;
    try{document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{changed+=decorateCard(card);});}
    finally{busy=false;}
    return changed;
  }
  function wrapSubscriptions(){
    const api=window.TCCV8Subscriptions;
    if(!api||typeof api.applyAll!=='function')return false;
    if(api.applyAll.__tccLbbDetailFinalizer){wrappedApi=api;return true;}
    const original=api.applyAll;
    const wrapped=function(...args){
      const result=original.apply(this,args);
      if(result&&typeof result.then==='function')return result.finally(()=>setTimeout(decorateAll,0));
      queueMicrotask(decorateAll);return result;
    };
    wrapped.__tccLbbDetailFinalizer=true;wrapped.__tccOriginal=original;
    api.applyAll=wrapped;wrappedApi=api;return true;
  }
  function installObserver(){
    const root=document.getElementById('results');if(!root||observer)return !!root;
    let timer=null;observer=new MutationObserver(()=>{if(busy)return;clearTimeout(timer);timer=setTimeout(()=>{wrapSubscriptions();decorateAll();},80)});
    observer.observe(root,{childList:true,subtree:true,characterData:true});return true;
  }
  function install(){wrapSubscriptions();installObserver();decorateAll();}
  let tries=0;const timer=setInterval(()=>{tries++;install();if(tries>120||(wrappedApi&&observer&&tries>20))clearInterval(timer)},250);
  document.addEventListener('click',e=>{if(e.target?.closest?.('.v8-simulate,#routeButton'))setTimeout(()=>{wrapSubscriptions();decorateAll();},120);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});else setTimeout(install,0);
  window.TCCV8LaBorneBleueDetailFinalizer={revision:REVISION,decorateAll,decorateCard,detailedLabel,wrapSubscriptions};
  console.info('[TCC V8] rc48br : détail des créneaux et plafond La Borne Bleue finalisé après le moteur d’abonnements.');
})();