// Tesla Charge Companion V8 — sélection du meilleur tarif par station physique + puissance.
// Les offres (Electroverse, Electra, abonnements futurs, opérateur direct futur)
// sont toutes simulées, mais une seule ligne est envoyée au classement.
(function(){
  function text(v){return String(v==null?'':v).trim();}
  function providerFromStation(st){
    const label=text(st?.configurationLabel);
    const match=label.match(/^(.+?)\s*·\s*(?:AC|DC)\b/i);
    if(match&&match[1])return match[1].trim();
    return text(st?.offerProvider)||text(st?.operator)||'Tarif disponible';
  }
  function physicalKey(row){
    const st=row?.st||{};
    const base=text(st.catalogStationId)||text(st.baseStationId)||text(st.id).split('::')[0];
    const power=Number(st.powerKw||0);
    return `${base}|${text(st.kind).toUpperCase()}|${Number.isFinite(power)?power.toFixed(2):'0'}`;
  }
  function finiteCost(row){return !row?.r?.unavailable&&!row?.r?.unknown&&Number.isFinite(row?.r?.total);}
  function cloneWinner(row,variants){
    const known=variants.filter(finiteCost).sort((a,b)=>a.r.total-b.r.total||providerFromStation(a.st).localeCompare(providerFromStation(b.st),'fr'));
    let winner=known[0]||variants.slice().sort((a,b)=>(a.distanceKm??Infinity)-(b.distanceKm??Infinity))[0];
    if(!winner)return null;
    const st={...winner.st};
    const offers=(known.length?known:variants).map(v=>({
      provider:providerFromStation(v.st),
      total:Number.isFinite(v?.r?.total)?v.r.total:null,
      configurationId:v?.st?.configurationId||null,
      configurationLabel:v?.st?.configurationLabel||''
    })).sort((a,b)=>(a.total??Infinity)-(b.total??Infinity)||a.provider.localeCompare(b.provider,'fr'));
    const uniqueProviders=[...new Set(offers.map(o=>o.provider).filter(Boolean))];
    const min=known.length?known[0].r.total:null;
    const cheapest=min==null?[]:[...new Set(known.filter(v=>Math.abs(v.r.total-min)<0.01).map(v=>providerFromStation(v.st)))];
    const power=Number(st.powerKw||0);
    const baseLabel=`${st.kind||''} ${Number.isFinite(power)?power:gPower(st)} kW`.trim();
    if(known.length>1){
      if(cheapest.length>1)st.configurationLabel=`${baseLabel} · meilleur tarif ex æquo ${cheapest.join(' / ')}`;
      else st.configurationLabel=`${baseLabel} · meilleur tarif ${cheapest[0]||providerFromStation(st)}`;
    }else if(known.length===1&&variants.length>1){
      st.configurationLabel=`${baseLabel} · tarif exploitable ${providerFromStation(st)}`;
    }
    st._offerComparison={count:variants.length,pricedCount:known.length,providers:uniqueProviders,cheapestProviders:cheapest,offers};
    return {...winner,st};
  }
  function gPower(st){const p=Number(st?.powerKw);return Number.isFinite(p)?p:0;}
  function collapseOfferVariants(rows){
    const groups=new Map();
    for(const row of rows||[]){
      const key=physicalKey(row);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(row);
    }
    return [...groups.values()].map(group=>cloneWinner(group[0],group)).filter(Boolean);
  }

  if(typeof rankByPriceDistance==='function'){
    const originalRank=rankByPriceDistance;
    rankByPriceDistance=function(rows,mode){
      const collapsed=collapseOfferVariants(rows);
      window.TCC_LAST_OFFER_GROUPING={raw:(rows||[]).length,collapsed:collapsed.length,groups:collapsed.map(x=>x.st?._offerComparison).filter(Boolean)};
      return originalRank(collapsed,mode);
    };
  }else console.warn('[TCC V8] rankByPriceDistance indisponible : regroupement des offres non activé.');

  // En V8 la synchronisation devient une fonction personnelle avancée :
  // elle ne doit synchroniser que les stations réellement créées par l’utilisateur.
  if(typeof customStationsForSync==='function'){
    customStationsForSync=function(){
      return stations.filter(st=>st?.source==='custom').map(st=>({...st,_syncUpdatedAt:stationSyncTime(st,st.lastUpdated?`${st.lastUpdated}T00:00:00Z`:'1970-01-01T00:00:00Z')}));
    };
  }
  if(typeof applyMergedCustomState==='function'){
    applyMergedCustomState=function(state){
      const cloud=parseCustomCloudData(state);
      const published=stations.filter(st=>st?.source!=='custom');
      const custom=cloud.stations.map(st=>normalizeStation({...st,source:st?.source||'custom'}));
      stations=[...published,...custom];
      saveCustomDeletions(cloud.deletedIds||{});saveLocal();renderStations();
    };
  }

  window.openAdvancedSync=function(){
    document.querySelectorAll('nav button,.panel').forEach(x=>x.classList.remove('active'));
    const panel=document.getElementById('sync');if(panel)panel.classList.add('active');
    if(typeof loadGithubSettingsForm==='function')loadGithubSettingsForm();
    window.scrollTo({top:0,behavior:'smooth'});
  };
  window.openSettingsPanel=function(){
    document.querySelectorAll('nav button,.panel').forEach(x=>x.classList.remove('active'));
    const button=document.querySelector('nav button[data-tab="fx"]');if(button)button.classList.add('active');
    const panel=document.getElementById('fx');if(panel)panel.classList.add('active');
    if(typeof renderFxRates==='function')renderFxRates();
    window.scrollTo({top:0,behavior:'smooth'});
  };

  window.TCCV8OfferSelection={collapseOfferVariants,providerFromStation};
  console.info('[TCC V8] Regroupement des offres par station physique + puissance activé.');
})();
