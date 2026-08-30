(async function(){
  'use strict';
  const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=$('status'),stationsEl=$('stations'),summary=$('summary'),subsEl=$('subs');
  let engine=null,selectedSubscriptions=new Set();
  function setStatus(message,kind=''){status.className=kind||'muted';status.textContent=message;}
  function maxPower(st){let m=0;for(const e of st.evses||[])for(const c of e.connectors||[])m=Math.max(m,Number(c.powerKw||0));return m;}
  function priceLabel(o){const p=o.pricing||{};if(p.pricePerKwh!=null)return `${Number(p.pricePerKwh).toFixed(3)} ${o.currency||'EUR'}/kWh`;const rs=p.rules||[];const vals=[...new Set(rs.map(r=>r.pricePerKwh).filter(v=>v!=null))];return vals.length?`${vals.map(v=>Number(v).toFixed(3)).join(' / ')} ${o.currency||'EUR'}/kWh`:p.type||'prix exact requis';}
  function renderSubscriptions(subscriptions){
    subsEl.innerHTML=subscriptions?.length?subscriptions.map(s=>`<label class="chip"><input type="checkbox" data-sub="${esc(s.id)}" ${selectedSubscriptions.has(s.id)?'checked':''}> ${esc(s.provider)} · ${s.countryCount??'global'} pays</label>`).join(''):'<span class="muted">Aucun abonnement pour ce filtre.</span>';
    subsEl.querySelectorAll('[data-sub]').forEach(el=>el.addEventListener('change',()=>{if(el.checked)selectedSubscriptions.add(el.dataset.sub);else selectedSubscriptions.delete(el.dataset.sub);$('selectedSummary').textContent=selectedSubscriptions.size?`${selectedSubscriptions.size} abonnement(s) sélectionné(s) · relance le chargement pour appliquer les tarifs.`:'Aucun abonnement sélectionné.';}));
    $('selectedSummary').textContent=selectedSubscriptions.size?`${selectedSubscriptions.size} abonnement(s) sélectionné(s).`:'Aucun abonnement sélectionné.';
  }
  function offerHtml(o){return`<div class="offer">${esc(o.provider)} — ${esc(o.kind)} — ${esc(priceLabel(o))}${o.subscriptionId?' · abonnement':''}${o.metadata?.crossBorderResolved?' · cross-border':''}${o.metadata?.verified?' · vérifié':''}</div>`;}
  function advisoryHtml(o){const reason=o.metadata?.reason?` · ${esc(o.metadata.reason)}`:'';return`<div class="offer muted">ℹ ${esc(o.provider)} — ${esc(priceLabel(o))} · indicatif, non classable${reason}</div>`;}
  function render(area){
    const stations=area.stations||[];summary.textContent=`${stations.length} stations · ${area.operators?.length||0} opérateurs · ${area.subscriptions?.length||0} abonnements · ${area.selectedSubscriptions?.length||0} sélectionné(s)`;
    renderSubscriptions(area.subscriptions||[]);
    stationsEl.innerHTML=stations.slice(0,100).map(st=>`<div class="station"><strong>${esc(st.name)}</strong><div class="muted">${esc(st.physicalOperator?.name)} · ${maxPower(st)} kW · ${esc(st.status?.state||'unknown')}</div>${(st.rankableOffers||st.eligibleOffers||st.offers||[]).map(offerHtml).join('')}${(st.subscriptionAdvisories||[]).map(advisoryHtml).join('')}</div>`).join('')||'<span class="muted">Aucune station.</span>';
  }
  try{
    const [registry,policy,fastned,ionity]=await Promise.all([
      fetch('../data/v9/source-registry.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`registre ${r.status}`);return r.json();}),
      fetch('../data/v9/germany-cross-border-subscriptions.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`politique cross-border ${r.status}`);return r.json();}),
      fetch('../data/v9/fastned-gold-country-prices.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`matrice Fastned ${r.status}`);return r.json();}),
      fetch('../data/v9/ionity-monthly-country-prices.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`matrice IONITY ${r.status}`);return r.json();})
    ]);
    const adapters={
      teslaJson:window.TCCV9Adapters.teslaJson,
      nationalCompact:window.TCCV9Adapters.nationalCompact,
      directOffers:window.TCCV9Adapters.directOffers,
      legacyDirectTariffs:window.TCCV9Adapters.legacyDirectTariffs,
      legacyDirectStations:window.TCCV9Adapters.legacyDirectStations,
      franceEmspCompact:window.TCCV9Adapters.franceEmspCompact,
      franceCrosswalk:window.TCCV9Adapters.franceCrosswalk,
      franceIrveStatus:window.TCCV9Adapters.franceIrveStatus
    };
    const loaders=window.TCCV9BrowserLoaders.createRegistryLoaders({registry,basePath:'..',adapters});
    engine=window.TCCV9RuntimeEngine.createEngine({registry,loaders,crossBorderPricing:{policy,fastned,ionity}});
    setStatus(`Moteur V9 prêt · ${Object.keys(loaders).length} sources navigateur actives · résolution cross-border active en preview.`,'ok');
  }catch(err){setStatus(`Initialisation impossible : ${err.message}`,'err');return;}
  $('country').addEventListener('change',()=>{if($('country').value==='NL'){$('lat').value='51.4416';$('lon').value='5.4697';}else{$('lat').value='48.798';$('lon').value='2.061';}});
  $('load').addEventListener('click',async()=>{
    try{
      setStatus('Chargement des sources et fusion V9…');stationsEl.innerHTML='';
      const countryCode=$('country').value,lat=Number($('lat').value),lon=Number($('lon').value),radiusKm=Number($('radius').value||15);
      const countryCodes=$('subCountries').value.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
      const area=await engine.queryArea({countryCode,origin:{lat,lon},radiusKm,filters:{},selectedSubscriptions:[...selectedSubscriptions],subscriptionFilters:{minCountries:Number($('minCountries').value||1),countryCodes,coverageMode:'all'}});
      render(area);setStatus(`Fusion terminée. ${area.diagnostics?.errors?.length||0} erreur(s) source.`,(area.diagnostics?.errors?.length||0)?'err':'ok');
    }catch(err){setStatus(`Erreur : ${err.message}`,'err');}
  });
})();
