// Tesla Charge Companion V8 RC4.8 — garde-fou final La Borne Bleue après rendu.
// Une carte dont le badge physique est exactement « La Borne Bleue » reçoit toujours
// les tarifs directs officiels de sa classe de puissance, même si le matching catalogue a échoué.
(function(){
  'use strict';
  const REVISION='rc48bq-lbb-cap-explained';
  const SUBSCRIPTION_ID='labornebleue-annual';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
  let observer=null,busy=false;

  function isExactLbbCard(card){
    const badge=norm(card?.querySelector('.operator-badge')?.textContent);
    return badge==='la borne bleue'||badge==='labornebleue';
  }
  function kindPower(card){
    const h=text(card?.querySelector('h3')?.textContent),m=h.match(/\b(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return{kind:m?.[1]?.toUpperCase()||'',power:m?Number(m[2].replace(',','.')):0};
  }
  function exactTariff(kind,power,subscriber){
    const api=window.TCCV8LaBorneBleueExplicitFallback;
    const fn=subscriber?api?.exactSubscriber:api?.exactPublic;
    if(typeof fn==='function'){try{const x=fn(kind,power);if(x)return x}catch(e){}}
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
  function chargeMinutes(card){
    const t=text(card?.textContent).replace(/\s+/g,' ');
    let m=t.match(/Recharge\s+([0-9]+)\s*h(?:\s*([0-9]{1,2}))?/i);if(m)return Number(m[1])*60+Number(m[2]||0);
    m=t.match(/Recharge\s+([0-9]+)\s*min/i);return m?Number(m[1]):NaN;
  }
  function travelMinutes(card){
    const m=text(card?.textContent).replace(/\s+/g,' ').match(/[0-9]+(?:[.,][0-9]+)?\s*km\s*[·•]\s*([0-9]+)\s*min/i);
    return m?Number(m[1]):0;
  }
  function billedEnergy(card){
    const m=text(card?.textContent).replace(/\s+/g,' ').match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);
    return m?Number(m[1].replace(',','.')):0;
  }
  function hm(v){const m=text(v).match(/^(\d{1,2}):(\d{2})$/);return m?(Number(m[1])*60+Number(m[2]))%1440:NaN;}
  function hmText(v){const n=((Math.round(v)%1440)+1440)%1440;return`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
  function inWindow(m,start,end){
    const s=hm(start),e=end==='24:00'?1440:hm(end);if(!Number.isFinite(s)||!Number.isFinite(e))return false;
    return s<e?(m>=s&&m<e):(m>=s||m<e);
  }
  function occupied(charge,unplug,start){
    const a=hm(start),b=hm(unplug);if(!unplug||!Number.isFinite(a)||!Number.isFinite(b))return charge;
    let d=b-a;if(d<0)d+=1440;return Math.max(charge,d);
  }
  function cappedWindowReached(exact,startMinute,charge,unplug,startText){
    if(exact?.model!=='time_windows')return 0;
    const billed=occupied(charge,unplug,startText);
    for(const w of exact.windows||[]){
      const cap=Number(w?.capEur||0);if(!(cap>0))continue;
      let raw=0;
      for(let i=0;i<Math.ceil(billed);i++){
        const fraction=Math.min(1,billed-i);if(fraction<=0)continue;
        const minute=(startMinute+i)%1440;
        if(inWindow(minute,w.start,w.end))raw+=fraction*Number(w.ratePerMinute||0);
      }
      if(raw+1e-9>=cap)return cap;
    }
    return 0;
  }
  function localCost(exact,startMinute,charge,energy,unplug,startText){
    if(exact.model==='kwh_plus_elapsed')return Math.max(0,energy)*Number(exact.pricePerKwh||0)+Math.max(0,charge-Number(exact.afterMinutes||0))*Number(exact.afterRatePerMinute||0);
    const billed=occupied(charge,unplug,startText);
    if(exact.model==='per_minute')return billed*Number(exact.ratePerMinute||0);
    const totals=new Map();
    for(let i=0;i<Math.ceil(billed);i++){
      const fraction=Math.min(1,billed-i);if(fraction<=0)continue;
      const minute=(startMinute+i)%1440,w=(exact.windows||[]).find(x=>inWindow(minute,x.start,x.end));if(!w)return NaN;
      totals.set(w,(totals.get(w)||0)+fraction*Number(w.ratePerMinute||0));
    }
    let total=0;for(const [w,raw] of totals)total+=Number(w.capEur)>0?Math.min(raw,Number(w.capEur)):raw;return total;
  }
  function calculate(card,subscriber){
    const kp=kindPower(card),exact=exactTariff(kp.kind,kp.power,subscriber),charge=chargeMinutes(card);if(!exact||!Number.isFinite(charge))return null;
    const base=hm(document.getElementById('simTime')?.value||''),start=Number.isFinite(base)?(base+travelMinutes(card))%1440:0,startText=hmText(start),unplug=document.getElementById('simUnplugTime')?.value||'',energy=billedEnergy(card);
    const capReachedEur=cappedWindowReached(exact,start,charge,unplug,startText);
    const api=window.TCCV8LaBorneBleueDirect?.exactCost;
    if(typeof api==='function')try{const r=api({labornebleueExact:exact},start,charge,energy,unplug,startText);if(Number.isFinite(Number(r?.total)))return{total:Number(r.total),exact,capReachedEur};}catch(e){}
    const total=localCost(exact,start,charge,energy,unplug,startText);return Number.isFinite(total)?{total,exact,capReachedEur}:null;
  }
  function priceLabel(exact,capReachedEur=0){
    if(exact.model==='kwh_plus_elapsed')return`${Number(exact.pricePerKwh).toFixed(2)} EUR/kWh + ${Number(exact.afterRatePerMinute).toFixed(2)} EUR/min après ${Number(exact.afterMinutes)} min`;
    if(exact.model==='per_minute')return`${Number(exact.ratePerMinute).toFixed(3)} EUR/min`;
    const windows=(exact.windows||[]).map(w=>`${w.start}–${w.end} ${Number(w.ratePerMinute).toFixed(3)} EUR/min${w.capEur?` · plafond ${euro(w.capEur)}`:''}`).join(' · ');
    return capReachedEur>0?`${windows} · plafond nocturne ${euro(capReachedEur)} atteint`:windows;
  }
  function provider(row){return norm(row?.querySelector('.v8-offer-provider')?.textContent);}
  function rowFor(box,subscriber){
    return [...box.querySelectorAll('.v8-offer-row')].find(row=>{
      const p=provider(row);
      if(subscriber)return text(row.dataset.subscriptionId)===SUBSCRIPTION_ID||(p.includes('la borne bleue')&&p.includes('abonne'))||p==='abonne';
      return p==='la borne bleue direct'||(p.startsWith('la borne bleue direct ')&&!p.includes('abonne'));
    });
  }
  function upsert(card,box,subscriber){
    const calc=calculate(card,subscriber);if(!calc)return false;
    let row=rowFor(box,subscriber),created=false;
    if(!row){row=document.createElement('div');row.className='v8-offer-row';const note=box.querySelector('.v8-offer-note');note?note.before(row):box.appendChild(row);created=true;}
    const displayProvider=subscriber?'La Borne Bleue direct — Abonné':'La Borne Bleue direct';
    const desired=`<div class="v8-offer-provider">${displayProvider}</div><div class="v8-offer-price">${priceLabel(calc.exact,calc.capReachedEur)}</div><div class="v8-offer-total">${euro(calc.total)}</div>`;
    const changed=created||row.innerHTML!==desired||row.dataset.labornebleueResultGuard!==REVISION;
    row.classList.remove('v8-direct-fallback-row','v8-reference-row','v8-offer-ambiguous');row.classList.add('v8-lbb-result-guard-row');
    row.dataset.tccProvider=displayProvider;row.dataset.labornebleueDirect='1';row.dataset.labornebleueResultGuard=REVISION;
    if(subscriber)row.dataset.subscriptionId=SUBSCRIPTION_ID;else delete row.dataset.subscriptionId;
    if(row.innerHTML!==desired)row.innerHTML=desired;
    return changed;
  }
  function ensureCard(card){
    if(!isExactLbbCard(card))return false;const box=card.querySelector('.v8-offer-box');if(!box)return false;let changed=false;
    changed=upsert(card,box,false)||changed;
    changed=upsert(card,box,true)||changed;
    if(rowFor(box,false))box.querySelectorAll('.v8-direct-fallback-row,.v8-reference-row').forEach(r=>{if(provider(r).startsWith('la borne bleue direct'))r.remove();});
    return changed;
  }
  function ensureAll(){
    let changed=0;document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{if(ensureCard(card))changed++;});
    if(changed)try{window.TCCV8Subscriptions?.applyAll?.(true);}catch(e){}return changed;
  }
  function installBannerStyle(){
    if(document.getElementById('tccPreviewBannerRc48bqStyle'))return;
    const s=document.createElement('style');s.id='tccPreviewBannerRc48bqStyle';
    s.textContent="#tccPreviewBanner::after{content:'V8 Preview · RC4.8 · rc48bq · plafond nocturne La Borne Bleue explicite · abonnements stables iOS · données canoniques France · auto-mise à jour désactivée'!important}";
    document.head.appendChild(s);
  }
  function mark(){installBannerStyle();const b=document.getElementById('tccPreviewBanner');if(!b)return;const s='V8 Preview · RC4.8 · rc48bq · plafond nocturne La Borne Bleue explicite · abonnements stables iOS · données canoniques France · auto-mise à jour désactivée';b.dataset.stableLabel=s;b.setAttribute('aria-label',s);}
  function install(){
    const root=document.getElementById('results');if(!root)return false;
    if(!observer){let timer=null;observer=new MutationObserver(()=>{if(busy)return;clearTimeout(timer);timer=setTimeout(()=>{busy=true;try{ensureAll()}finally{busy=false}},180)});observer.observe(root,{childList:true,subtree:true});}
    ensureAll();mark();return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()&&tries>20)clearInterval(timer);if(tries>120)clearInterval(timer)},250);
  document.addEventListener('click',e=>{if(e.target?.closest?.('.v8-simulate,#routeButton'))setTimeout(ensureAll,160);},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});else setTimeout(install,0);
  window.TCCV8LaBorneBleueResultGuard={revision:REVISION,ensureAll,ensureCard,isExactLbbCard,exactTariff,cappedWindowReached};
  console.info('[TCC V8] rc48bq : plafond nocturne La Borne Bleue explicitement signalé lorsqu’il est atteint.');
})();