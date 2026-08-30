(async function(){
  'use strict';
  const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=$('status'),stationsEl=$('stations'),summary=$('summary'),subsEl=$('subs');
  let engine=null;
  function setStatus(message,kind=''){status.className=kind||'muted';status.textContent=message;}
  function maxPower(st){let m=0;for(const e of st.evses||[])for(const c of e.connectors||[])m=Math.max(m,Number(c.powerKw||0));return m;}
  function priceLabel(o){const p=o.pricing||{};if(p.pricePerKwh!=null)return `${Number(p.pricePerKwh).toFixed(3)} €/kWh`;const rs=p.rules||[];const vals=[...new Set(rs.map(r=>r.pricePerKwh).filter(v=>v!=null))];return vals.length?`${vals.map(v=>Number(v).toFixed(3)).join(' / ')} €/kWh`:p.type||'tarif complexe';}
  function fmt(v,d=1){return v==null?'—':Number(v).toFixed(d);}
  function render(area){
    const stations=area.rankedStations||area.stations||[],vp=area.vehicleProfile,es=area.effectiveSession||{};
    summary.textContent=`${(area.stations||[]).length} stations · ${area.operators?.length||0} opérateurs · ${area.subscriptions?.length||0} abonnements · ${area.diagnostics?.routedStationCount||0}/${area.diagnostics?.routingRequestedCount||0} routées · ${area.diagnostics?.fullyScoredStationCount||0} complètement scorées${vp?' · profil '+vp.label:''}`;
    subsEl.innerHTML=area.subscriptions?.length?area.subscriptions.map(s=>`<span class="chip">${esc(s.provider)} · ${s.countryCount==null?'global':s.countryCount+' pays'}</span>`).join(''):'<span class="muted">Aucun abonnement pour ce filtre.</span>';
    stationsEl.innerHTML=stations.slice(0,100).map(st=>{const ev=area.sessionEvaluations?.[st.id],best=ev?.best,score=area.stationScores?.[st.id],route=area.routes?.byStationId?.[st.id],cm=score?.chargeModel;return `<div class="station"><strong>${esc(st.name)}</strong><div class="muted">${esc(st.physicalOperator?.name)} · ${maxPower(st)} kW · ${esc(st.status?.state||'unknown')}</div>${best?`<div class="best">Meilleur : ${esc(best.provider)}${best.subscriptionId?' · '+esc(best.subscriptionId):''} · ${Number(best.total).toFixed(2)} ${esc(best.targetCurrency)}${best.costPerRecoveredKm!=null?' · '+Number(best.costPerRecoveredKm).toFixed(4)+' €/km récupéré':''}</div>`:'<div class="best muted">Aucune offre comparable pour cette session</div>'}${score?`<div class="offer">Score · coût ${fmt(score.finalCost,2)} € · distance ${fmt(score.distanceKm)} km · trajet ${fmt(score.driveMinutes)} min · charge ${fmt(score.chargingMinutes)} min · occupation après charge ${fmt(score.postChargeMinutes)} min · total ${fmt(score.totalTimeMinutes)} min</div>`:''}${cm?`<div class="offer">Recharge ${esc(cm.profile||'')} · ${esc(cm.chargingKind||'')} · SOC arrivée ${fmt(cm.startSoc)}% → ${fmt(cm.targetSoc)}% · limite véhicule ${fmt(cm.vehicleLimitKw)} kW · puissance moyenne ${fmt(cm.averagePowerKw)} kW</div>`:''}${route?`<div class="offer">Routage ${esc(route.provider||'')} · énergie pour atteindre la borne ${fmt(route.approachEnergyKwh,2)} kWh</div>`:''}${ev?`<div class="offer">Énergie demandée ${fmt(ev.requestedEnergyKwh,2)} kWh · facturée ${fmt(ev.billedEnergyKwh,2)} kWh</div>`:''}${(st.offers||[]).map(o=>`<div class="offer">${esc(o.provider)} — ${esc(o.kind)} — ${esc(priceLabel(o))}${o.subscriptionId?' · abonnement':''}${o.metadata?.verified?' · vérifié':''}</div>`).join('')}</div>`;}).join('')||'<span class="muted">Aucune station.</span>';
    if(vp)setStatus(`Profil ${vp.label} · ${fmt(es.batteryCapacityKwh)} kWh · ${fmt(es.consumptionKwhPer100Km)} kWh/100 km · AC ${fmt(es.vehicleMaxAcKw)} kW · DC ${fmt(es.vehicleMaxDcKw)} kW.`,'ok');
  }
  try{
    const [registry,vehicleProfiles]=await Promise.all([
      fetch('../data/v9/source-registry.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`registre ${r.status}`);return r.json();}),
      fetch('../data/v9/vehicle-profiles.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`profils véhicule ${r.status}`);return r.json();})
    ]);
    const adapters={teslaJson:window.TCCV9Adapters.teslaJson,nationalCompact:window.TCCV9Adapters.nationalCompact,directOffers:window.TCCV9Adapters.directOffers,legacyDirectTariffs:window.TCCV9Adapters.legacyDirectTariffs,legacyDirectStations:window.TCCV9Adapters.legacyDirectStations,franceEmspCompact:window.TCCV9Adapters.franceEmspCompact,franceCrosswalk:window.TCCV9Adapters.franceCrosswalk,franceIrveStatus:window.TCCV9Adapters.franceIrveStatus};
    const loaders=window.TCCV9BrowserLoaders.createRegistryLoaders({registry,basePath:'..',adapters});
    const routeProvider=window.TCCV9BrowserRouting.osrmProvider();
    engine=window.TCCV9RuntimeEngine.createEngine({registry,loaders,routeProvider,vehicleProfiles});
    const profiles=engine.vehicleProfiles();$('vehicleProfile').innerHTML=profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
    setStatus(`Moteur V9 prêt · ${Object.keys(loaders).length} sources · ${profiles.length} profil(s) véhicule · routage OSRM actif.`,'ok');
  }catch(err){setStatus(`Initialisation impossible : ${err.message}`,'err');return;}
  $('country').addEventListener('change',()=>{
    const country=$('country').value;
    if(country==='NL'){$('lat').value='51.4416';$('lon').value='5.4697';$('subCountries').value='NL';$('selectedSubscriptions').value='';}
    else if(country==='IT'){$('lat').value='41.9028';$('lon').value='12.4964';$('subCountries').value='IT';$('selectedSubscriptions').value='atlante_go';}
    else{$('lat').value='48.798';$('lon').value='2.061';$('subCountries').value='FR';$('selectedSubscriptions').value='';}
  });
  $('load').addEventListener('click',async()=>{
    try{
      setStatus('Chargement, fusion, profil véhicule, routage, simulation SOC et scoring V9…');stationsEl.innerHTML='';
      const countryCode=$('country').value,lat=Number($('lat').value),lon=Number($('lon').value),radiusKm=Number($('radius').value||15);
      const countryCodes=$('subCountries').value.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
      const selectedSubscriptions=$('selectedSubscriptions').value.split(',').map(x=>x.trim()).filter(Boolean);
      const session={energyKwh:Number($('energy').value||0),startSoc:Number($('startSoc').value),targetSoc:Number($('targetSoc').value),targetCurrency:'EUR',startAt:$('startAt').value||null,disconnectAt:$('disconnectAt').value||null,includeRouteEnergyInCharge:true};
      const area=await engine.queryArea({countryCode,origin:{lat,lon},radiusKm,filters:{},vehicleProfileId:$('vehicleProfile').value,subscriptionFilters:{minCountries:Number($('minCountries').value||1),countryCodes,coverageMode:'all'},selectedSubscriptions,session,sortBy:$('sortBy').value});
      render(area);const routeErrors=area.diagnostics?.routingErrorCount||0,sourceErrors=area.diagnostics?.errors?.length||0;if(sourceErrors||routeErrors)setStatus(`Terminé · ${area.diagnostics?.routedStationCount||0} routes · ${sourceErrors} erreur(s) source · ${routeErrors} erreur(s) routage.`,'err');
    }catch(err){setStatus(`Erreur : ${err.message}`,'err');}
  });
})();