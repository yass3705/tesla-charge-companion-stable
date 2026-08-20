// Tesla Charge Companion V8 RC4.8 — intégrité source-first.
// Utilise directement les configurations tarifaires contenues dans les stations préparées.
// Aucun rapprochement externe par URL/nom. Les tarifs source ambigus ne participent pas au classement.
(function(){
  'use strict';
  const VERSION='rc48-postcharge-1';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const fmt=(v,d=3)=>Number(v||0).toFixed(d).replace(/0+$/,'').replace(/\.$/,'');
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
  const cleanProvider=v=>text(v).replace(/\s*✓.*$/,'').replace(/\s+abonnement.*$/i,'').trim();
  const normId=v=>text(v).replace(/^france-catalog:/i,'').split('::')[0];
  let prepared=[];

  function providerFromConfig(c,st){
    const label=text(c?.label||c?.configurationLabel);
    const m=label.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    return m?.[1]?.trim()||text(c?.offerProvider)||text(st?.operator)||'Tarif disponible';
  }
  function pricingSig(p){
    if(!p)return'';
    const rules=(p.rules||[]).map(r=>({scope:r.scope||'',start:r.start||'',end:r.end||'',billing:r.billing||'',currency:(r.currency||'EUR').toUpperCase(),k:Number(r.pricePerKwh||0),m:Number(r.chargePerMinute||0),f:Number(r.connectionFee||0),i:Number(r.idlePerMinute||0),ar:Number(r.afterMinutesRate||0),at:Number(r.afterMinutesThreshold||0),pc:Number(r.postChargeRate||0),pg:Number(r.postChargeGraceMinutes||0)}));
    return JSON.stringify({type:p.type||'',rules});
  }
  function expandedPrepared(){
    const out=[];
    for(const st of prepared||[]){
      const base=normId(st?.id||st?.catalogStationId||st?.baseStationId);
      const configs=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{id:'main',label:`${st?.kind||'AC'} ${Number(st?.powerKw||0)} kW`,kind:st?.kind,powerKw:st?.powerKw,pricing:st?.pricing,stalls:st?.stalls}];
      for(const c of configs){
        out.push({base,physical:st,config:c,provider:providerFromConfig(c,st),kind:text(c?.kind||st?.kind).toUpperCase(),power:Number(c?.powerKw||st?.powerKw||0),pricing:c?.pricing||st?.pricing});
      }
    }
    return out;
  }
  function installCandidateCapture(){
    const current=window.candidateStations;
    if(typeof current!=='function'||current.__tccIntegrityCapture)return false;
    const wrapped=async function(...args){
      const out=await current.apply(this,args);
      if(Array.isArray(out?.stations)){prepared=out.stations.slice();window.TCC_SOURCE_INTEGRITY_STATIONS=prepared;}
      return out;
    };
    wrapped.__tccIntegrityCapture=true;wrapped.__tccOriginal=current;
    window.candidateStations=wrapped;try{candidateStations=wrapped}catch(e){}
    return true;
  }
  function installUnknownAccess(){
    const current=window.accessStatus;
    if(typeof current!=='function'||current.__tccUnknownAccess)return false;
    const wrapped=function(st,dateStr,timeStr){
      if(st?.access?.unknown)return{canStart:true,remaining:Infinity,label:'Horaires non fournis par la source — accès à vérifier',unknown:true};
      return current.apply(this,arguments);
    };
    wrapped.__tccUnknownAccess=true;wrapped.__tccOriginal=current;
    window.accessStatus=wrapped;try{accessStatus=wrapped}catch(e){}
    return true;
  }
  function mins(v){const m=text(v).match(/^(\d{1,2}):(\d{2})/);return m?((Number(m[1])*60+Number(m[2]))%1440):0;}
  function inWindow(t,start,end){const a=mins(start||'00:00'),b=end==='24:00'?1440:mins(end||'24:00');if(a===b)return true;if(a<b)return t>=a&&t<b;return t>=a||t<b;}
  function activeRule(pricing,time){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];if(!rules.length)return null;
    const t=mins(time),windows=rules.filter(r=>r?.scope==='timeWindow'&&inWindow(t,r.start,r.end));
    return windows.at(-1)||rules.find(r=>r?.scope==='allDay')||rules[0];
  }
  function postChargeDescription(pricing,active,c,source=false){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
    const rates=rules.map(r=>Number(r?.postChargeRate||0)).filter(x=>x>0);
    if(!rates.length)return'';
    const maxRate=Math.max(...rates),graces=rules.map(r=>Number(r?.postChargeGraceMinutes)).filter(Number.isFinite),grace=graces.length?Math.max(...graces):0;
    const activeRate=Number(active?.postChargeRate||0);
    if(activeRate>0)return source?`après fin de charge + ${Math.round(grace)} min : ${fmt(activeRate)} ${c}/min`:`${fmt(activeRate)} ${c}/min ${Math.round(grace)} min après fin de charge`;
    return source?`après fin de charge + ${Math.round(grace)} min : jusqu'à ${fmt(maxRate)} ${c}/min selon horaire`:`jusqu'à ${fmt(maxRate)} ${c}/min ${Math.round(grace)} min après fin de charge selon horaire`;
  }
  function tariffLabel(pricing,time){
    const r=activeRule(pricing,time);if(!r)return'Tarif non disponible';
    const c=text(r.currency||'EUR').toUpperCase(),parts=[];
    if(Number(r.pricePerKwh||0)>0)parts.push(`${fmt(r.pricePerKwh)} ${c}/kWh`);
    if(Number(r.chargePerMinute||0)>0)parts.push(`${fmt(r.chargePerMinute)} ${c}/min`);
    if(Number(r.connectionFee||0)>0)parts.push(`${fmt(r.connectionFee,2)} ${c} fixe`);
    if(Number(r.idlePerMinute||0)>0)parts.push(`${fmt(r.idlePerMinute)} ${c}/min occupation`);
    if(Number(r.afterMinutesRate||0)>0&&Number(r.afterMinutesThreshold||0)>0)parts.push(`${fmt(r.afterMinutesRate)} ${c}/min après ${Math.round(Number(r.afterMinutesThreshold))} min`);
    const post=postChargeDescription(pricing,r,c,false);if(post)parts.push(post);
    if(r.scope==='timeWindow'&&(r.start||r.end))parts.push(`créneau ${r.start||'00:00'}–${r.end||'24:00'}`);
    return parts.length?parts.join(' + '):'Tarif variable';
  }
  function sourceParts(pricing,time){
    const r=activeRule(pricing,time);if(!r)return[];
    const c=text(r.currency||'EUR').toUpperCase(),parts=[];
    if(Number(r.pricePerKwh||0)>0)parts.push(`énergie ${fmt(r.pricePerKwh)} ${c}/kWh`);
    if(Number(r.chargePerMinute||0)>0)parts.push(`durée ${fmt(r.chargePerMinute)} ${c}/min`);
    if(Number(r.connectionFee||0)>0)parts.push(`connexion ${fmt(r.connectionFee,2)} ${c}`);
    if(Number(r.idlePerMinute||0)>0)parts.push(`occupation ${fmt(r.idlePerMinute)} ${c}/min`);
    if(Number(r.afterMinutesRate||0)>0&&Number(r.afterMinutesThreshold||0)>0)parts.push(`après ${Math.round(Number(r.afterMinutesThreshold))} min : ${fmt(r.afterMinutesRate)} ${c}/min`);
    const post=postChargeDescription(pricing,r,c,true);if(post)parts.push(post);
    if(r.scope==='timeWindow'&&(r.start||r.end))parts.push(`créneau ${r.start||'00:00'}–${r.end||'24:00'}`);
    return parts;
  }
  function cardInfo(card){
    const h=text(card.querySelector('h3')?.textContent).replace(/^\d+\.\s*/,'');
    const m=h.match(/^(.*?)\s+—\s+(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return{id:normId(card.dataset.resultId),name:m?.[1]?.trim()||h.split('—')[0].trim(),kind:m?.[2]?.toUpperCase()||'',power:m?Number(m[3].replace(',','.')):0};
  }
  function configsFor(card,provider){
    const info=cardInfo(card),p=norm(cleanProvider(provider)),all=expandedPrepared();
    return all.filter(x=>(!info.id||x.base===info.id)&&(!info.kind||x.kind===info.kind)&&(!info.power||Math.abs(x.power-info.power)<.25)&&norm(x.provider)===p);
  }
  function totalFromRow(row){
    const t=text(row.querySelector('.v8-offer-total')?.textContent).replace(/\u00a0/g,' ');const m=t.match(/-?\d[\d\s]*(?:[.,]\d+)?/);if(!m)return NaN;return Number(m[0].replace(/\s/g,'').replace(',','.'));
  }
  function setBest(row,on,tie){
    row.classList.toggle('best',!!on);
    const p=row.querySelector('.v8-offer-provider');if(!p)return;
    p.querySelectorAll('.v8-offer-best').forEach(x=>x.remove());
    if(on){const s=document.createElement('span');s.className='v8-offer-best';s.textContent=tie?'✓ meilleur ex æquo':'✓ moins cher';p.appendChild(s);}
  }
  function parseBilledKwh(card){const m=text(card.textContent).match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);return m?Number(m[1].replace(',','.')):NaN;}
  function parseRecoveredKm(card){const m=text(card.textContent).match(/≈\s*([0-9]+)\s*km/i);return m?Number(m[1]):NaN;}
  function updateSummary(card,winner,total,time){
    const cost=card.querySelector('.station-head .cost')||card.querySelector('.cost');if(cost&&Number.isFinite(total))cost.textContent=euro(total);
    const label=winner?.pricing?tariffLabel(winner.pricing,time):null;
    if(label){
      for(const el of card.querySelectorAll('.small')){
        if(!/Tarif\s*:/i.test(text(el.textContent)))continue;
        const kwh=parseBilledKwh(card),km=parseRecoveredKm(card),parts=[`Tarif : <b>${label}</b>`];
        if(Number.isFinite(total)&&Number.isFinite(kwh)&&kwh>0)parts.push(`effectif session : <b>${(total/kwh).toFixed(3)} €/kWh</b>`);
        if(Number.isFinite(total)&&Number.isFinite(km)&&km>0)parts.push(`<b>${(total/km*100).toFixed(1)} ct/km récupéré</b>`);
        el.innerHTML=parts.join(' · ');break;
      }
    }
    card.querySelector('.v8-integrity-breakdown')?.remove();
    if(winner?.pricing){
      const parts=sourceParts(winner.pricing,time);if(parts.length){
        const box=document.createElement('div');box.className='v8-integrity-breakdown small';box.style.cssText='margin:8px 0;padding:9px 11px;border:1px solid #2d2d31;border-radius:10px;color:#b9b9c0';box.innerHTML=`<b>Détail tarifaire source</b> · ${parts.join(' · ')}`;
        const offerBox=card.querySelector('.v8-offer-box');if(offerBox)offerBox.insertAdjacentElement('afterend',box);
      }
    }
  }
  function addAccessNote(card,physical){
    if(!physical?.access?.unknown||card.querySelector('.v8-access-unknown'))return;
    const note=document.createElement('div');note.className='v8-access-unknown small warn';note.style.cssText='margin:8px 0';note.textContent='Horaires d’accès non fournis par la source — accès à vérifier.';
    const route=card.querySelector('.routeinfo');if(route)route.insertAdjacentElement('afterend',note);
  }
  function decorateCard(card){
    if(card.dataset.tccIntegrity===VERSION)return;
    const box=card.querySelector('.v8-offer-box');if(!box)return;
    const time=document.getElementById('simTime')?.value||'00:00';
    const rows=[...box.querySelectorAll('.v8-offer-row')];if(!rows.length)return;
    const info=cardInfo(card),physical=(prepared||[]).find(st=>normId(st?.id||st?.catalogStationId)===info.id);
    const meta=[];
    let electraAmbiguous=false;
    for(const row of rows){
      const provider=cleanProvider(row.querySelector('.v8-offer-provider')?.textContent);
      if(/^Electra\+/i.test(provider)){meta.push({row,provider,total:totalFromRow(row),subscription:true});continue;}
      const matches=configsFor(card,provider),bySig=new Map();for(const x of matches){const sig=pricingSig(x.pricing);if(sig&&!bySig.has(sig))bySig.set(sig,x);}
      const unique=[...bySig.values()],ambiguous=unique.length>1;
      if(ambiguous&&/^Electra$/i.test(provider))electraAmbiguous=true;
      const chosen=unique.length===1?unique[0]:null;
      if(chosen){const el=row.querySelector('.v8-offer-price');if(el)el.textContent=tariffLabel(chosen.pricing,time);}
      meta.push({row,provider,total:totalFromRow(row),chosen,ambiguous});
    }
    if(electraAmbiguous){for(const m of meta){if(m.subscription&&/^Electra\+/i.test(m.provider))m.ambiguous=true;}}
    const grouped=new Map();
    for(const m of meta.filter(x=>x.ambiguous)){const key=norm(x.provider.replace(/^Electra\+.*/i,'Electra'));if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(m);}
    for(const group of grouped.values()){
      const first=group[0];for(const m of group.slice(1))m.row.remove();
      first.row.classList.remove('best');first.row.classList.add('v8-offer-ambiguous');first.row.style.borderColor='#8a6b28';
      const p=first.row.querySelector('.v8-offer-provider');if(p){p.querySelectorAll('.v8-offer-best').forEach(x=>x.remove());p.textContent=first.provider.startsWith('Electra+')?'Electra+':'Electra';}
      const pr=first.row.querySelector('.v8-offer-price');if(pr)pr.textContent='Tarifs source multiples non attribués à cette prise';
      const tot=first.row.querySelector('.v8-offer-total');if(tot)tot.textContent='non classé';
    }
    const eligible=meta.filter(m=>!m.ambiguous&&m.row.isConnected&&Number.isFinite(m.total));
    const min=eligible.length?Math.min(...eligible.map(m=>m.total)):NaN,ties=eligible.filter(m=>Math.abs(m.total-min)<.01);
    for(const m of meta){if(m.row.isConnected)setBest(m.row,Number.isFinite(min)&&!m.ambiguous&&Math.abs(m.total-min)<.01,ties.length>1);}
    const winner=eligible.sort((a,b)=>a.total-b.total)[0];
    if(winner)updateSummary(card,winner.chosen,winner.total,time);
    addAccessNote(card,physical);
    card.dataset.tccIntegrity=VERSION;
  }
  function decorate(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(decorateCard);}
  function installObserver(){
    const root=document.getElementById('results');if(!root||root.__tccIntegrityObserver)return false;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorate,420);});obs.observe(root,{childList:true,subtree:true,characterData:true});root.__tccIntegrityObserver=obs;setTimeout(decorate,500);return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;const a=installCandidateCapture(),b=installUnknownAccess(),c=installObserver();if((a&&b&&c)||tries>200)clearInterval(timer);},100);
  console.info('[TCC V8] Intégrité source-first active : tarifs détaillés, frais après fin de charge, offres ambiguës exclues, horaires inconnus signalés.');
})();
