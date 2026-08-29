(async function(){
  'use strict';
  const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=$('status'),stationsEl=$('stations'),summary=$('summary'),subsEl=$('subs');
  let engine=null;
  function setStatus(message,kind=''){status.className=kind||'muted';status.textContent=message;}
  function maxPower(st){let m=0;for(const e of st.evses||[])for(const c of e.connectors||[])m=Math.max(m,Number(c.powerKw||0));return m;}
  function priceLabel(o){const p=o.pricing||{};if(p.pricePerKwh!=null)return `${Number(p.pricePerKwh).toFixed(3)} €/kWh`;const rs=p.rules||[];const vals=[...new Set(rs.map(r=>r.pricePerKwh).filter(v=>v!=null))];return vals.length?`${vals.map(v=>Number(v).toFixed(3)).join(' / ')} €/kWh`:p.type||'tarif complexe';}
  function render(area){
    const stations=area.rankedStations||area.stations||[];summary.textContent=`${(area.stations||[]).length} stations · ${area.operators?.length||0} opérateurs · ${area.subscriptions?.length||0} abonnements · ${area.diagnostics?.sessionComparableStationCount||0} stations tarifables`;
    subsEl.innerHTML=area.subscriptions?.length?area.subscriptions.map(s=>`<span class="chip">${esc(s.provider)} · ${s.countryCount==null?'global':s.countryCount+' pays'}</span>`).join(''):'<span class="muted">Aucun abonnement pour ce filtre.</span>';
    stationsEl.innerHTML=stations.slice(0,100).map(st=>{const ev=area.sessionEvaluations?.[st.id],best=ev?.best;return `<div class="station"><strong>${esc(st.name)}</strong><div class="muted">${esc(st.physicalOperator?.name)} · ${maxPower(st)} kW · ${esc(st.status?.state||'unknown')}</div>${best?`<div class="best">Meilleur : ${esc(best.provider)}${best.subscriptionId?' · '+esc(best.subscriptionId):''} · ${Number(best.total).toFixed(2)} ${esc(best.targetCurrency)}${best.costPerRecoveredKm!=null?' · '+Number(best.costPerRecoveredKm).toFixed(4)+' €/km récupéré':''}</div>`:'<div class="best muted">Aucune offre comparable pour cette session</div>'}${(st.offers||[]).map(o=>`<div class="offer">${esc(o.provider)} — ${esc(o.kind)} — ${esc(priceLabel(o))}${o.subscriptionId?' · abonnement':''}${o.metadata?.verified?' · vérifié':''}</div>`).join('')}</div>`;}).join('')||'<span class="muted">Aucune station.</span>';
  }
  try{
    const registry=await fetch('../data/v9/source-registry.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`registre ${r.status}`);return r.json();});
    const adapters={teslaJson:window.TCCV9Adapters.teslaJson,nationalCompact:window.TCCV9Adapters.nationalCompact,directOffers:window.TCCV9Adapters.directOffers,legacyDirectTariffs:window.TCCV9Adapters.legacyDirectTariffs,legacyDirectStations:window.TCCV9Adapters.legacyDirectStations,franceEmspCompact:window.TCCV9Adapters.franceEmspCompact,franceCrosswalk:window.TCCV9Adapters.franceCrosswalk,franceIrveStatus:window.TCCV9Adapters.franceIrveStatus};
    const loaders=window.TCCV9BrowserLoaders.createRegistryLoaders({registry,basePath:'..',adapters});
    engine=window.TCCV9RuntimeEngine.createEngine({registry,loaders});
    setStatus(`Moteur V9 prêt · ${Object.keys(loaders).length} sources navigateur actives.`,'ok');
  }catch(err){setStatus(`Initialisation impossible : ${err.message}`,'err');return;}
  $('country').addEventListener('change',()=>{if($('country').value==='NL'){$('lat').value='51.4416';$('lon').value='5.4697';}else{$('lat').value='48.798';$('lon').value='2.061';}});
  $('load').addEventListener('click',async()=>{
    try{
      setStatus('Chargement, fusion et simulation V9…');stationsEl.innerHTML='';
      const countryCode=$('country').value,lat=Number($('lat').value),lon=Number($('lon').value),radiusKm=Number($('radius').value||15);
      const countryCodes=$('subCountries').value.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
      const selectedSubscriptions=$('selectedSubscriptions').value.split(',').map(x=>x.trim()).filter(Boolean);
      const area=await engine.queryArea({countryCode,origin:{lat,lon},radiusKm,filters:{},subscriptionFilters:{minCountries:Number($('minCountries').value||1),countryCodes,coverageMode:'all'},selectedSubscriptions,session:{energyKwh:Number($('energy').value||0),consumptionKwhPer100Km:Number($('consumption').value||15),targetCurrency:'EUR'},sortBy:$('sortBy').value});
      render(area);setStatus(`Fusion et simulation terminées. ${area.diagnostics?.errors?.length||0} erreur(s) source.`,(area.diagnostics?.errors?.length||0)?'err':'ok');
    }catch(err){setStatus(`Erreur : ${err.message}`,'err');}
  });
})();