// Tesla Charge Companion V8 — tarifs composés énergie + durée + fixe.
// Corrige le calcul sans toucher aux données sources et enrichit l'affichage
// avec les composantes commerciales de chaque offre.
(function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const euro=v=>Number.isFinite(v)?new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(v):'—';

  function installPricingFix(){
    const original=window.priceWithRules;
    if(typeof original!=='function'||original.__tccCombinedTariffFix)return false;
    const src=Function.prototype.toString.call(original);
    const alreadyFixed=src.includes("raw=energyPerMinute*fraction*(rule.pricePerKwh||0)+fraction*(rule.chargePerMinute||0)");
    if(alreadyFixed)return true;

    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const out=original.call(this,pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments);
      if(!out||out.error||!Number.isFinite(out.total))return out;
      let extra=0;
      try{
        const rules=pp?.rules||[];
        for(let i=0;i<Math.ceil(chargeMinutes);i++){
          const fraction=Math.min(1,chargeMinutes-i);
          const minute=typeof window.minuteOfSession==='function'?window.minuteOfSession(startMin,i):(startMin+i)%1440;
          const rule=typeof window.ruleForMinute==='function'?window.ruleForMinute(rules,minute):null;
          if(!rule||rule.billing!=='kwh')continue;
          const rate=Number(rule.chargePerMinute||0);
          if(!(rate>0))continue;
          const raw=fraction*rate;
          extra+=typeof window.fxToEur==='function'?window.fxToEur(raw,rule.currency||'EUR'):raw;
        }
      }catch(err){console.warn('[TCC V8] Frais à la minute non ajoutés :',err);return out;}
      if(extra>0){
        out.total+=extra;
        out.chargeCost=Number(out.chargeCost||0)+extra;
        out.timeChargeCost=Number(out.timeChargeCost||0)+extra;
      }
      return out;
    };
    wrapped.__tccCombinedTariffFix=true;
    wrapped.__tccOriginal=original;
    window.priceWithRules=wrapped;
    try{priceWithRules=wrapped}catch(e){}
    return true;
  }

  function providerFromStation(st){
    const label=text(st?.configurationLabel);
    const m=label.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    return m?.[1]?.trim()||text(st?.offerProvider)||text(st?.operator)||'';
  }
  function physicalId(st){return text(st?.baseStationId)||text(st?.catalogStationId)||text(st?.id).split('::')[0];}
  function cardKindPower(card){
    const h=text(card.querySelector('h3')?.textContent);
    const m=h.match(/—\s*(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return m?{kind:m[1].toUpperCase(),power:Number(m[2].replace(',','.'))}:{kind:'',power:0};
  }
  function normalizeProvider(v){return text(v).replace(/\s*✓.*$/,'').replace(/\s+abonnement.*$/i,'').trim();}
  function findVariant(card,provider){
    const resultId=text(card.dataset.resultId);
    const {kind,power}=cardKindPower(card);
    const all=window.TCC_V8_AREA_CACHE?.prepared?.stations||[];
    return all.find(st=>{
      if(physicalId(st)!==resultId)return false;
      if(kind&&text(st.kind).toUpperCase()!==kind)return false;
      if(power&&Math.abs(Number(st.powerKw||0)-power)>.2)return false;
      return providerFromStation(st).toLowerCase()===normalizeProvider(provider).toLowerCase();
    })||null;
  }
  function activeRule(st,time){
    if(!st||typeof window.legacyPricingToRules!=='function'||typeof window.ruleForMinute!=='function'||typeof window.mins!=='function')return null;
    const rules=window.legacyPricingToRules(st.pricing)||[];
    return window.ruleForMinute(rules,window.mins(time));
  }
  function commercialLabel(rule){
    if(!rule)return'';
    const c=text(rule.currency||'EUR').toUpperCase();
    const parts=[];
    if(Number(rule.pricePerKwh||0)>0)parts.push(`${Number(rule.pricePerKwh).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/kWh`);
    if(Number(rule.chargePerMinute||0)>0)parts.push(`${Number(rule.chargePerMinute).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min`);
    if(Number(rule.connectionFee||0)>0)parts.push(`${Number(rule.connectionFee).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')} ${c} fixe`);
    if(Number(rule.idlePerMinute||0)>0)parts.push(`${Number(rule.idlePerMinute).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min après charge`);
    return parts.join(' + ');
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
  function parseBilledEnergy(card){
    const m=text(card.textContent).match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);
    return m?Number(m[1].replace(',','.')):0;
  }
  function componentCosts(st,time,minutes,kwh){
    if(!st||!(minutes>=0)||!(kwh>=0)||typeof window.legacyPricingToRules!=='function'||typeof window.ruleForMinute!=='function'||typeof window.mins!=='function')return null;
    const rules=window.legacyPricingToRules(st.pricing)||[];
    const start=window.mins(time),energyPerMinute=minutes>0?kwh/minutes:0;
    let energy=0,duration=0,connection=0;
    try{
      const startRule=window.ruleForMinute(rules,start);if(!startRule)return null;
      const fx=(raw,c)=>typeof window.fxToEur==='function'?window.fxToEur(raw,c||'EUR'):raw;
      connection=fx(Number(startRule.connectionFee||0),startRule.currency||'EUR');
      for(let i=0;i<Math.ceil(minutes);i++){
        const fraction=Math.min(1,minutes-i),minute=typeof window.minuteOfSession==='function'?window.minuteOfSession(start,i):(start+i)%1440;
        const rule=window.ruleForMinute(rules,minute);if(!rule)continue;
        if(rule.billing==='kwh'){
          energy+=fx(energyPerMinute*fraction*Number(rule.pricePerKwh||0),rule.currency||'EUR');
          duration+=fx(fraction*Number(rule.chargePerMinute||0),rule.currency||'EUR');
        }
      }
      return{energy,duration,connection};
    }catch(e){return null;}
  }
  function decorateCard(card){
    const time=document.getElementById('simTime')?.value||'00:00';
    const rows=[...card.querySelectorAll('.v8-offer-row')];
    for(const row of rows){
      const provider=normalizeProvider(row.querySelector('.v8-offer-provider')?.textContent);
      if(!provider||/^Electra\+/i.test(provider))continue;
      const st=findVariant(card,provider),label=commercialLabel(activeRule(st,time));
      if(label){const el=row.querySelector('.v8-offer-price');if(el)el.textContent=label;}
    }

    const best=card.querySelector('.v8-offer-row.best');
    const bestProvider=normalizeProvider(best?.querySelector('.v8-offer-provider')?.textContent);
    const bestStation=bestProvider&&!/^Electra\+/i.test(bestProvider)?findVariant(card,bestProvider):null;
    const bestLabel=commercialLabel(activeRule(bestStation,time));
    if(bestLabel){
      for(const el of card.querySelectorAll('.small')){
        if(/Tarif\s*:/i.test(text(el.textContent))){const b=el.querySelector('b');if(b)b.textContent=bestLabel;break;}
      }
    }

    card.querySelector('.v8-component-breakdown')?.remove();
    const mins=parseChargeMinutes(card),kwh=parseBilledEnergy(card),costs=componentCosts(bestStation,time,mins,kwh);
    if(costs&&(costs.duration>0||costs.connection>0)){
      const box=document.createElement('div');box.className='v8-component-breakdown small';
      box.style.cssText='margin:8px 0;padding:9px 11px;border:1px solid #2d2d31;border-radius:10px;color:#b9b9c0';
      const parts=[];
      if(costs.energy>0)parts.push(`énergie ${euro(costs.energy)}`);
      if(costs.duration>0)parts.push(`durée ${euro(costs.duration)}`);
      if(costs.connection>0)parts.push(`connexion ${euro(costs.connection)}`);
      box.innerHTML=`<b>Détail tarifaire</b> · ${parts.join(' · ')}`;
      const offer=card.querySelector('.v8-offer-box');
      if(offer)offer.insertAdjacentElement('afterend',box);else card.querySelector('.station-head')?.insertAdjacentElement('afterend',box);
    }
  }
  function decorate(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(decorateCard);}
  function installObserver(){
    const root=document.getElementById('results');if(!root||root.__tccCombinedObserver)return false;
    let timer=null;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorate,40);});
    observer.observe(root,{childList:true,subtree:true,characterData:true});root.__tccCombinedObserver=observer;decorate();return true;
  }

  let attempts=0;const timer=setInterval(()=>{
    attempts++;const a=installPricingFix(),b=installObserver();
    if((a&&b)||attempts>180)clearInterval(timer);
  },100);
  console.info('[TCC V8] Tarifs composés énergie + durée + fixe activés.');
})();
