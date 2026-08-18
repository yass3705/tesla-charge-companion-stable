// Tesla Charge Companion V8 RC4.8 — affichage tarifaire source-first.
// Les composantes tarifaires sont capturées directement sur les lignes simulées,
// puis transportées jusqu'à la carte résultat. Aucun rechargement/recherche de station.
(function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).toLowerCase().replace(/\s+/g,' ');
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
  const fmt=(v,d=3)=>Number(v||0).toFixed(d).replace(/0+$/,'').replace(/\.$/,'');

  function providerFromStation(st){
    const label=text(st?.configurationLabel);
    const m=label.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    return m?.[1]?.trim()||text(st?.offerProvider)||text(st?.operator)||'Tarif disponible';
  }
  function normalizeProvider(v){return text(v).replace(/\s*✓.*$/,'').replace(/\s+abonnement.*$/i,'').trim();}
  function normalizeId(v){return text(v).replace(/^france-catalog:/i,'').split('::')[0];}
  function aliases(st){
    return [...new Set([st?.catalogStationId,st?.baseStationId,st?.stationId,st?.sourceStationId,st?.id].map(normalizeId).filter(Boolean))];
  }
  function physicalKey(row){
    const st=row?.st||{};
    const base=normalizeId(st.catalogStationId)||normalizeId(st.baseStationId)||normalizeId(st.id);
    const power=Number(st.powerKw||0);
    return `${base}|${text(st.kind).toUpperCase()}|${Number.isFinite(power)?power.toFixed(2):'0'}`;
  }
  function sourceOffer(row){
    return {
      provider:providerFromStation(row?.st),
      total:Number.isFinite(row?.r?.total)?Number(row.r.total):null,
      pricing:row?.st?.pricing||null,
      pricingDetails:row?.r?.pricingDetails||null,
      configurationId:row?.st?.configurationId||null,
      configurationLabel:row?.st?.configurationLabel||'',
      kind:text(row?.st?.kind).toUpperCase(),
      power:Number(row?.st?.powerKw||0)
    };
  }
  function groupFromVariants(variants,winner){
    const st=winner?.st||variants?.[0]?.st||{};
    return {
      key:physicalKey(winner||variants?.[0]),
      aliases:aliases(st),
      kind:text(st.kind).toUpperCase(),
      power:Number(st.powerKw||0),
      winnerProvider:providerFromStation(st),
      offers:(variants||[]).map(sourceOffer)
    };
  }

  function installRankingCapture(){
    const current=window.rankByPriceDistance;
    if(typeof current!=='function'||current.__tccSourceFirstCaptured)return false;
    const wrapped=function(rows,mode){
      const raw=Array.isArray(rows)?rows:[];
      const groups=new Map();
      for(const row of raw){const k=physicalKey(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
      const ranked=current.apply(this,arguments);
      const list=Array.isArray(ranked)?ranked:[];
      window.TCC_SOURCE_FIRST_GROUPS=list.map(row=>groupFromVariants(groups.get(physicalKey(row))||[row],row));
      window.TCC_SOURCE_FIRST_CAPTURED_AT=Date.now();
      return ranked;
    };
    wrapped.__tccSourceFirstCaptured=true;
    wrapped.__tccOriginal=current;
    window.rankByPriceDistance=wrapped;
    try{rankByPriceDistance=wrapped}catch(e){}
    return true;
  }

  function activeRule(pricing,time){
    try{
      if(!pricing||typeof legacyPricingToRules!=='function'||typeof ruleForMinute!=='function'||typeof mins!=='function')return null;
      return ruleForMinute(legacyPricingToRules(pricing)||[],mins(time));
    }catch(e){return null;}
  }
  function tariffLabel(pricing,time){
    const rule=activeRule(pricing,time);if(!rule)return 'Tarif non disponible';
    const c=text(rule.currency||'EUR').toUpperCase(),parts=[];
    if(Number(rule.pricePerKwh||0)>0)parts.push(`${fmt(rule.pricePerKwh)} ${c}/kWh`);
    if(Number(rule.chargePerMinute||0)>0)parts.push(`${fmt(rule.chargePerMinute)} ${c}/min`);
    if(Number(rule.connectionFee||0)>0)parts.push(`${fmt(rule.connectionFee,2)} ${c} fixe`);
    if(Number(rule.idlePerMinute||0)>0)parts.push(`${fmt(rule.idlePerMinute)} ${c}/min occupation`);
    if(Number(rule.afterMinutesRate||0)>0&&Number(rule.afterMinutesThreshold||0)>0)parts.push(`${fmt(rule.afterMinutesRate)} ${c}/min après ${Math.round(Number(rule.afterMinutesThreshold))} min`);
    if(rule.billing==='powerMinute'&&!parts.length)parts.push(`tarif/min selon puissance (${c})`);
    if(rule.scope==='timeWindow'&&(rule.start||rule.end))parts.push(`créneau ${rule.start||'00:00'}–${rule.end||'24:00'}`);
    return parts.length?parts.join(' + '):'Tarif variable';
  }
  function cardInfo(card){
    const id=normalizeId(card?.dataset?.resultId);
    const h=text(card?.querySelector('h3')?.textContent);
    const m=h.match(/—\s*(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return{id,kind:m?.[1]?.toUpperCase()||'',power:m?Number(m[2].replace(',','.')):0};
  }
  function mainCost(card){
    const t=text(card?.querySelector('.cost')?.textContent).replace(/\u00a0/g,' ');
    const m=t.match(/-?\d[\d\s]*(?:[.,]\d+)?/);if(!m)return null;
    const n=Number(m[0].replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;
  }
  function minSourceCost(group){
    const vals=(group?.offers||[]).map(o=>o.total).filter(Number.isFinite);return vals.length?Math.min(...vals):null;
  }
  function findGroup(card,index,used){
    const groups=window.TCC_SOURCE_FIRST_GROUPS||[],info=cardInfo(card);
    let hit=groups.find((g,i)=>!used.has(i)&&g.kind===info.kind&&Math.abs(Number(g.power||0)-info.power)<.25&&g.aliases.includes(info.id));
    if(hit)return{group:hit,index:groups.indexOf(hit)};
    const ordered=groups[index];
    if(ordered&&!used.has(index)&&ordered.kind===info.kind&&Math.abs(Number(ordered.power||0)-info.power)<.25){
      const a=mainCost(card),b=minSourceCost(ordered);
      if(a==null||b==null||Math.abs(a-b)<.05)return{group:ordered,index};
    }
    return null;
  }
  function findOffer(group,provider,rowCost){
    const p=norm(normalizeProvider(provider));
    let candidates=(group?.offers||[]).filter(o=>norm(o.provider)===p);
    if(!candidates.length)return null;
    if(candidates.length===1||!Number.isFinite(rowCost))return candidates[0];
    return candidates.slice().sort((a,b)=>Math.abs((a.total??Infinity)-rowCost)-Math.abs((b.total??Infinity)-rowCost))[0];
  }
  function rowCost(row){
    const t=text(row?.querySelector('.v8-offer-total')?.textContent).replace(/\u00a0/g,' ');
    const m=t.match(/-?\d[\d\s]*(?:[.,]\d+)?/);if(!m)return null;
    const n=Number(m[0].replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;
  }
  function breakdownParts(pd){
    if(!pd)return[];
    const duration=Number(pd.timeChargeCost||0);
    const charge=Number(pd.chargeCost||0);
    const energy=Math.max(0,charge-duration);
    const parts=[];
    if(energy>0.005)parts.push(`énergie ${euro(energy)}`);
    if(duration>0.005)parts.push(`durée ${euro(duration)}`);
    if(Number(pd.connection||0)>0.005)parts.push(`connexion ${euro(pd.connection)}`);
    if(Number(pd.idleCost||0)>0.005)parts.push(`occupation/après charge ${euro(pd.idleCost)}`);
    if(Number(pd.durationSurcharge||0)>0.005)parts.push(`après durée ${euro(pd.durationSurcharge)}`);
    if(Number(pd.congestionCost||0)>0.005)parts.push(`congestion ${euro(pd.congestionCost)}`);
    return parts;
  }
  function updateMainTariff(card,label){
    if(!label)return;
    for(const el of card.querySelectorAll('.small')){
      if(/Tarif\s*:/i.test(text(el.textContent))){const b=el.querySelector('b');if(b)b.textContent=label;break;}
    }
  }
  function decorateCard(card,group){
    const time=document.getElementById('simTime')?.value||'00:00';
    let bestSource=null;
    for(const row of card.querySelectorAll('.v8-offer-row')){
      const provider=normalizeProvider(row.querySelector('.v8-offer-provider')?.textContent);
      if(!provider||/^Electra\+/i.test(provider))continue;
      const offer=findOffer(group,provider,rowCost(row));if(!offer)continue;
      const price=row.querySelector('.v8-offer-price');if(price)price.textContent=tariffLabel(offer.pricing,time);
      if(row.classList.contains('best'))bestSource=offer;
    }
    if(bestSource)updateMainTariff(card,tariffLabel(bestSource.pricing,time));
    card.querySelector('.v8-source-breakdown')?.remove();
    if(bestSource){
      const parts=breakdownParts(bestSource.pricingDetails);
      if(parts.length){
        const box=document.createElement('div');box.className='v8-source-breakdown small';
        box.style.cssText='margin:8px 0;padding:9px 11px;border:1px solid #2d2d31;border-radius:10px;color:#b9b9c0';
        box.innerHTML=`<b>Détail tarifaire</b> · ${parts.join(' · ')}`;
        const offerBox=card.querySelector('.v8-offer-box');if(offerBox)offerBox.insertAdjacentElement('afterend',box);
      }
    }
  }
  function decorate(){
    const cards=[...document.querySelectorAll('#results .result-card[data-result-id]')];
    if(!cards.length||!(window.TCC_SOURCE_FIRST_GROUPS||[]).length)return;
    const used=new Set();
    cards.forEach((card,i)=>{const hit=findGroup(card,i,used);if(hit){used.add(hit.index);decorateCard(card,hit.group);}});
  }
  function installObserver(){
    const root=document.getElementById('results');if(!root||root.__tccSourceFirstObserver)return false;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorate,120);});
    obs.observe(root,{childList:true,subtree:true,characterData:true});root.__tccSourceFirstObserver=obs;decorate();return true;
  }

  let tries=0;const timer=setInterval(()=>{
    tries++;
    const a=installRankingCapture(),b=installObserver();
    if((a&&b)||tries>180)clearInterval(timer);
  },100);
  console.info('[TCC V8] Tarifs source-first transportés depuis les résultats simulés.');
})();
