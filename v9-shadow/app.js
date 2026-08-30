(async function(){
  'use strict';
  const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=$('status'),gatesEl=$('gates'),summaryEl=$('summary'),changesEl=$('changes');let engine=null,v8=null;
  function setStatus(message,kind='muted'){status.className=kind;status.textContent=message;}
  function fmt(v,d=2){return v==null?'—':Number(v).toFixed(d);}
  function localDateTimeValue(date){const pad=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;}
  function render(result){
    const p=result.parity,s=p.summary,g=p.gates;
    gatesEl.innerHTML=`<span class="gate ${g.noV8Loss?'ok':'err'}">Couverture V8 ${g.noV8Loss?'OK':'ÉCHEC'}</span><span class="gate ${g.noCriticalDifferences?'ok':'err'}">Écarts critiques ${g.noCriticalDifferences?'OK':'ÉCHEC'}</span><span class="gate ${g.sessionParity?'ok':'err'}">Session ${g.sessionParity?'OK':'ÉCHEC'}</span><span class="gate ${g.pass?'ok':'err'}">Gate global ${g.pass?'PASS':'FAIL'}</span>`;
    summaryEl.textContent=`V8 ${s.v8Count} · V9 ${s.v9Count} · appariées ${s.matchedCount} · V8 absentes de V9 ${s.v8OnlyCount} · V9 nouvelles ${s.v9OnlyCount} · sessions comparées ${s.sessionComparedCount} · erreurs ${s.errorCount} · avertissements ${s.warningCount}`;
    const rows=p.changed||[];
    changesEl.innerHTML=rows.length?rows.slice(0,100).map(row=>{
      const diffs=[...(row.differences||[]),...(row.sessionDifferences||[])];
      const left=row.leftSession||{},right=row.rightSession||{};
      return `<div class="row"><b>${esc(row.leftId)} → ${esc(row.rightId)}</b><div class="muted">${esc(row.matchedKey||'')}</div><div class="diff">V8 coût ${fmt(left.finalCost)} € · SOC ${fmt(left.reachedSoc,1)}% · temps ${fmt(left.totalTimeMinutes,1)} min · €/km ${fmt(left.costPerRecoveredKm,4)}</div><div class="diff">V9 coût ${fmt(right.finalCost)} € · SOC ${fmt(right.reachedSoc,1)}% · temps ${fmt(right.totalTimeMinutes,1)} min · €/km ${fmt(right.costPerRecoveredKm,4)}</div>${diffs.map(d=>`<div class="diff ${d.severity}">${d.severity==='error'?'⛔':'⚠'} ${esc(d.field)} : ${esc(d.left)} → ${esc(d.right)}${d.delta!=null?` (Δ ${fmt(d.delta,4)})`:''}</div>`).join('')}</div>`;
    }).join(''):'<span class="ok">Aucun écart sur les stations appariées.</span>';
    if(p.v8Only?.length)changesEl.insertAdjacentHTML('beforeend',`<div class="row err"><b>Stations V8 absentes de V9</b><br>${p.v8Only.slice(0,30).map(x=>esc(x.name||x.id)).join(' · ')}</div>`);
  }

  try{
    const [registry,vehicleProfiles]=await Promise.all([
      fetch('../data/v9/source-registry.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`registre ${r.status}`);return r.json();}),
      fetch('../data/v9/vehicle-profiles.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(`profils ${r.status}`);return r.json();})
    ]);
    const adapters={teslaJson:window.TCCV9Adapters.teslaJson,nationalCompact:window.TCCV9Adapters.nationalCompact,directOffers:window.TCCV9Adapters.directOffers,legacyDirectTariffs:window.TCCV9Adapters.legacyDirectTariffs,legacyDirectStations:window.TCCV9Adapters.legacyDirectStations,franceEmspCompact:window.TCCV9Adapters.franceEmspCompact,franceCrosswalk:window.TCCV9Adapters.franceCrosswalk,franceIrveStatus:window.TCCV9Adapters.franceIrveStatus};
    const loaders=window.TCCV9BrowserLoaders.createRegistryLoaders({registry,basePath:'..',adapters}),routeProvider=window.TCCV9BrowserRouting.osrmProvider();
    engine=window.TCCV9RuntimeEngine.createEngine({registry,loaders,routeProvider,vehicleProfiles});
    v8=window.TCCV9V8ShadowAdapter.createBrowserAdapter($('v8Frame'));
    $('vehicleProfile').innerHTML=engine.vehicleProfiles().map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
    const now=new Date(),later=new Date(now.getTime()+2*3600000);$('startAt').value=localDateTimeValue(now);$('disconnectAt').value=localDateTimeValue(later);
    await v8.ready();setStatus(`Shadow prêt · V8 réel isolé + V9 · ${engine.vehicleProfiles().length} profil(s) véhicule.`,'ok');
  }catch(err){setStatus(`Initialisation impossible : ${err.message}`,'err');return;}

  $('run').addEventListener('click',async()=>{
    try{
      setStatus('Exécution V8 réelle, routage puis simulation V9…','warn');gatesEl.textContent='Calcul…';changesEl.textContent='Calcul…';
      const profileId=$('vehicleProfile').value,profile=engine.vehicleProfile(profileId),consumption=profile?.consumption?.kwhPer100Km??15;
      const session={startSoc:Number($('startSoc').value),targetSoc:Number($('targetSoc').value),startAt:$('startAt').value,disconnectAt:$('disconnectAt').value||null,consumptionKwhPer100Km:consumption,targetCurrency:'EUR'};
      const baseQuery={countryCode:$('country').value,originText:$('originText').value.trim(),radiusKm:Number($('radius').value||20),vehicleProfileId:profileId,session,v8Profile:$('v8Profile').value,v8Condition:$('v8Condition').value,v8FilterMode:'all',filters:{}};
      const result=await window.TCCV9ParityEngine.shadowQuery({v8Query:q=>v8.query(q),v9Engine:engine,query:baseQuery,options:{compareOffers:false,costTolerance:.05,costRelativeTolerance:.01,socTolerancePoints:1,timeToleranceMinutes:2,criticalTimeToleranceMinutes:10,costPerKmTolerance:.001}});
      render(result);setStatus(`Shadow terminé · ${result.parity.summary.sessionComparedCount} session(s) comparée(s) · gate ${result.parity.gates.pass?'PASS':'FAIL'}.`,result.parity.gates.pass?'ok':'err');
    }catch(err){setStatus(`Shadow impossible : ${err.message}`,'err');gatesEl.textContent='Échec du run.';changesEl.textContent='';}
  });
})();
