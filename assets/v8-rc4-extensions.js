// Tesla Charge Companion V8 RC4 — véhicule personnalisé + Electra+.
(function(){
  'use strict';
  const VEHICLE_KEY='tccVehicleProfileV1';
  const ELECTRA_KEY='tccElectraPlusV1';
  const defaultCustom={customReference:16,customCity:12,customFast:14,customMotorway:18,customAcMaxKw:11,customDcMaxKw:250};
  const defaultElectra={plan:'none',includeRanking:false};
  const $=id=>document.getElementById(id);
  const num=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
  const text=v=>String(v??'').trim();
  const parseJson=(k,f)=>{try{return{...f,...JSON.parse(localStorage.getItem(k)||'{}')}}catch(e){return{...f}}};
  const saveJson=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const euro=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function vehicleState(){return{...defaultCustom,...parseJson(VEHICLE_KEY,{})}}
  function electraState(){return parseJson(ELECTRA_KEY,defaultElectra)}
  function isCustom(){return vehicleState().model==='custom'}

  function injectStyle(){if($('v8Rc4Style'))return;const s=document.createElement('style');s.id='v8Rc4Style';s.textContent=`
    .v8-custom-box,.v8-electra-box{margin-top:12px;padding:12px;border:1px solid #303038;border-radius:14px;background:#0f0f13}
    .v8-custom-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.v8-custom-grid label{font-size:10px;color:#aaaab2}
    .v8-electra-controls{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:10px;align-items:end}.v8-electra-check{display:flex;gap:8px;align-items:center;padding:10px;border:1px solid #33333a;border-radius:11px;font-size:11px}.v8-electra-check input{width:auto!important}
    .v8-electra-plus-row{border-color:#765d1f!important;background:rgba(126,95,21,.10)!important}.v8-electra-plus-row.best{border-color:#2d6b43!important;background:rgba(39,120,70,.13)!important}.v8-electra-tag{display:inline-block;margin-left:6px;color:#e9bd54;font-size:10px;font-weight:900}.v8-electra-saving{color:#55d984;font-size:10px;font-weight:800;margin-left:6px}
    @media(max-width:680px){.v8-custom-grid,.v8-electra-controls{grid-template-columns:1fr}}
  `;document.head.appendChild(s);}

  function injectCustomFields(){
    const card=$('v8VehicleCard');if(!card||$('v8CustomVehicleFields'))return false;
    const box=document.createElement('div');box.id='v8CustomVehicleFields';box.className='v8-custom-box hidden';
    box.innerHTML=`<div class="v8-eyebrow">Configuration manuelle</div><div class="v8-custom-grid">
      <div><label>Consommation référence (kWh/100 km)</label><input id="v8CustomReference" type="number" min="5" max="50" step="0.1"></div>
      <div><label>Consommation ville</label><input id="v8CustomCity" type="number" min="5" max="50" step="0.1"></div>
      <div><label>Consommation voie rapide</label><input id="v8CustomFast" type="number" min="5" max="50" step="0.1"></div>
      <div><label>Consommation autoroute</label><input id="v8CustomMotorway" type="number" min="5" max="50" step="0.1"></div>
      <div><label>Puissance AC max véhicule (kW)</label><input id="v8CustomAc" type="number" min="1" max="43" step="1"></div>
      <div><label>Puissance DC max véhicule (kW)</label><input id="v8CustomDc" type="number" min="20" max="500" step="5"></div>
    </div><div class="small" style="margin-top:8px">La capacité utile reste renseignée dans le bloc batterie ci-dessus. La courbe DC est une approximation Companion basée sur la puissance maximale saisie.</div>`;
    const cap=card.querySelector('.v8-capacity-box');cap?.insertAdjacentElement('afterend',box);
    const st=vehicleState();$('v8CustomReference').value=st.customReference;$('v8CustomCity').value=st.customCity;$('v8CustomFast').value=st.customFast;$('v8CustomMotorway').value=st.customMotorway;$('v8CustomAc').value=st.customAcMaxKw;$('v8CustomDc').value=st.customDcMaxKw;
    ['v8CustomReference','v8CustomCity','v8CustomFast','v8CustomMotorway','v8CustomAc','v8CustomDc'].forEach(id=>$(id)?.addEventListener('change',saveCustom));
    $('v8VehicleModel')?.addEventListener('change',()=>setTimeout(syncCustomUi,0));
    $('v8VehicleTrim')?.addEventListener('change',()=>setTimeout(syncCustomUi,0));
    syncCustomUi();return true;
  }
  function saveCustom(){
    const st=vehicleState();
    st.customReference=num($('v8CustomReference')?.value,16);st.customCity=num($('v8CustomCity')?.value,12);st.customFast=num($('v8CustomFast')?.value,14);st.customMotorway=num($('v8CustomMotorway')?.value,18);st.customAcMaxKw=num($('v8CustomAc')?.value,11);st.customDcMaxKw=num($('v8CustomDc')?.value,250);
    st.consumptionOverride={reference:st.customReference,city:st.customCity,fast:st.customFast,motorway:st.customMotorway};saveJson(VEHICLE_KEY,st);window.TCCV8Vehicle?.apply?.(st);syncCustomUi();
  }
  function syncCustomUi(){
    const box=$('v8CustomVehicleFields');if(!box)return;const custom=isCustom();box.classList.toggle('hidden',!custom);if(!custom)return;
    const st=vehicleState();st.consumptionOverride={reference:st.customReference,city:st.customCity,fast:st.customFast,motorway:st.customMotorway};saveJson(VEHICLE_KEY,st);window.TCCV8Vehicle?.apply?.(st);
    const spec=$('v8VehicleSpec');if(spec)spec.innerHTML=`Configuration personnalisée · <b>${st.customReference.toFixed(1)} kWh/100 km</b> · AC <b>${st.customAcMaxKw} kW</b> · DC <b>${st.customDcMaxKw} kW max</b> · capacité batterie <b>saisie utilisateur</b>.`;
    const summary=$('v8VehicleSummary');const span=summary?.querySelector('span:not(.v8-eyebrow)');if(span)span.textContent=`${window.TCCV8Vehicle?.getUsableCapacity?.().toFixed?.(1)||''} kWh utiles · AC ${st.customAcMaxKw} kW · DC ${st.customDcMaxKw} kW max`;
  }

  function installCustomPower(){
    if(!window.TCCV8Vehicle||window.dcCurvePower?.__tccRc4Custom)return false;
    const baseAc=window.acPowerAtSoc,baseDc=window.dcCurvePower;
    if(typeof baseAc==='function'){
      const ac=function(soc,stationMax){if(!isCustom())return baseAc(soc,stationMax);const st=vehicleState(),max=Math.min(num(stationMax,0),st.customAcMaxKw);if(soc<97)return max;if(soc<99)return max*.72;return max*.42;};ac.__tccRc4Custom=true;window.acPowerAtSoc=ac;try{acPowerAtSoc=ac}catch(e){}
    }
    if(typeof baseDc==='function'){
      const dc=function(soc,condition,profile,stationMax){if(!isCustom())return baseDc(soc,condition,profile,stationMax);const st=vehicleState(),max=Math.min(num(stationMax,0),st.customDcMaxKw);const pts=[[0,.72],[10,.98],[20,1],[30,.94],[40,.82],[50,.70],[60,.58],[70,.44],[80,.30],[85,.22],[90,.15],[95,.09],[98,.05],[100,.025]];let r=pts[pts.length-1][1];for(let i=1;i<pts.length;i++){if(soc<=pts[i][0]){const [x1,y1]=pts[i-1],[x2,y2]=pts[i];r=y1+(y2-y1)*(soc-x1)/(x2-x1);break;}}const cf=condition==='warm'?1:(condition==='cold'?.68:.86),pf=profile==='optimistic'?1.08:(profile==='conservative'?.88:1);return Math.max(3,Math.min(max,max*r*cf*pf));};dc.__tccRc4Custom=true;window.dcCurvePower=dc;try{dcCurvePower=dc}catch(e){}
    }
    return true;
  }

  function injectElectraControls(){
    const body=$('v8FilterBody');if(!body||$('v8ElectraBox'))return false;const box=document.createElement('div');box.id='v8ElectraBox';box.className='v8-electra-box';
    box.innerHTML=`<div class="v8-eyebrow">Abonnement Electra+</div><div class="v8-electra-controls"><div><label>Mon offre</label><select id="v8ElectraPlan"><option value="none">Aucun abonnement</option><option value="essential">Electra+ Essential · -0,10 €/kWh</option><option value="smart">Electra+ Smart · -0,20 €/kWh</option></select></div><label class="v8-electra-check"><input id="v8ElectraRanking" type="checkbox"> Utiliser le tarif abonnement dans le coût final et le classement</label></div><div class="small" style="margin-top:7px">Essential : 1,99 €/mois. Smart : 4,99 €/mois. Le forfait mensuel n’est pas imputé à chaque session. Les remises s’appliquent sur le réseau Electra ; Smart applique aussi le tarif partenaire prévu pour Atlante, Fastned et Ionity en France.</div>`;
    body.appendChild(box);const st=electraState();$('v8ElectraPlan').value=st.plan;$('v8ElectraRanking').checked=!!st.includeRanking;
    $('v8ElectraPlan').addEventListener('change',saveElectra);$('v8ElectraRanking').addEventListener('change',saveElectra);return true;
  }
  function saveElectra(){const st={plan:$('v8ElectraPlan')?.value||'none',includeRanking:!!$('v8ElectraRanking')?.checked};saveJson(ELECTRA_KEY,st);decorateElectra();}
  function parseNumber(v){const m=text(v).replace(/\u00a0/g,' ').match(/-?\d[\d\s]*(?:[.,]\d+)?/);return m?num(m[0].replace(/\s/g,'').replace(',','.'),NaN):NaN}
  function wallKwh(card){const m=text(card.textContent).match(/([0-9]+(?:[.,][0-9]+)?)\s*kWh\s+au compteur/i);return m?num(m[1].replace(',','.'),NaN):NaN}
  function physicalOperator(card){return text(card.querySelector('.operator-badge')?.textContent)}
  function applicablePrice(operator,basePrice,plan){
    const op=norm(operator);if(plan==='none')return null;
    if(op==='electra')return Math.max(0,basePrice-(plan==='smart'?.20:.10));
    if(plan==='smart'&&['atlante','fastned','ionity'].includes(op))return .49;
    return null;
  }
  function decorateElectra(){
    const root=$('results');if(!root)return;const st=electraState();
    root.querySelectorAll('.v8-electra-plus-row').forEach(x=>x.remove());
    root.querySelectorAll('.result-card[data-result-id]').forEach(card=>{
      delete card.dataset.electraEffectiveCost;
      const box=card.querySelector('.v8-offer-box');if(!box||st.plan==='none')return;
      const rows=[...box.querySelectorAll('.v8-offer-row:not(.v8-electra-plus-row)')];
      const electraRows=rows.filter(r=>/\bElectra\b/i.test(text(r.querySelector('.v8-offer-provider')?.textContent))&&!/Electroverse/i.test(text(r.querySelector('.v8-offer-provider')?.textContent)));
      if(!electraRows.length)return;
      const kwh=wallKwh(card),op=physicalOperator(card);if(!Number.isFinite(kwh))return;
      let candidates=[];
      electraRows.forEach(row=>{const price=parseNumber(row.querySelector('.v8-offer-price')?.textContent),total=parseNumber(row.querySelector('.v8-offer-total')?.textContent);if(!Number.isFinite(price)||!Number.isFinite(total))return;const subPrice=applicablePrice(op,price,st.plan);if(subPrice==null)return;const fees=Math.max(0,total-price*kwh),subTotal=fees+subPrice*kwh;candidates.push({price,total,subPrice,subTotal,row});});
      if(!candidates.length)return;candidates.sort((a,b)=>a.subTotal-b.subTotal);const c=candidates[0],name=st.plan==='smart'?'Electra+ Smart':'Electra+ Essential';
      const row=document.createElement('div');row.className='v8-offer-row v8-electra-plus-row';row.dataset.subscriptionTotal=String(c.subTotal);row.innerHTML=`<div class="v8-offer-provider">${name}<span class="v8-electra-tag">abonnement</span>${c.total-c.subTotal>.005?`<span class="v8-electra-saving">− ${euro(c.total-c.subTotal)}</span>`:''}</div><div class="v8-offer-price">${c.subPrice.toFixed(2)} EUR/kWh</div><div class="v8-offer-total">${euro(c.subTotal)}</div>`;box.querySelector('.v8-offer-note')?.before(row);
      if(st.includeRanking){rows.forEach(r=>{r.classList.remove('best');r.querySelector('.v8-offer-best')?.remove();});const all=[...rows,row].map(r=>({r,total:r===row?c.subTotal:parseNumber(r.querySelector('.v8-offer-total')?.textContent)})).filter(x=>Number.isFinite(x.total));const min=Math.min(...all.map(x=>x.total));all.forEach(x=>{if(Math.abs(x.total-min)<.01){x.r.classList.add('best');const p=x.r.querySelector('.v8-offer-provider');if(p&&!p.querySelector('.v8-offer-best'))p.insertAdjacentHTML('beforeend','<span class="v8-offer-best">✓ moins cher</span>');}});if(c.subTotal<=min+.01){const cost=card.querySelector('.cost');if(cost){cost.dataset.baseCost=cost.dataset.baseCost||text(cost.textContent);cost.textContent=euro(c.subTotal);}card.dataset.electraEffectiveCost=String(c.subTotal);}}
    });
    if(st.includeRanking&&$('simRanking')?.value==='cost'){
      const cards=[...root.querySelectorAll('.result-card[data-result-id]')];cards.sort((a,b)=>effectiveCost(a)-effectiveCost(b)).forEach(c=>root.appendChild(c));cards.forEach((c,i)=>{const h=c.querySelector('h3');if(h)h.textContent=text(h.textContent).replace(/^\d+\.\s*/,`${i+1}. `);});
    }
  }
  function effectiveCost(card){const sub=num(card.dataset.electraEffectiveCost,NaN);if(Number.isFinite(sub))return sub;return parseNumber(card.querySelector('.cost')?.textContent)||Infinity}
  function installCompareHook(){const current=window.compare;if(typeof current!=='function'||current.__tccRc4Electra)return false;if(!current.__tccDynamicOperatorsWrapped&&!current.__tccV8OfferDomWrapped)return false;const wrapped=async function(...args){const r=await current.apply(this,args);decorateElectra();return r};wrapped.__tccRc4Electra=true;wrapped.__tccDynamicOperatorsWrapped=true;wrapped.__tccV8OfferDomWrapped=true;window.compare=wrapped;try{compare=wrapped}catch(e){}return true}
  function install(){injectStyle();injectCustomFields();installCustomPower();injectElectraControls();installCompareHook();syncCustomUi();}
  let tries=0;const timer=setInterval(()=>{tries++;install();if(tries>180||($('v8CustomVehicleFields')&&$('v8ElectraBox')&&window.compare?.__tccRc4Electra))clearInterval(timer)},100);
  window.TCCV8RC4={decorateElectra,syncCustomUi};
})();
