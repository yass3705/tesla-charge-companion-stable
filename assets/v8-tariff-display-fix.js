// Tesla Charge Companion V8 — affichage robuste des composantes tarifaires.
(function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const euro=v=>Number.isFinite(v)?new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(v):'—';

  function normId(v){
    return text(v).replace(/^france-catalog:/i,'').split('::')[0];
  }
  function providerFromStation(st){
    const label=text(st?.configurationLabel);
    const m=label.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    return m?.[1]?.trim()||text(st?.offerProvider)||text(st?.operator)||'';
  }
  function normalizeProvider(v){
    return text(v).replace(/\s*✓.*$/,'').replace(/\s+abonnement.*$/i,'').trim();
  }
  function cardInfo(card){
    const h=text(card.querySelector('h3')?.textContent).replace(/^\d+\.\s*/, '');
    const m=h.match(/^(.*?)\s+—\s+(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return m?{name:m[1].trim(),kind:m[2].toUpperCase(),power:Number(m[3].replace(',','.'))}:{name:h.split('—')[0].trim(),kind:'',power:0};
  }
  function samePhysical(card,st){
    const cardId=normId(card.dataset.resultId);
    const ids=[st?.baseStationId,st?.catalogStationId,st?.id].map(normId).filter(Boolean);
    if(cardId&&ids.some(id=>id===cardId||id.endsWith(cardId)||cardId.endsWith(id)))return true;
    const info=cardInfo(card);
    return !!info.name&&norm(st?.name)===norm(info.name);
  }
  function findVariant(card,provider){
    const info=cardInfo(card),wanted=norm(normalizeProvider(provider));
    const all=window.TCC_V8_AREA_CACHE?.prepared?.stations||[];
    const matches=all.filter(st=>{
      if(!samePhysical(card,st))return false;
      if(info.kind&&text(st?.kind).toUpperCase()!==info.kind)return false;
      if(info.power&&Math.abs(Number(st?.powerKw||0)-info.power)>.25)return false;
      return norm(providerFromStation(st))===wanted;
    });
    return matches[0]||null;
  }
  function activeRule(st,time){
    if(!st||typeof window.legacyPricingToRules!=='function'||typeof window.ruleForMinute!=='function'||typeof window.mins!=='function')return null;
    const rules=window.legacyPricingToRules(st.pricing)||[];
    return window.ruleForMinute(rules,window.mins(time));
  }
  function commercialLabel(rule){
    if(!rule)return'';
    const c=text(rule.currency||'EUR').toUpperCase(),parts=[];
    if(Number(rule.pricePerKwh||0)>0)parts.push(`${Number(rule.pricePerKwh).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/kWh`);
    if(Number(rule.chargePerMinute||0)>0)parts.push(`${Number(rule.chargePerMinute).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min`);
    if(Number(rule.connectionFee||0)>0)parts.push(`${Number(rule.connectionFee).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')} ${c} fixe`);
    if(Number(rule.idlePerMinute||0)>0)parts.push(`${Number(rule.idlePerMinute).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min après charge`);
    return parts.join(' + ');
  }
  function parseMinutes(card){
    const cells=[...card.querySelectorAll('.result-metrics>div')];
    const cell=cells.find(x=>/^Recharge$/i.test(text(x.querySelector('span')?.textContent)));
    const t=text(cell?.querySelector('b')?.textContent);if(!t)return 0;
    let total=0;const h=t.match(/(\d+)\s*h/i),m=t.match(/(\d+)\s*min/i);
    if(h)total+=Number(h[1])*60;if(m)total+=Number(m[1]);
    if(!h&&!m){const n=Number((t.match(/\d+/)||[])[0]);if(Number.isFinite(n))total=n;}
    return total;
  }
  function parseKwh(card){
    const m=text(card.textContent).match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);
    return m?Number(m[1].replace(',','.')):0;
  }
  function componentCosts(st,time,minutes,kwh){
    if(!st||typeof window.legacyPricingToRules!=='function'||typeof window.ruleForMinute!=='function'||typeof window.mins!=='function')return null;
    const rules=window.legacyPricingToRules(st.pricing)||[],start=window.mins(time),energyPerMinute=minutes>0?kwh/minutes:0;
    const fx=(raw,c)=>typeof window.fxToEur==='function'?window.fxToEur(raw,c||'EUR'):raw;
    const startRule=window.ruleForMinute(rules,start);if(!startRule)return null;
    let energy=0,duration=0,connection=fx(Number(startRule.connectionFee||0),startRule.currency||'EUR');
    for(let i=0;i<Math.ceil(minutes);i++){
      const fraction=Math.min(1,minutes-i),minute=typeof window.minuteOfSession==='function'?window.minuteOfSession(start,i):(start+i)%1440;
      const rule=window.ruleForMinute(rules,minute);if(!rule)continue;
      if(rule.billing==='kwh'){
        energy+=fx(energyPerMinute*fraction*Number(rule.pricePerKwh||0),rule.currency||'EUR');
        duration+=fx(fraction*Number(rule.chargePerMinute||0),rule.currency||'EUR');
      }
    }
    return{energy,duration,connection};
  }
  function decorateCard(card){
    const time=document.getElementById('simTime')?.value||'00:00';
    for(const row of card.querySelectorAll('.v8-offer-row')){
      const provider=normalizeProvider(row.querySelector('.v8-offer-provider')?.textContent);
      if(!provider||/^Electra\+/i.test(provider))continue;
      const st=findVariant(card,provider),label=commercialLabel(activeRule(st,time));
      const price=row.querySelector('.v8-offer-price');
      if(price&&label&&text(price.textContent)!==label)price.textContent=label;
    }

    const best=card.querySelector('.v8-offer-row.best');
    const bestProvider=normalizeProvider(best?.querySelector('.v8-offer-provider')?.textContent);
    const bestStation=bestProvider&&!/^Electra\+/i.test(bestProvider)?findVariant(card,bestProvider):null;
    const bestLabel=commercialLabel(activeRule(bestStation,time));
    if(bestLabel){
      for(const el of card.querySelectorAll('.small')){
        if(/Tarif\s*:/i.test(text(el.textContent))){const b=el.querySelector('b');if(b&&text(b.textContent)!==bestLabel)b.textContent=bestLabel;break;}
      }
    }

    const mins=parseMinutes(card),kwh=parseKwh(card),costs=componentCosts(bestStation,time,mins,kwh);
    let box=card.querySelector('.v8-component-breakdown');
    if(costs&&(costs.duration>0||costs.connection>0)){
      const parts=[];
      if(costs.energy>0)parts.push(`énergie ${euro(costs.energy)}`);
      if(costs.duration>0)parts.push(`durée ${euro(costs.duration)}`);
      if(costs.connection>0)parts.push(`connexion ${euro(costs.connection)}`);
      if(!box){box=document.createElement('div');box.className='v8-component-breakdown small';box.style.cssText='margin:8px 0;padding:9px 11px;border:1px solid #2d2d31;border-radius:10px;color:#b9b9c0';const offer=card.querySelector('.v8-offer-box');if(offer)offer.insertAdjacentElement('afterend',box);}
      if(box)box.innerHTML=`<b>Détail tarifaire</b> · ${parts.join(' · ')}`;
    }else if(box)box.remove();
  }
  function decorate(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(decorateCard);}
  function install(){
    const root=document.getElementById('results');if(!root)return false;
    if(!root.__tccTariffDisplayObserver){
      let timer=null;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorate,60);});
      observer.observe(root,{childList:true,subtree:true,characterData:true});root.__tccTariffDisplayObserver=observer;
    }
    decorate();return true;
  }
  let n=0;const timer=setInterval(()=>{n++;if(install()||n>180)clearInterval(timer);},100);
  console.info('[TCC V8] Affichage détaillé des tarifs activé.');
})();
