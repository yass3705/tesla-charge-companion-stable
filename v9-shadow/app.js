(async function(){
  'use strict';
  const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=$('status'),gatesEl=$('gates'),summaryEl=$('summary'),changesEl=$('changes'),matrixEl=$('matrix'),readinessEl=$('readiness');let engine=null,v8=null;
  function setStatus(message,kind='muted'){status.className=kind;status.textContent=message;}
  function fmt(v,d=2){return v==null?'—':Number(v).toFixed(d);}
  function fmtTime(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
  function localDateTimeValue(date){const pad=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;}
  function selectedSubscriptions(){return String($('selectedSubscriptions')?.value||'').split(',').map(x=>x.trim()).filter(Boolean);}
  function baseQuery(){
    const profileId=$('vehicleProfile').value,profile=engine.vehicleProfile(profileId),consumption=profile?.consumption?.kwhPer100Km??15,subscriptions=selectedSubscriptions();
    const session={startSoc:Number($('startSoc').value),targetSoc:Number($('targetSoc').value),startAt:$('startAt').value,disconnectAt:$('disconnectAt').value||null,consumptionKwhPer100Km:consumption,targetCurrency:'EUR',selectedSubscriptions:subscriptions};
    return{countryCode:$('country').value,originText:$('originText').value.trim(),radiusKm:Number($('radius').value||20),vehicleProfileId:profileId,session,selectedSubscriptions:subscriptions,v8Profile:$('v8Profile').value,v8Condition:$('v8Condition').value,v8FilterMode:'all',filters:{}};
  }
  const parityOptions={compareOffers:false,costTolerance:.05,costRelativeTolerance:.01,socTolerancePoints:1,arrivalSocTolerancePoints:1,timeToleranceMinutes:2,criticalTimeToleranceMinutes:10,chargingTimeToleranceMinutes:2,criticalChargingTimeToleranceMinutes:10,chargeCompleteToleranceMinutes:2,criticalChargeCompleteToleranceMinutes:10,costPerKmTolerance:.001};

  function render(result){
    const p=result.parity,s=p.summary,g=p.gates;
    gatesEl.innerHTML=`<span class="gate ${g.noV8Loss?'ok':'err'}">Couverture V8 ${g.noV8Loss?'OK':'ÉCHEC'}</span><span class="gate ${g.noCriticalDifferences?'ok':'err'}">Écarts critiques ${g.noCriticalDifferences?'OK':'ÉCHEC'}</span><span class="gate ${g.sessionParity?'ok':'err'}">Session ${g.sessionParity?'OK':'ÉCHEC'}</span><span class="gate ${g.pass?'ok':'err'}">Gate global ${g.pass?'PASS':'FAIL'}</span>`;
    summaryEl.textContent=`V8 ${s.v8Count} · V9 ${s.v9Count} · appariées ${s.matchedCount} · V8 absentes de V9 ${s.v8OnlyCount} · V9 nouvelles ${s.v9OnlyCount} · sessions comparées ${s.sessionComparedCount} · erreurs ${s.errorCount} · avertissements ${s.warningCount}`;
    const rows=p.changed||[];
    changesEl.innerHTML=rows.length?rows.slice(0,100).map(row=>{
      const diffs=[...(row.differences||[]),...(row.sessionDifferences||[])],left=row.leftSession||{},right=row.rightSession||{};
      return `<div class="row"><b>${esc(row.leftId)} → ${esc(row.rightId)}</b><div class="muted">${esc(row.matchedKey||'')}</div><div class="diff">V8 coût ${fmt(left.finalCost)} € · arrivée ${fmt(left.arrivalSoc,1)}% · fin ${fmt(left.reachedSoc,1)}% · charge ${fmt(left.chargingMinutes,1)} min · fin charge ${fmtTime(left.chargeCompleteAt)} · total ${fmt(left.totalTimeMinutes,1)} min · €/km ${fmt(left.costPerRecoveredKm,4)}</div><div class="diff">V9 coût ${fmt(right.finalCost)} € · arrivée ${fmt(right.arrivalSoc,1)}% · fin ${fmt(right.reachedSoc,1)}% · charge ${fmt(right.chargingMinutes,1)} min · fin charge ${fmtTime(right.chargeCompleteAt)} · total ${fmt(right.totalTimeMinutes,1)} min · €/km ${fmt(right.costPerRecoveredKm,4)}</div>${diffs.map(d=>`<div class="diff ${d.severity}">${d.severity==='error'?'⛔':'⚠'} ${esc(d.field)} : ${esc(d.left)} → ${esc(d.right)}${d.delta!=null?` (Δ ${fmt(d.delta,4)})`:''}</div>`).join('')}</div>`;
    }).join(''):'<span class="ok">Aucun écart sur les stations appariées.</span>';
    if(p.v8Only?.length)changesEl.insertAdjacentHTML('beforeend',`<div class="row err"><b>Stations V8 absentes de V9</b><br>${p.v8Only.slice(0,30).map(x=>esc(x.name||x.id)).join(' · ')}</div>`);
  }

  function renderReadiness(report){
    const cls=report.ready?'readiness-ready':'readiness-blocked',tone=report.ready?'ok':'err';
    readinessEl.className=cls;
    readinessEl.innerHTML=`<div class="${tone}"><b>${report.verdict}</b> · ${report.summary.passedCount}/${report.summary.checkCount} contrôle(s) passent · ${report.summary.blockerCount} blocage(s).</div>`+
      report.checks.map(c=>`<div class="row"><b class="${c.status==='pass'?'ok':c.status==='fail'||c.status==='missing'?'err':'warn'}">${c.status==='pass'?'✓':c.status==='fail'||c.status==='missing'?'⛔':'⚠'} ${esc(c.label)}</b><div class="muted">${esc(c.detail||'')}${c.value!=null?` · valeur ${esc(c.value)}`:''}${c.threshold!=null?` · seuil ${esc(c.threshold)}`:''}</div></div>`).join('')+
      `<div class="muted">Ce verdict couvre le runtime + shadow de cette matrice. La bascule production exige en plus le workflow CI « V9 production readiness gate » au vert.</div>`;
  }

  function renderMatrix(matrix){
    const s=matrix.summary;
    gatesEl.innerHTML=`<span class="gate ${s.matrixPass?'ok':'err'}">Matrice ${s.matrixPass?'PASS':'FAIL'}</span><span class="gate ${s.strictFailedCount===0?'ok':'err'}">Stricts ${s.strictPassedCount}/${s.strictScenarioCount}</span><span class="gate ${s.observationWithDifferencesCount?'warn':'ok'}">Observations à revoir ${s.observationWithDifferencesCount}</span>`;
    summaryEl.textContent=`${s.scenarioCount} scénarios · ${s.strictFailedCount} échec(s) strict(s) · ${s.criticalDifferenceCount} écart(s) critique(s) · ${s.warningDifferenceCount} avertissement(s).`;
    matrixEl.innerHTML=matrix.results.map((row,index)=>{
      const cls=row.classification==='regression'?'scenario-fail':row.classification==='review'?'scenario-review':'scenario-pass';
      const verdict=row.classification==='regression'?'RÉGRESSION':row.classification==='review'?'À EXAMINER':'PARITÉ';
      const kind=row.gateMode==='strict'?'strict':'observation';
      return `<div class="scenario ${cls}" data-scenario="${index}"><h3>${esc(row.label)} — ${verdict}</h3><div class="muted">${esc(row.description||'')} · mode ${kind}</div><div>${(row.tags||[]).map(tag=>`<span class="tag">${esc(tag)}</span>`).join('')}</div><div class="diff">V8 ${row.parity.summary.v8Count} · V9 ${row.parity.summary.v9Count} · appariées ${row.parity.summary.matchedCount} · critiques ${row.criticalDifferences.length} · avertissements ${row.warningDifferences.length}</div><button class="scenarioDetail" data-index="${index}">Voir les écarts</button></div>`;
    }).join('');
    matrixEl.querySelectorAll('.scenarioDetail').forEach(button=>button.addEventListener('click',()=>{const row=matrix.results[Number(button.dataset.index)];render(row.shadow);setStatus(`Scénario « ${row.label} » · ${row.classification}.`,row.classification==='regression'?'err':row.classification==='review'?'warn':'ok');}));
  }

  try{
    const [registry,vehicleProfiles]=await Promise.all([fetch('../data/v9/source-registry.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`registre ${r.status}`);return r.json();}),fetch('../data/v9/vehicle-profiles.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`profils ${r.status}`);return r.json();})]);
    const adapters={teslaJson:window.TCCV9Adapters.teslaJson,nationalCompact:window.TCCV9Adapters.nationalCompact,directOffers:window.TCCV9Adapters.directOffers,legacyDirectTariffs:window.TCCV9Adapters.legacyDirectTariffs,legacyDirectStations:window.TCCV9Adapters.legacyDirectStations,franceEmspCompact:window.TCCV9Adapters.franceEmspCompact,franceCrosswalk:window.TCCV9Adapters.franceCrosswalk,franceIrveStatus:window.TCCV9Adapters.franceIrveStatus};
    const loaders=window.TCCV9BrowserLoaders.createRegistryLoaders({registry,basePath:'..',adapters}),routeProvider=window.TCCV9BrowserRouting.osrmProvider();
    engine=window.TCCV9RuntimeEngine.createEngine({registry,loaders,routeProvider,vehicleProfiles});v8=window.TCCV9V8ShadowAdapter.createBrowserAdapter($('v8Frame'));
    $('vehicleProfile').innerHTML=engine.vehicleProfiles().map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
    const now=new Date(),later=new Date(now.getTime()+2*3600000);$('startAt').value=localDateTimeValue(now);$('disconnectAt').value=localDateTimeValue(later);
    await v8.ready();setStatus(`Shadow prêt · V8 réel isolé + V9 · ${engine.vehicleProfiles().length} profil(s) véhicule.`,'ok');
  }catch(err){setStatus(`Initialisation impossible : ${err.message}`,'err');return;}

  $('run').addEventListener('click',async()=>{try{setStatus('Exécution V8 réelle, routage puis simulation V9…','warn');gatesEl.textContent='Calcul…';changesEl.textContent='Calcul…';readinessEl.textContent='La readiness complète nécessite la matrice de scénarios.';const result=await window.TCCV9ParityEngine.shadowQuery({v8Query:q=>v8.query(q),v9Engine:engine,query:baseQuery(),options:parityOptions});render(result);setStatus(`Shadow terminé · ${result.parity.summary.sessionComparedCount} session(s) comparée(s) · gate ${result.parity.gates.pass?'PASS':'FAIL'}.`,result.parity.gates.pass?'ok':'err');}catch(err){setStatus(`Shadow impossible : ${err.message}`,'err');gatesEl.textContent='Échec du run.';changesEl.textContent='';}});

  $('runMatrix').addEventListener('click',async()=>{try{setStatus('Exécution séquentielle de la matrice V8↔V9…','warn');gatesEl.textContent='Matrice en cours…';summaryEl.textContent='';matrixEl.textContent='Calcul…';readinessEl.textContent='Calcul readiness après la matrice…';changesEl.textContent='Sélectionne un scénario après le calcul pour voir son détail.';const matrix=await window.TCCV9ParityScenarioEngine.runMatrix({baseQuery:baseQuery(),v8Query:q=>v8.query(q),v9Engine:engine,parityEngine:window.TCCV9ParityEngine,parityOptions});renderMatrix(matrix);const baseline=matrix.results.find(x=>x.id==='baseline')||matrix.results[0],report=window.TCCV9ReadinessEngine.assess({parity:baseline?.parity,matrix,area:baseline?.shadow?.v9Area,ci:null},{requireCi:false,minComparableSessionRatio:.95,minFullyScoredRatio:.95,minRoutingSuccessRatio:.95,maxRoutingErrors:0});renderReadiness(report);setStatus(`Matrice terminée · ${matrix.summary.strictPassedCount}/${matrix.summary.strictScenarioCount} scénario(s) strict(s) passent · readiness ${report.verdict}.`,report.ready?'ok':'err');}catch(err){setStatus(`Matrice impossible : ${err.message}`,'err');gatesEl.textContent='Échec de la matrice.';matrixEl.textContent='';readinessEl.textContent='Readiness indisponible.';}});
})();
