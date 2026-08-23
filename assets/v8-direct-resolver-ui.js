// Tesla Charge Companion V8 RC4.8 — résolution tarif direct + filtre puissance + UI abonnements.
(function(){
  'use strict';
  const REVISION='rc48bd-power-window';
  const POWER_KEY='tccPowerWindowV1';
  const SUB_KEY='tccSubscriptionsV1';
  const $=id=>document.getElementById(id);
  const text=v=>String(v==null?'':v).trim();
  const esc=v=>window.escapeHtml?window.escapeHtml(v):text(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const deepClone=v=>JSON.parse(JSON.stringify(v));

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(e){return fallback}}
  function markRevision(){
    const banner=$('tccPreviewBanner');
    if(banner&&/RC4\.8/.test(text(banner.textContent)))banner.textContent=`V8 Preview · RC4.8 · ${REVISION} · tarif direct prioritaire · filtre puissance · auto-mise à jour désactivée`;
  }

  // Règle V8 : station exacte > grille directe applicable > fallback app.
  const CHARGEZY_ALIASES=[
    'Chargezy','CHARGEZY','TE63','SIEG 63','SIEG63',
    "Syndicat Intercommunal d'Electricité et de Gaz du Puy-de-Dôme",
    "Syndicat Intercommunal d’Électricité et de Gaz du Puy-de-Dôme",
    'Territoire d’Énergie Puy-de-Dôme','Territoire Energie Puy-de-Dome'
  ].map(norm);
  function stationValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name,st?.address].map(norm).filter(Boolean)}
  function isChargezy(st){const vals=stationValues(st);return vals.some(v=>CHARGEZY_ALIASES.some(a=>v===a||v.includes(a)||a.includes(v)))}
  function isChargezySpecialFlatSite(st){const v=norm(`${st?.name||''} ${st?.address||''}`);return v.includes('saint germain lembron')||v.includes('coustilles')}
  function physicalConfigs(st){
    const cfgs=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{id:'main',kind:st?.kind||'AC',powerKw:Number(st?.powerKw||0),stalls:Number(st?.stalls||0),pricing:st?.pricing}];
    const out=[],seen=new Set();
    for(const c of cfgs){const kind=text(c?.kind||st?.kind||'AC').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);if(!(power>0))continue;const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)})}
    return out;
  }
  function configProvider(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function alreadyHasDirect(configs,provider,kind,power){const p=norm(provider);return (configs||[]).some(c=>configProvider(c)===p&&text(c?.kind).toUpperCase()===kind&&Math.abs(Number(c?.powerKw||0)-power)<.25)}
  function rulesForChargezy(kind,power){
    if(kind==='AC'&&power<=22.01)return [
      {scope:'timeWindow',start:'07:00',end:'23:00',billing:'kwh',currency:'EUR',pricePerKwh:0.59,chargePerMinute:0,connectionFee:2,idlePerMinute:0,afterMinutesRate:0.10,afterMinutesThreshold:180,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'},
      {scope:'timeWindow',start:'23:00',end:'07:00',billing:'kwh',currency:'EUR',pricePerKwh:0.59,chargePerMinute:0,connectionFee:2,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:180,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'}
    ];
    if(kind==='DC'&&power<=25.01)return [{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:0.59,chargePerMinute:0,connectionFee:2,idlePerMinute:0,afterMinutesRate:0.10,afterMinutesThreshold:90,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'}];
    if(kind==='DC'&&power>25&&power<=50.01)return [{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:0.69,chargePerMinute:0,connectionFee:2,idlePerMinute:0,afterMinutesRate:0.20,afterMinutesThreshold:45,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'}];
    return null;
  }
  function addChargezyDirect(st){
    if(!st||st.source==='teslaSupercharger'||String(st.countryCode||'FR').toUpperCase()!=='FR'||!isChargezy(st)||isChargezySpecialFlatSite(st))return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      const rules=rulesForChargezy(cfg.kind,cfg.powerKw);if(!rules)continue;const provider='Chargezy direct';if(alreadyHasDirect([...base,...added],provider,cfg.kind,cfg.powerKw))continue;
      added.push({id:`direct-resolver:chargezy:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,label:`${provider} · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,pricing:{type:'rules',rules:deepClone(rules)},offerProvider:provider,offerType:'operator_direct',directResolverOfferId:`chargezy-${cfg.kind.toLowerCase()}-${cfg.powerKw}`,directResolverSource:'data-lab/chargezy_te63_official_auvergne_rhone_alpes.json',directResolverScope:'departmental_unique_power_class',directResolverVerified:true});
    }
    if(!added.length)return st;
    return {...st,chargingConfigurations:[...base,...added],_directResolverOffers:[...(st._directResolverOffers||[]),...added.map(x=>x.directResolverOfferId)]};
  }

  // Filtre puissance à double curseur, inclusif.
  function powerState(){const s=readJson(POWER_KEY,{min:0,max:250})||{},rawMin=Number(s.min),rawMax=Number(s.max);let min=Math.max(0,Math.min(250,Number.isFinite(rawMin)?rawMin:0)),max=Math.max(0,Math.min(250,Number.isFinite(rawMax)?rawMax:250));if(min>max)[min,max]=[max,min];return{min,max}}
  function savePowerState(min,max){localStorage.setItem(POWER_KEY,JSON.stringify({min,max,updatedAt:new Date().toISOString()}))}
  function injectPowerStyle(){
    if($('v8DirectResolverStyle'))return;
    const s=document.createElement('style');s.id='v8DirectResolverStyle';s.textContent=`
      .v8-power-window{margin:10px 0 12px;padding:11px 12px;border:1px solid #303038;border-radius:12px;background:#0d0d10}.v8-power-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.v8-power-value{font-size:11px;font-weight:900;color:#e7e7eb;white-space:nowrap}.v8-power-track{position:relative;height:34px;margin-top:7px}.v8-power-track:before{content:'';position:absolute;left:2px;right:2px;top:16px;height:4px;border-radius:99px;background:#33343a}.v8-power-track input[type=range]{position:absolute;left:0;top:4px;width:100%;height:26px;background:transparent;pointer-events:none;appearance:none;-webkit-appearance:none}.v8-power-track input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid #111;pointer-events:auto;box-shadow:0 0 0 1px #777}.v8-power-track input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid #111;pointer-events:auto}.v8-power-scale{display:flex;justify-content:space-between;color:#777;font-size:9px;margin-top:-2px}.v8-power-inputs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px}.v8-power-inputs label{display:grid;gap:4px;color:#9999a2;font-size:9px}.v8-power-inputs input{width:100%;min-width:0;min-height:36px;padding:7px 9px}.v8-sub-select{margin-top:9px;width:100%}.v8-sub-selected{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.v8-sub-chip{display:flex;align-items:center;gap:7px;padding:7px 9px;border:1px solid #35363c;border-radius:10px;background:#151519;font-size:10px}.v8-sub-chip b{font-size:10px}.v8-sub-chip span{color:#9a9aa2}.v8-sub-remove{border:0;background:transparent;color:#e0a9a9;font-size:15px;line-height:1;padding:0 2px;cursor:pointer}.v8-direct-fallback-row{border-color:#615027!important;background:rgba(126,95,21,.07)!important}.v8-direct-fallback-row .v8-offer-total{color:#d7ad57!important;font-size:10px!important}.v8-reference-superseded{display:none!important}`;document.head.appendChild(s);
  }
  function injectPowerWindow(){
    const filters=$('augCompareFilters')||$('v8FilterBody');if(!filters)return false;if($('v8PowerWindow'))return true;injectPowerStyle();const kind=$('simKindFilter')?.closest('div'),box=document.createElement('div');box.id='v8PowerWindow';box.className='v8-power-window';const s=powerState();
    box.innerHTML=`<div class="v8-power-head"><div><b>Fenêtre de puissance</b><div class="small">Filtre supplémentaire au choix AC / DC</div></div><div id="v8PowerValue" class="v8-power-value"></div></div><div class="v8-power-track"><input id="v8PowerMin" type="range" min="0" max="250" step="1" value="${s.min}"><input id="v8PowerMax" type="range" min="0" max="250" step="1" value="${s.max}"></div><div class="v8-power-scale"><span>0 kW</span><span>250+ kW</span></div><div class="v8-power-inputs"><label>Minimum (kW)<input id="v8PowerMinNumber" type="number" min="0" max="250" step="1" inputmode="numeric" value="${s.min}"></label><label>Maximum (kW)<input id="v8PowerMaxNumber" type="number" min="0" max="250" step="1" inputmode="numeric" value="${s.max}"></label></div>`;
    if(kind)kind.parentElement?.insertAdjacentElement('afterend',box);else filters.prepend(box);
    const minEl=$('v8PowerMin'),maxEl=$('v8PowerMax'),minNumber=$('v8PowerMinNumber'),maxNumber=$('v8PowerMaxNumber'),val=$('v8PowerValue');const clamp=v=>Math.max(0,Math.min(250,Math.round(Number(v)||0)));const sync=(changed,source)=>{let min=clamp(source==='number'?minNumber.value:minEl.value),max=clamp(source==='number'?maxNumber.value:maxEl.value);if(changed==='min'&&min>max)max=min;if(changed==='max'&&max<min)min=max;minEl.value=minNumber.value=String(min);maxEl.value=maxNumber.value=String(max);val.textContent=`${min} — ${max>=250?'250+':max} kW`;savePowerState(min,max)};
    minEl.addEventListener('input',()=>sync('min','range'));maxEl.addEventListener('input',()=>sync('max','range'));minNumber.addEventListener('change',()=>sync('min','number'));maxNumber.addEventListener('change',()=>sync('max','number'));sync('max','range');return true;
  }
  function installExpansionResolver(){
    const current=window.expandConfigurations;if(typeof current!=='function')return false;if(current.__tccDirectResolverPowerV1)return true;
    const wrapped=function(baseStations){const source=Array.isArray(baseStations)?baseStations.map(addChargezyDirect):baseStations,expanded=current.call(this,source),p=powerState();return (expanded||[]).filter(st=>{const kw=Number(st?.powerKw||0);return Number.isFinite(kw)&&kw>=p.min-1e-9&&((p.max>=250||kw<=p.max+1e-9))})};
    wrapped.__tccDirectResolverPowerV1=true;wrapped.__tccOverlayExpansionGuard=!!current.__tccOverlayExpansionGuard;wrapped.__tccOriginal=current;window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}return true;
  }

  // Batterie & calcul immédiatement sous le véhicule.
  function reorderBatteryCalculation(){const summary=$('v8VehicleSummary'),calcBody=$('v8CalcBody');if(!summary||!calcBody)return false;const details=calcBody.closest('details');if(!details)return false;const sum=details.querySelector('summary');if(sum)sum.innerHTML='<span>Batterie & calcul</span><span>consommation, capacité, préconditionnement</span>';if(summary.nextElementSibling!==details)summary.insertAdjacentElement('afterend',details);return true}

  // Abonnements : dropdown d'ajout + sélection multiple compacte.
  function subscriptionState(){const s=readJson(SUB_KEY,{selected:[]})||{};return{selected:Array.isArray(s.selected)?s.selected:[]}}
  function selectionId(p){return text(p?.selectionId||p?.id)}
  function planLabel(p){if(p?.monthlyFeeLabel)return p.monthlyFeeLabel;if(Number.isFinite(Number(p?.monthlyFeeEur)))return`${Number(p.monthlyFeeEur).toFixed(2).replace('.',',')} €/mois`;return'abonnement'}
  function controlPlans(){const plans=window.TCCV8Subscriptions?.plans||[],byId=new Map();for(const p of plans){const id=selectionId(p);if(!id)continue;if(!byId.has(id)||byId.get(id).control===false)byId.set(id,p)}return [...byId.values()].filter(p=>p.control!==false)}
  function writeSubscriptions(selected){localStorage.setItem(SUB_KEY,JSON.stringify({selected:[...selected],updatedAt:new Date().toISOString()}));window.TCCV8Subscriptions?.applyAll?.(true)}
  function renderSubscriptionDropdown(force=false){
    const box=$('v8SubscriptionsBox'),plans=controlPlans();if(!box||!plans.length)return false;if(box.dataset.tccDropdown==='1'&&!force)return true;injectPowerStyle();const selected=new Set(subscriptionState().selected),available=plans.filter(p=>!selected.has(selectionId(p))),active=plans.filter(p=>selected.has(selectionId(p)));
    box.innerHTML=`<div class="v8-eyebrow">Mes abonnements</div><div style="font-size:12px;font-weight:800;margin-top:3px">Abonnements pris en compte</div><div class="small" style="margin-top:5px">Ajoute uniquement les abonnements que tu possèdes. Le coût du forfait n'est jamais imputé à une recharge.</div><select id="v8SubscriptionSelect" class="v8-sub-select"><option value="">${available.length?'Ajouter un abonnement…':'Tous les abonnements disponibles sont sélectionnés'}</option>${available.map(p=>`<option value="${esc(selectionId(p))}">${esc(p.provider)} · ${esc(planLabel(p))}</option>`).join('')}</select><div id="v8SubscriptionSelected" class="v8-sub-selected">${active.length?active.map(p=>`<div class="v8-sub-chip" data-sub-chip="${esc(selectionId(p))}"><div><b>${esc(p.provider)}</b><br><span>${esc(planLabel(p))}</span></div><button type="button" class="v8-sub-remove" data-remove-sub="${esc(selectionId(p))}" aria-label="Retirer ${esc(p.provider)}">×</button></div>`).join(''):'<span class="small">Aucun abonnement sélectionné.</span>'}</div>`;
    $('v8SubscriptionSelect')?.addEventListener('change',e=>{const id=text(e.target.value);if(!id)return;const s=new Set(subscriptionState().selected);s.add(id);writeSubscriptions(s);renderSubscriptionDropdown(true)});box.querySelectorAll('[data-remove-sub]').forEach(btn=>btn.addEventListener('click',()=>{const s=new Set(subscriptionState().selected);s.delete(btn.dataset.removeSub);writeSubscriptions(s);renderSubscriptionDropdown(true)}));box.dataset.tccDropdown='1';return true;
  }

  // Fallback opérateur vers app/portail quand aucun tarif direct calculable n'existe.
  const APP_HINTS=[{keys:['reveo'],label:'Révéo'},{keys:['pass pass','passpass'],label:'Pass Pass Électrique'},{keys:['freshmile'],label:'Freshmile'},{keys:['e totem','etotem'],label:'e-Totem'},{keys:['izivia','prise de nice'],label:'IZIVIA'},{keys:['chargezy','sieg 63','te63','puy de dome'],label:'Chargezy'},{keys:['alize'],label:'Alizé'},{keys:['electric 55','electric55'],label:'Electric 55'},{keys:['powerdot'],label:'Powerdot'},{keys:['qovoltis'],label:'Qovoltis'},{keys:['driveco'],label:'DRIVECO'},{keys:['ionity'],label:'IONITY'},{keys:['allego'],label:'Allego'},{keys:['vianeo'],label:'Vianeo'}];
  function cardOperator(card){return text(card.querySelector('.operator-badge')?.textContent)||'Opérateur'}
  function appLabel(op){const n=norm(op),hit=APP_HINTS.find(x=>x.keys.some(k=>n.includes(norm(k))));return hit?.label||op||'l’opérateur'}
  function providerText(row){return text(row.querySelector('.v8-offer-provider')?.textContent).replace(/✓.*$/,'').trim()}
  function hasDirectCalculated(box){return [...box.querySelectorAll('.v8-offer-row:not(.v8-reference-row):not(.v8-direct-fallback-row)')].some(row=>{const p=norm(providerText(row));if(!p)return false;if(p.startsWith('electroverse')||p==='electra'||p.startsWith('electra '))return false;if(row.dataset.subscriptionId||row.dataset.subscriptionOfferId)return false;return true})}
  function applyFallbacks(){
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{const box=card.querySelector('.v8-offer-box');if(!box)return;const refs=[...box.querySelectorAll('.v8-reference-row')];if(hasDirectCalculated(box)){box.querySelector('.v8-direct-fallback-row')?.remove();refs.forEach(r=>r.classList.add('v8-reference-superseded'));return}refs.forEach(r=>r.classList.add('v8-reference-superseded'));if(box.querySelector('.v8-direct-fallback-row'))return;const op=cardOperator(card);if(norm(op)==='tesla')return;const label=appLabel(op),note=box.querySelector('.v8-offer-note'),row=document.createElement('div');row.className='v8-offer-row v8-direct-fallback-row v8-offer-ambiguous';row.dataset.tccProvider=`${op} direct`;row.innerHTML=`<div class="v8-offer-provider">${esc(op)} direct</div><div class="v8-offer-price">Tarif direct non déterminé — vérifier dans l’application / portail ${esc(label)}</div><div class="v8-offer-total">Voir l’app</div>`;note?.before(row)||box.appendChild(row)})
  }
  function installFallbackObserver(){const root=$('results');if(!root)return false;if(root.__tccDirectFallbackObs)return true;let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(applyFallbacks,300)});obs.observe(root,{childList:true,subtree:true,characterData:true});root.__tccDirectFallbackObs=obs;setTimeout(applyFallbacks,450);return true}

  function install(){markRevision();injectPowerStyle();const a=reorderBatteryCalculation(),b=injectPowerWindow(),c=installExpansionResolver(),d=renderSubscriptionDropdown(),e=installFallbackObserver();return a&&b&&c&&e&&(d||!$('v8SubscriptionsBox'))}
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>240)clearInterval(timer)},120);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});else setTimeout(install,0);
  window.TCCV8DirectResolver={revision:REVISION,addChargezyDirect,powerState,applyFallbacks,reorderBatteryCalculation,renderSubscriptionDropdown};
  console.info(`[TCC V8] ${REVISION} actif : direct resolver + puissance + abonnements déroulants.`);
})();
