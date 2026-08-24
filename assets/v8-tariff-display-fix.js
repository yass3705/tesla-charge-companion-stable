// Tesla Charge Companion V8 — affichage robuste des composantes tarifaires.
(function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

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
  function nameScore(a,b){
    const aa=norm(a),bb=norm(b);if(!aa||!bb)return 0;if(aa===bb)return 1;
    const A=new Set(aa.split(' ').filter(x=>x.length>1)),B=new Set(bb.split(' ').filter(x=>x.length>1));
    if(!A.size||!B.size)return 0;
    let hit=0;for(const x of A)if(B.has(x))hit++;
    return hit/Math.max(A.size,B.size);
  }
  function idMatches(card,st){
    const cardId=normId(card.dataset.resultId);
    const ids=[st?.baseStationId,st?.catalogStationId,st?.id].map(normId).filter(Boolean);
    return !!cardId&&ids.some(id=>id===cardId||id.endsWith(cardId)||cardId.endsWith(id));
  }
  function findVariant(card,provider){
    const info=cardInfo(card),wanted=norm(normalizeProvider(provider));
    const all=window.TCC_V8_AREA_CACHE?.prepared?.stations||[];
    const eligible=all.filter(st=>{
      if(info.kind&&text(st?.kind).toUpperCase()!==info.kind)return false;
      if(info.power&&Math.abs(Number(st?.powerKw||0)-info.power)>.25)return false;
      return norm(providerFromStation(st))===wanted;
    });
    if(!eligible.length)return null;
    const byId=eligible.find(st=>idMatches(card,st));if(byId)return byId;
    const exactName=eligible.find(st=>norm(st?.name)===norm(info.name));if(exactName)return exactName;
    const ranked=eligible.map(st=>({st,score:nameScore(st?.name,info.name)})).sort((a,b)=>b.score-a.score);
    if(ranked[0]&&ranked[0].score>=0.45)return ranked[0].st;
    if(eligible.length===1)return eligible[0];
    return null;
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
    if(Number(rule.parkingPerMinute||0)>0)parts.push(`${Number(rule.parkingPerMinute).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min stationnement`);
    if(Number(rule.connectionFee||0)>0)parts.push(`${Number(rule.connectionFee).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')} ${c} fixe`);
    if(Number(rule.idlePerMinute||0)>0)parts.push(`${Number(rule.idlePerMinute).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min après charge`);
    return parts.join(' + ');
  }
  function directResolverRow(row,provider){
    return row?.classList?.contains('v8-direct-fallback-row')||/^(Chargezy direct|Pass Pass direct)/i.test(provider||'');
  }
  function decorateCard(card){
    const time=document.getElementById('simTime')?.value||'00:00';
    for(const row of card.querySelectorAll('.v8-offer-row')){
      const provider=normalizeProvider(row.querySelector('.v8-offer-provider')?.textContent);
      if(!provider||/^Electra\+/i.test(provider)||directResolverRow(row,provider))continue;
      const st=findVariant(card,provider),label=commercialLabel(activeRule(st,time));
      const price=row.querySelector('.v8-offer-price');
      if(price&&label&&text(price.textContent)!==label)price.textContent=label;
      if(!st)row.title='Détail tarifaire non associé à la configuration source';else row.removeAttribute('title');
    }

    const best=card.querySelector('.v8-offer-row.best');
    const bestProvider=normalizeProvider(best?.querySelector('.v8-offer-provider')?.textContent);
    const bestStation=bestProvider&&!/^Electra\+/i.test(bestProvider)&&!directResolverRow(best,bestProvider)?findVariant(card,bestProvider):null;
    const bestLabel=commercialLabel(activeRule(bestStation,time));
    if(bestLabel){
      for(const el of card.querySelectorAll('.small')){
        if(/Tarif\s*:/i.test(text(el.textContent))){const b=el.querySelector('b');if(b&&text(b.textContent)!==bestLabel)b.textContent=bestLabel;break;}
      }
    }
  }
  function decorate(){document.querySelectorAll('#results .result-card[data-result-id]').forEach(decorateCard);}
  function install(){
    const root=document.getElementById('results');if(!root)return false;
    if(!root.__tccTariffDisplayObserver){
      let timer=null;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorate,80);});
      observer.observe(root,{childList:true,subtree:true,characterData:true});root.__tccTariffDisplayObserver=observer;
    }
    decorate();return true;
  }
  let n=0;const timer=setInterval(()=>{n++;if(install()||n>180)clearInterval(timer);},100);
  window.TCCV8TariffDisplay={decorate,revision:'rc48au-offer-labels'};
  console.info('[TCC V8] Libellés tarifaires complets activés.');
})();
