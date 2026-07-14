const DAYS=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];let defaultStations=[],stations=[],routeResults={},fxRowSeq=0;const $=id=>document.getElementById(id);
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');if(b.dataset.tab==='stations')renderStations();if(b.dataset.tab==='fx')renderFxRates()});
$('simDate').valueAsDate=new Date();$('simTime').value=new Date().toTimeString().slice(0,5);$('simUnplugTime').value='';$('fUpdated').valueAsDate=new Date();$('simOrigin').value=localStorage.getItem('tccDefaultOrigin')||'';
function oldCustomStations(){let a=JSON.parse(localStorage.getItem('tccStationsV14')||'[]');return a.filter(x=>String(x.id||'').startsWith('station-'))}
function localStations(){return JSON.parse(localStorage.getItem('tccStationsV61')||localStorage.getItem('tccStationsV60')||'null')}
function oldLocalStations(){return JSON.parse(localStorage.getItem('tccStationsV25')||'null')}
function normalizePricingCurrency(pricing){
 if(!pricing)return pricing;
 if(pricing.type==='rules')(pricing.rules||[]).forEach(r=>r.currency=(r.currency||pricing.currency||'EUR').toUpperCase());
 else pricing.currency=(pricing.currency||'EUR').toUpperCase();
 return pricing;
}
function legacyConfiguration(st){
 return [{id:'main',label:`${st.kind||'AC'} ${Number(st.powerKw||11)} kW`,kind:st.kind||'AC',powerKw:Number(st.powerKw||11),stalls:Number(st.stalls||0)}];
}
function normalizeConfigurations(configs,st){
 let source=Array.isArray(configs)&&configs.length?configs:legacyConfiguration(st);
 return source.map((c,i)=>({id:c.id||`config-${i+1}`,label:c.label||`${c.kind||'AC'} ${Number(c.powerKw||11)} kW`,kind:c.kind||'AC',powerKw:Number(c.powerKw||11),stalls:Math.max(0,Math.round(Number(c.stalls||0)))}));
}
function normalizeStation(st,defaults={}){
 let merged={...defaults,...st};
 // Une nouvelle configuration publiée est adoptée seulement si l'ancienne fiche locale n'en possédait pas.
 let configurations=Array.isArray(st.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:defaults.chargingConfigurations;
 configurations=normalizeConfigurations(configurations,merged);
 let totalStalls=configurations.reduce((sum,c)=>sum+c.stalls,0);
 return {...merged,
   operator:st.operator||defaults.operator||((st.source||defaults.source)==='teslaSupercharger'?'Tesla':''),
   chargingConfigurations:configurations,
   stalls:totalStalls||st.stalls||defaults.stalls||0,
   kind:configurations[0].kind,
   powerKw:configurations[0].powerKw,
   pricing:normalizePricingCurrency(st.pricing||defaults.pricing)
 };
}
function stationConfigurations(st){return normalizeConfigurations(st.chargingConfigurations,st)}
function expandConfigurations(baseStations){
 return baseStations.flatMap(st=>stationConfigurations(st).map((cfg,index)=>({...st,id:`${st.id}::${cfg.id}`,baseStationId:st.id,configurationId:cfg.id,configurationLabel:cfg.label||`${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,totalSiteStalls:st.stalls,configurationIndex:index})));
}
function saveLocal(){localStorage.setItem('tccStationsV61',JSON.stringify(stations))}
function mins(t){let [h,m]=t.split(':').map(Number);return h*60+m}
function fmtMin(m){m=Math.max(0,m);let h=Math.floor(m/60),n=Math.round(m%60);return h?`${h} h ${String(n).padStart(2,'0')}`:`${n} min`}
function finishTime(dateStr,timeStr,durationMin){
 let start=new Date(`${dateStr}T${timeStr}:00`);
 let end=new Date(start.getTime()+Math.round(durationMin*60000));
 let startDay=new Date(start.getFullYear(),start.getMonth(),start.getDate());
 let endDay=new Date(end.getFullYear(),end.getMonth(),end.getDate());
 let delta=Math.round((endDay-startDay)/86400000);
 let hm=`${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`;
 if(delta===0)return hm;
 if(delta===1)return `demain à ${hm}`;
 return `${end.toLocaleDateString('fr-FR')} à ${hm}`;
}
function saveDefaultOrigin(){
 let origin=$('simOrigin').value.trim();
 if(!origin){alert('Saisis une adresse de départ.');return}
 localStorage.setItem('tccDefaultOrigin',origin);
 alert('Adresse enregistrée sur cet appareil.');
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function geoCache(){return JSON.parse(localStorage.getItem('tccGeoCacheV1')||'{}')}
function saveGeoCache(cache){localStorage.setItem('tccGeoCacheV1',JSON.stringify(cache))}
function routeCacheKey(origin,stationIds){return `tccRoutes:${origin.toLowerCase()}::${stationIds.join(',')}`}
function getCurrentPosition(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(new Error('Géolocalisation indisponible sur cet appareil.'));
  navigator.geolocation.getCurrentPosition(
   p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude,label:'Ma position'}),
   ()=>reject(new Error('La position actuelle n’a pas été autorisée.')),
   {enableHighAccuracy:true,timeout:12000,maximumAge:300000}
  )
 })
}
async function geocodeAddress(address){
 let key=address.trim().toLowerCase(),cache=geoCache();
 if(cache[key])return cache[key];
 let url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=fr&q='+encodeURIComponent(address);
 let response=await fetch(url,{headers:{'Accept':'application/json'}});
 if(!response.ok)throw new Error(`Géocodage impossible (${response.status}).`);
 let data=await response.json();
 if(!data.length)throw new Error(`Adresse non reconnue : ${address}`);
 let result={lat:+data[0].lat,lon:+data[0].lon,label:data[0].display_name};
 cache[key]=result;saveGeoCache(cache);
 return result
}
async function resolveOrigin(originText){
 if(!originText||originText.trim().toLowerCase()==='ma position')return getCurrentPosition();
 return geocodeAddress(originText)
}

function haversineKm(aLat,aLon,bLat,bLon){
 const R=6371,toRad=x=>x*Math.PI/180;
 let dLat=toRad(bLat-aLat),dLon=toRad(bLon-aLon);
 let q=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
 return 2*R*Math.asin(Math.sqrt(q));
}
async function candidateStations(filterMode='tesla'){
 let originText=$('simOrigin').value.trim()||localStorage.getItem('tccDefaultOrigin')||'Ma position';
 let origin=await resolveOrigin(originText);
 let candidates=stations.filter(s=>!s.temporarilyUnavailable&&(filterMode==='all'||(s.operator||'').toLowerCase()==='tesla'||s.source==='teslaSupercharger'));
 let cache=geoCache();
 for(let st of candidates){
   if(!Number.isFinite(st.latitude)||!Number.isFinite(st.longitude)){
     let key=(st.address||'').trim().toLowerCase();
     if(cache[key]){st.latitude=cache[key].lat;st.longitude=cache[key].lon}
     else if(st.address){
       try{let geo=await geocodeAddress(st.address);st.latitude=geo.lat;st.longitude=geo.lon;cache=geoCache()}catch(e){}
     }
   }
 }
 candidates=candidates.filter(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude));
 candidates.forEach(s=>s._airKm=haversineKm(origin.lat,origin.lon,s.latitude,s.longitude));
 let shortlist=candidates.sort((a,b)=>a._airKm-b._airKm).slice(0,Math.min(40,candidates.length));
 try{
   let coords=[`${origin.lon},${origin.lat}`,...shortlist.map(s=>`${s.longitude},${s.latitude}`)].join(';');
   let destinations=shortlist.map((_,i)=>i+1).join(';');
   let url=`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&destinations=${destinations}&annotations=distance,duration`;
   let response=await fetch(url);
   if(response.ok){
     let data=await response.json();
     if(data.code==='Ok')shortlist.forEach((s,i)=>{
       let d=data.distances?.[0]?.[i],t=data.durations?.[0]?.[i];
       if(d!=null&&t!=null)routeResults[s.id]={distanceKm:d/1000,durationMin:t/60,originLabel:origin.label};
     });
   }
 }catch(e){}
 return{origin,stations:shortlist};
}
function rankingWeights(mode){
 if(mode==='price')return{price:.7,distance:.3};
 if(mode==='distance')return{price:.3,distance:.7};
 return{price:.5,distance:.5};
}
function rankByPriceDistance(rows,mode){
 let available=rows.filter(x=>!x.r.unavailable&&!x.r.unknown&&Number.isFinite(x.r.total));
 if(!available.length)return rows.slice(0,20);
 let costs=available.map(x=>x.r.total),distances=available.map(x=>x.distanceKm);
 let minC=Math.min(...costs),maxC=Math.max(...costs),minD=Math.min(...distances),maxD=Math.max(...distances),w=rankingWeights(mode);
 available.forEach(x=>{
   let cn=maxC===minC?0:(x.r.total-minC)/(maxC-minC);
   let dn=maxD===minD?0:(x.distanceKm-minD)/(maxD-minD);
   x.score=w.price*cn+w.distance*dn;
 });
 return available.sort((a,b)=>a.score-b.score).slice(0,20);
}
async function calculateRoutes(){
 let button=$('routeButton');button.classList.add('loading');button.textContent='Calcul en cours…';
 $('routeStatus').textContent='Calcul des distances et du classement…';
 try{
   await compare();
 }finally{
   button.classList.remove('loading');button.textContent='Recalculer les 20 meilleures bornes';
 }
}
function routeHtml(st){
 let r=routeResults[st.id];
 if(!r)return '';
 if(r.error)return `<div class="routeinfo warn">${r.error}</div>`;
 return `<div class="routeinfo"><b>${r.distanceKm.toFixed(1)} km · ${Math.round(r.durationMin)} min</b><br>Trajet routier estimé depuis l’adresse de départ</div>`;
}

function dcCurvePower(soc,condition,profile,stationMax){
 let pts=[[0,175],[10,175],[20,170],[30,160],[40,145],[50,125],[60,105],[70,85],[80,60],[85,42],[90,28],[95,16],[98,10],[100,6]];
 let p=pts[pts.length-1][1];
 for(let i=1;i<pts.length;i++){
  if(soc<=pts[i][0]){let [x1,y1]=pts[i-1],[x2,y2]=pts[i];p=y1+(y2-y1)*(soc-x1)/(x2-x1);break}
 }
 let cf=condition==='warm'?1:(condition==='cold'?.68:.86);
 let pf=profile==='optimistic'?1.08:(profile==='conservative'?.88:1);
 return Math.max(3,Math.min(stationMax,p*cf*pf));
}
function acPowerAtSoc(soc,stationMax){
 let p=Math.min(11,stationMax);
 if(soc<97)return p;
 if(soc<99)return p*.72;
 return p*.42;
}


const DEFAULT_FX={EUR:1};
function getFxState(){
 let saved=JSON.parse(localStorage.getItem('tccFxRatesV1')||'null');
 return saved||window.publishedFxState||{base:'EUR',rates:{...DEFAULT_FX},updated:null,source:'manual'};
}
async function loadPublishedFx(){
 try{
   let data=await fetch('data/exchange_rates.json').then(r=>r.json());
   window.publishedFxState={base:'EUR',rates:{EUR:1,...(data.rates||{})},updated:data.date||null,source:'live'};
 }catch(e){}
}
function setFxState(state){localStorage.setItem('tccFxRatesV1',JSON.stringify(state))}
function fxToEur(amount,currency){
 let code=(currency||'EUR').toUpperCase(),state=getFxState();
 if(code==='EUR')return amount;
 let rate=state.rates?.[code];
 if(!rate||rate<=0)throw new Error(`Taux de conversion ${code}/EUR manquant`);
 return amount/rate;
}
function renderFxRates(){
 let state=getFxState(),codes=Object.keys(state.rates||{}).sort((a,b)=>a==='EUR'?-1:b==='EUR'?1:a.localeCompare(b));
 $('fxRows').innerHTML='';
 codes.forEach(code=>addFxRow(code,state.rates[code]));
 $('fxStatus').innerHTML=state.updated?`Dernière mise à jour : ${state.updated} · ${state.source==='live'?'en ligne':'manuelle'}`:'Aucune mise à jour enregistrée.';
}
function addFxRow(code='',rate=''){
 fxRowSeq+=1;let id=`fx-${fxRowSeq}`;
 $('fxRows').insertAdjacentHTML('beforeend',`<div class="fx-row" id="${id}">
 <div><label>Devise</label><input class="fx-code" maxlength="3" value="${String(code).toUpperCase()}"></div>
 <div><label>1 EUR =</label><input class="fx-rate" type="number" min="0" step=".000001" value="${rate}"></div>
 <button class="danger" ${String(code).toUpperCase()==='EUR'?'disabled':''} onclick="document.getElementById('${id}').remove()">×</button>
 </div>`);
}
function saveFxRates(){
 let rates={EUR:1};
 [...document.querySelectorAll('.fx-row')].forEach(row=>{
   let code=row.querySelector('.fx-code').value.trim().toUpperCase(),rate=+row.querySelector('.fx-rate').value;
   if(code&&rate>0)rates[code]=rate;
 });
 setFxState({base:'EUR',rates,updated:new Date().toLocaleString('fr-FR'),source:'manual'});
 renderFxRates();alert('Taux enregistrés sur cet appareil.');
}
async function updateLiveFx(){
 $('fxStatus').textContent='Mise à jour en cours…';
 try{
   let response=await fetch('https://api.frankfurter.app/latest?from=EUR');
   if(!response.ok)throw new Error(`Erreur ${response.status}`);
   let data=await response.json();
   let current=getFxState(),rates={...current.rates,EUR:1,...data.rates};
   setFxState({base:'EUR',rates,updated:data.date||new Date().toLocaleDateString('fr-FR'),source:'live'});
   renderFxRates();
 }catch(err){
   $('fxStatus').innerHTML=`<span class="bad">Mise à jour en ligne impossible : ${err.message}. Les taux manuels restent disponibles.</span>`;
 }
}
let pricingRuleSeq=0;
function ruleId(){pricingRuleSeq+=1;return `rule-${pricingRuleSeq}`}

function pricingRuleTemplate(rule={}){
 let id=ruleId(),scope=rule.scope||'allDay',billing=rule.billing||'kwh';
 return `<div class="pricing-rule" data-rule-id="${id}">
   <div class="rule-title"><b>Tarif</b><button type="button" class="danger" onclick="removePricingRule('${id}')">Supprimer</button></div>
   <div class="pricing-grid">
     <div><label>Application</label><select class="pr-scope" onchange="refreshPricingRule('${id}')">
       <option value="allDay" ${scope==='allDay'?'selected':''}>Toute la journée</option>
       <option value="timeWindow" ${scope==='timeWindow'?'selected':''}>Créneau horaire</option>
     </select></div>
     <div><label>Mode de facturation</label><select class="pr-billing" onchange="refreshPricingRule('${id}')">
       <option value="kwh" ${billing==='kwh'?'selected':''}>Tarif au kWh</option>
       <option value="minute" ${billing==='minute'?'selected':''}>Tarif à la minute</option>
     </select></div>
     <div><label>Devise</label><input class="pr-currency" list="currencyCodes" maxlength="3" value="${(rule.currency||'EUR').toUpperCase()}"></div>
     <div class="pr-time"><label>Début du créneau</label><input class="pr-start" type="time" value="${rule.start||'00:00'}"></div>
     <div class="pr-time"><label>Fin du créneau</label><input class="pr-end" type="time" value="${rule.end||'24:00'}"></div>
     <div class="pr-kwh"><label>Prix (€ / kWh)</label><input class="pr-price-kwh" type="number" min="0" step=".001" value="${rule.pricePerKwh??0.29}"></div>
     <div class="pr-minute"><label>Prix de charge (€ / min)</label><input class="pr-charge-min" type="number" min="0" step=".001" value="${rule.chargePerMinute??0}"></div>
     <div><label>Frais de connexion (€)</label><input class="pr-connection" type="number" min="0" step=".01" value="${rule.connectionFee??0}"></div>
     <div><label>Occupation sans charger (€ / min)</label><input class="pr-idle-min" type="number" min="0" step=".001" value="${rule.idlePerMinute??0}"></div>
   </div>
 </div>`;
}
function addPricingRule(rule={}){
 $('pricingRules').insertAdjacentHTML('beforeend',pricingRuleTemplate(rule));
 let el=$('pricingRules').lastElementChild;refreshPricingRule(el.dataset.ruleId);
}
function removePricingRule(id){
 let el=document.querySelector(`[data-rule-id="${id}"]`);if(el)el.remove();
 if(!$('pricingRules').children.length)addPricingRule();
}
function refreshPricingRule(id){
 let el=document.querySelector(`[data-rule-id="${id}"]`);if(!el)return;
 let scope=el.querySelector('.pr-scope').value,billing=el.querySelector('.pr-billing').value;
 el.querySelectorAll('.pr-time').forEach(x=>x.classList.toggle('hidden',scope!=='timeWindow'));
 el.querySelectorAll('.pr-kwh').forEach(x=>x.classList.toggle('hidden',billing!=='kwh'));
 el.querySelectorAll('.pr-minute').forEach(x=>x.classList.toggle('hidden',billing!=='minute'));
}
function readPricingRules(){
 return {type:'rules',rules:[...document.querySelectorAll('#pricingRules .pricing-rule')].map(el=>({
   scope:el.querySelector('.pr-scope').value,start:el.querySelector('.pr-start').value||'00:00',end:el.querySelector('.pr-end').value||'24:00',
   billing:el.querySelector('.pr-billing').value,currency:(el.querySelector('.pr-currency').value||'EUR').trim().toUpperCase(),pricePerKwh:+el.querySelector('.pr-price-kwh').value||0,
   chargePerMinute:+el.querySelector('.pr-charge-min').value||0,connectionFee:+el.querySelector('.pr-connection').value||0,
   idlePerMinute:+el.querySelector('.pr-idle-min').value||0
 }))};
}
function legacyPricingToRules(pricing){
 if(!pricing)return[{scope:'allDay',billing:'kwh',currency:'EUR',pricePerKwh:.29,connectionFee:0,idlePerMinute:0}];
 if(pricing.type==='rules')return(pricing.rules||[]).map(r=>({...r,currency:(r.currency||pricing.currency||'EUR').toUpperCase()}));
 if(pricing.type==='kwh')return[{scope:'allDay',billing:'kwh',currency:(pricing.currency||'EUR').toUpperCase(),pricePerKwh:pricing.pricePerKwh||0,connectionFee:0,idlePerMinute:0}];
 if(pricing.type==='timeBandsKwh')return(pricing.bands||[]).map(b=>({scope:'timeWindow',start:b.start,end:b.end,billing:'kwh',currency:(b.currency||pricing.currency||'EUR').toUpperCase(),pricePerKwh:b.pricePerKwh||0,connectionFee:0,idlePerMinute:0}));
 if(pricing.type==='kwhPlusParking')return[{scope:'allDay',billing:'kwh',pricePerKwh:pricing.pricePerKwh||0,connectionFee:0,idlePerMinute:pricing.parkingPerMinute||0}];
 if(pricing.type==='accessPlusTime')return[
  {scope:'timeWindow',start:pricing.dayStart||'08:00',end:pricing.dayEnd||'20:00',billing:'minute',chargePerMinute:(pricing.dayPerHour||0)/60,connectionFee:pricing.accessFee||0,idlePerMinute:0},
  {scope:'timeWindow',start:pricing.dayEnd||'20:00',end:pricing.dayStart||'08:00',billing:'minute',chargePerMinute:(pricing.nightPerHour||0)/60,connectionFee:pricing.accessFee||0,idlePerMinute:0}
 ];
 if(pricing.type==='freeWindowUnknownAfter')return[{scope:'allDay',billing:'minute',chargePerMinute:0,connectionFee:0,idlePerMinute:0}];
 return[{scope:'allDay',billing:'kwh',pricePerKwh:.29,connectionFee:0,idlePerMinute:0}];
}
function loadPricingRules(pricing){
 $('pricingRules').innerHTML='';let rules=legacyPricingToRules(pricing);if(!rules.length)rules=[{}];rules.forEach(addPricingRule);
}
function toggleAccessMode(){
 let scheduled=$('fAccessMode').value==='schedule';$('scheduleBox').classList.toggle('hidden',!scheduled);
}
function minuteOfSession(startMin,offset){return(startMin+offset)%1440}
function inWindow(m,start,end){
 let s=mins(start),e=end==='24:00'?1440:mins(end);if(s===e)return true;return s<e?(m>=s&&m<e):(m>=s||m<e);
}
function ruleForMinute(rules,m){
 let specific=(rules||[]).find(r=>r.scope==='timeWindow'&&inWindow(m,r.start||'00:00',r.end||'24:00'));
 return specific||(rules||[]).find(r=>r.scope==='allDay')||null;
}
function unplugDurationMinutes(startTime,chargeMinutes,unplugTime){
 if(!unplugTime)return chargeMinutes;
 let start=mins(startTime),unplug=mins(unplugTime),duration=unplug-start;if(duration<0)duration+=1440;
 return Math.max(chargeMinutes,duration);
}
function priceWithRules(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime){
 let rules=pp.rules||[],startRule=ruleForMinute(rules,startMin);if(!startRule)return{error:'Aucun tarif applicable à l’heure de branchement'};
 let currencies=new Set(),connection=0,chargeCost=0,idleCost=0,energyPerMinute=chargeMinutes>0?billedEnergy/chargeMinutes:0;
 try{
   currencies.add((startRule.currency||'EUR').toUpperCase());
   connection=fxToEur(startRule.connectionFee||0,startRule.currency||'EUR');
   for(let i=0;i<Math.ceil(chargeMinutes);i++){
     let m=minuteOfSession(startMin,i),rule=ruleForMinute(rules,m);if(!rule)return{error:'Aucun tarif défini pour une partie de la charge'};
     let fraction=Math.min(1,chargeMinutes-i),currency=(rule.currency||'EUR').toUpperCase();currencies.add(currency);
     let raw=rule.billing==='kwh'?energyPerMinute*fraction*(rule.pricePerKwh||0):fraction*(rule.chargePerMinute||0);
     chargeCost+=fxToEur(raw,currency);
   }
   let occupied=unplugDurationMinutes(startTime,chargeMinutes,unplugTime);
   for(let i=Math.ceil(chargeMinutes);i<Math.ceil(occupied);i++){
     let rule=ruleForMinute(rules,minuteOfSession(startMin,i));if(!rule)continue;
     let currency=(rule.currency||'EUR').toUpperCase();currencies.add(currency);
     idleCost+=fxToEur(rule.idlePerMinute||0,currency);
   }
   return{total:connection+chargeCost+idleCost,connection,chargeCost,idleCost,occupiedMinutes:occupied,currencies:[...currencies]};
 }catch(err){return{error:err.message}}
}
function daySchedule(st,dateStr){let d=new Date(dateStr+'T12:00:00');return st.access?.days?.[String(d.getDay())]}
function accessStatus(st,dateStr,timeStr){if(!st.access?.limited)return{canStart:true,remaining:Infinity,label:'Accessible 24 h/24'};let sch=daySchedule(st,dateStr);if(!sch||!sch.open)return{canStart:false,remaining:0,label:'Fermé ce jour'};let t=mins(timeStr),s=mins(sch.start),e=sch.end==='24:00'?1440:mins(sch.end);if(t<s||t>=e)return{canStart:false,remaining:0,label:`Accessible ${sch.start}–${sch.end}`};return{canStart:true,remaining:e-t,label:`Accessible ${sch.start}–${sch.end}`,close:sch.end}}
function chargeBase(st,now,target,condition='normal',profile='realistic'){
 const cap=75,loss=st.kind==='AC'?.10:.05;
 let batt=cap*(target-now)/100,billed=batt/(1-loss),minutes=0;
 for(let soc=now;soc<target;soc+=1){
  let next=Math.min(target,soc+1),batteryKwh=cap*(next-soc)/100,wallKwh=batteryKwh/(1-loss);
  let power=st.kind==='AC'?acPowerAtSoc((soc+next)/2,st.powerKw):dcCurvePower((soc+next)/2,condition,profile,st.powerKw);
  minutes+=(wallKwh/power)*60;
 }
 return{batt,billed,minutes,avg:billed/(minutes/60)}
}
function bandAt(pp,m){return pp.bands.find(x=>m>=mins(x.start)&&m<(x.end==='24:00'?1440:mins(x.end)))}
function energyCostBands(pp,startMin,durationMin,totalEnergy){let cost=0,remaining=durationMin,cur=startMin,energyPerMin=totalEnergy/durationMin;while(remaining>0){let m=cur%1440,b=bandAt(pp,m);if(!b)return null;let end=b.end==='24:00'?1440:mins(b.end),chunk=Math.min(remaining,end-m);cost+=chunk*energyPerMin*b.pricePerKwh;cur+=chunk;remaining-=chunk}return cost}
function minutesInWindow(start,duration,ws,we){let s=mins(ws),e=mins(we),c=0;for(let i=0;i<Math.ceil(duration);i++){let m=(start+i)%1440;if(s<e?(m>=s&&m<e):(m>=s||m<e))c++}return c}
function simulate(st,dateStr,timeStr,now,target,condition='normal',profile='realistic',unplugTime=''){
 let a=accessStatus(st,dateStr,timeStr);if(!a.canStart)return{unavailable:true,message:a.label};
 let b=chargeBase(st,now,target,condition,profile),allowed=b.minutes,truncated=false;
 if(st.access?.limited&&st.access.afterCloseMode==='must_stop'&&b.minutes>a.remaining){allowed=a.remaining;truncated=true}
 let ratio=allowed/b.minutes,deliveredBilled=b.billed*ratio,deliveredBatt=b.batt*ratio,reached=now+(target-now)*ratio,start=mins(timeStr),pp=st.pricing,total=0,unknown=false;
 let pricingDetails={connection:0,chargeCost:0,idleCost:0,occupiedMinutes:allowed};
 if(pp.type==='rules'){let priced=priceWithRules(pp,start,allowed,deliveredBilled,unplugTime,timeStr);if(priced.error)return{unavailable:true,message:priced.error};total=priced.total;pricingDetails=priced}
 else if(pp.type==='kwh')total=fxToEur(deliveredBilled*pp.pricePerKwh,pp.currency||'EUR');
 else if(pp.type==='timeBandsKwh'){let c=energyCostBands(pp,start,allowed,deliveredBilled);if(c===null)return{unavailable:true,message:'Tarif absent pour une partie de la session'};total=c}
 else if(pp.type==='kwhPlusParking'){let parking=Math.max(0,allowed-pp.freeMinutes)*pp.parkingPerMinute;if(minutesInWindow((start+pp.freeMinutes)%1440,Math.max(0,allowed-pp.freeMinutes),pp.nightStart,pp.nightEnd)>0)parking=Math.min(parking,pp.nightCap);total=deliveredBilled*pp.pricePerKwh+parking;pricingDetails.idleCost=parking}
 else if(pp.type==='accessPlusTime'){let paid=Math.max(0,allowed-pp.freeMinutes),dayM=minutesInWindow((start+pp.freeMinutes)%1440,paid,pp.dayStart,pp.dayEnd);total=pp.accessFee+dayM*(pp.dayPerHour/60);pricingDetails.connection=pp.accessFee||0;pricingDetails.chargeCost=dayM*(pp.dayPerHour/60)}
 else if(pp.type==='freeWindowUnknownAfter'){if(allowed<=pp.freeMinutes)total=0;else unknown=true}
 return{...b,allowed,deliveredBilled,deliveredBatt,reached,total,truncated,access:a,unknown,pricingDetails}
}
async function compare(){
 let now=+$('simNow').value,target=+$('simTarget').value,date=$('simDate').value,time=$('simTime').value;
 let condition=$('simCondition').value,profile=$('simProfile').value,unplugTime=$('simUnplugTime').value;
 let filterMode=$('simOperatorFilter').value,rankingMode=$('simRanking').value;
 if(target<=now){$('results').innerHTML='<div class="bad">Objectif invalide.</div>';return}
 $('results').innerHTML='<div class="small">Calcul du classement prix + distance…</div>';
 try{
   let prepared=await candidateStations(filterMode);
   let expanded=expandConfigurations(prepared.stations);
   let rows=expanded.map(st=>{
     let baseId=st.baseStationId||st.id,route=routeResults[baseId],distanceKm=route?.distanceKm??st._airKm;
     return{st,distanceKm,r:simulate(st,date,time,now,target,condition,profile,unplugTime)};
   });
   let ranked=rankByPriceDistance(rows,rankingMode);
   $('routeStatus').innerHTML=`<span class="good">${ranked.length} borne(s) affichée(s) depuis ${prepared.origin.label}.</span>`;
   if(!ranked.length){$('results').innerHTML='<div class="warn">Aucune borne exploitable n’a été trouvée.</div>';return}
   $('results').innerHTML=ranked.map(({st,r,distanceKm,score},idx)=>{
    let route=routeResults[st.baseStationId||st.id],distance=route?`${route.distanceKm.toFixed(1)} km · ${Math.round(route.durationMin)} min`:`≈ ${distanceKm.toFixed(1)} km à vol d’oiseau`;
    let operator=st.operator||'Opérateur non renseigné';
    let currencies=r.pricingDetails?.currencies?.length?r.pricingDetails.currencies.join(', '):'EUR';
    let info='';
    if(st.access?.limited&&st.access.afterCloseMode==='exit_allowed')info=`<div class="good small">✓ Entrée avant ${r.access.close}; la charge peut continuer après fermeture.</div>`;
    if(r.truncated)info=`<div class="warn small"><b>Charge arrêtée à ${r.access.close}</b><br>Niveau estimé : ${r.reached.toFixed(0)} %.</div>`;
    let taper=target>80&&st.kind==='DC'?`<div class="warn small">Le ralentissement au-dessus de 80 % est inclus.</div>`:'';
    let breakdown=r.pricingDetails&&(r.pricingDetails.connection||r.pricingDetails.idleCost)?`<div class="small">Connexion : ${(r.pricingDetails.connection||0).toFixed(2)} € · Occupation : ${(r.pricingDetails.idleCost||0).toFixed(2)} €</div>`:'';
    return`<div class="station"><div class="station-head"><div><h3>${idx+1}. ${st.name} — ${st.configurationLabel||`${st.kind} ${st.powerKw} kW`}</h3><span class="badge operator-badge">${operator}</span><span class="badge">${st.kind}</span><span class="badge">${st.powerKw} kW</span>${st.stalls?`<span class="badge">${st.stalls} point${st.stalls>1?'s':''} sur cette puissance</span>`:''}${st.totalSiteStalls?`<span class="badge">${st.totalSiteStalls} au total sur le site</span>`:''}<span class="badge currency-badge">${currencies} → EUR</span><span class="badge">MAJ ${st.lastUpdated||'—'}</span></div><div class="cost">${r.total.toFixed(2)} €</div></div><div class="routeinfo"><b>${distance}</b></div><div class="scorebox">Classement combiné prix + distance</div><div class="small">${r.access.label}<br><b>${fmtMin(r.allowed)}</b> · fin estimée : <b>${finishTime(date,time,r.allowed)}</b><br>${r.deliveredBilled.toFixed(1)} kWh facturés · puissance moyenne ≈ ${r.avg.toFixed(0)} kW</div>${breakdown}${info}${taper}<div class="row" style="margin-top:9px"><button class="secondary" onclick="window.open('${mapsUrl(st.address)}','_blank')">Itinéraire Google Maps</button>${st.teslaUrl?`<button class="secondary" onclick="window.open('${st.teslaUrl}','_blank')">Fiche Tesla</button>`:''}</div></div>`;
   }).join('');
 }catch(err){
   $('results').innerHTML=`<div class="bad">${err.message}</div>`;
   $('routeStatus').innerHTML='<span class="bad">Impossible de calculer le classement. Vérifie l’adresse, la devise et les taux.</span>';
 }
}
function mapsUrl(a){
 let origin=$('simOrigin')?.value?.trim()||localStorage.getItem('tccDefaultOrigin')||'';
 let url='https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+encodeURIComponent(a);
 if(origin&&origin.toLowerCase()!=='ma position')url+='&origin='+encodeURIComponent(origin);
 return url
}

function showTeslaSyncInfo(){
 $('teslaSyncInfo').innerHTML=`1. Ouvre la <b>Fiche Tesla</b> de la station. 2. Vérifie le prix membre Tesla et ses créneaux. 3. Clique sur <b>Modifier</b>. 4. Mets à jour les tarifs, la devise et la date. 5. Enregistre la borne. Les changements restent sur cet appareil.`;
}
function renderStations(){
 $('stationList').innerHTML=stations.map(st=>`<div class="station ${st.temporarilyUnavailable?'disabled-station':''}">
 <div class="station-head">
  <div>
   <h3>${st.name}</h3>${st.operator?`<span class="badge operator-badge">${st.operator}</span>`:''}${st.stalls?`<span class="badge">${st.stalls} point${st.stalls>1?'s':''} au total</span>`:''}<div style="margin-top:6px">${stationConfigurations(st).map(c=>`<span class="badge">${c.stalls?`${c.stalls} × `:''}${c.kind} ${c.powerKw} kW</span>`).join('')}</div>
   ${st.temporarilyUnavailable?'<span class="badge badge-unavailable">Temporairement indisponible</span>':''}
   <div class="small">${st.address||'Aucune adresse'}<br>${st.access?.limited?(st.access.afterCloseMode==='exit_allowed'?'Charge possible après fermeture':'Arrêt obligatoire à la fermeture'):'Accessible 24 h/24'}</div>
   ${routeHtml(st)}
  </div>
 </div>
 <div class="row" style="margin-top:10px">
  ${st.address?`<button class="secondary" onclick="window.open('${mapsUrl(st.address)}','_blank')">Itinéraire Google Maps</button>`:''}
  <button class="secondary" onclick="toggleStationAvailability('${st.id}')">${st.temporarilyUnavailable?'Réactiver':'Marquer indisponible'}</button>
  <button class="secondary" onclick="editStation('${st.id}')">Modifier</button>
  <button class="danger" onclick="deleteStation('${st.id}')">Supprimer</button>
 </div>
 </div>`).join('')
}
function toggleStationAvailability(id){
 let st=stations.find(x=>x.id===id);
 if(!st)return;
 st.temporarilyUnavailable=!st.temporarilyUnavailable;
 saveLocal();
 renderStations();
 compare();
}
let chargingConfigSeq=0;
function chargingConfigurationTemplate(config={}){
 let id=`charge-config-${++chargingConfigSeq}`,kind=config.kind||'AC',power=Number(config.powerKw||11),stalls=Math.max(0,Math.round(Number(config.stalls||0)));
 return `<div class="charge-config" data-charge-config="${id}"><div class="row" style="justify-content:space-between"><b>Configuration</b><button type="button" class="danger" onclick="removeChargingConfiguration('${id}')">Supprimer</button></div><div class="charge-config-grid"><div><label>Libellé</label><input class="cc-label" value="${config.label||`${kind} ${power} kW`}"></div><div><label>Type</label><select class="cc-kind"><option ${kind==='AC'?'selected':''}>AC</option><option ${kind==='DC'?'selected':''}>DC</option></select></div><div><label>Puissance (kW)</label><input class="cc-power" type="number" min="1" step="1" value="${power}"></div><div><label>Nombre de points</label><input class="cc-stalls" type="number" min="0" step="1" value="${stalls}"></div></div></div>`;
}
function addChargingConfiguration(config={}){$('chargingConfigurations').insertAdjacentHTML('beforeend',chargingConfigurationTemplate(config))}
function removeChargingConfiguration(id){let el=document.querySelector(`[data-charge-config="${id}"]`);if(el)el.remove();if(!$('chargingConfigurations').children.length)addChargingConfiguration()}
function loadChargingConfigurations(configs,st={}){$('chargingConfigurations').innerHTML='';normalizeConfigurations(configs,st).forEach(addChargingConfiguration)}
function readChargingConfigurations(){
 let configs=[...document.querySelectorAll('#chargingConfigurations .charge-config')].map((el,i)=>{let kind=el.querySelector('.cc-kind').value,power=Math.max(1,Number(el.querySelector('.cc-power').value||11));return{id:`config-${i+1}`,label:el.querySelector('.cc-label').value.trim()||`${kind} ${power} kW`,kind,powerKw:power,stalls:Math.max(0,Math.round(Number(el.querySelector('.cc-stalls').value||0)))}});
 return configs.length?configs:[{id:'main',label:'AC 11 kW',kind:'AC',powerKw:11,stalls:0}];
}
function buildDays(){$('daysForm').innerHTML=DAYS.map((d,i)=>`<div class="dayrow"><b>${d}</b><label><input id="dOpen${i}" type="checkbox"> ouvert</label><input id="dStart${i}" type="time" value="09:00"><input id="dEnd${i}" type="time" value="20:00"></div>`).join('')}
function resetForm(){
 $('formTitle').textContent='Ajouter une borne';$('editId').value='';$('fName').value='';$('fOperator').value='';$('fAddress').value='';loadChargingConfigurations([{id:'main',label:'AC 11 kW',kind:'AC',powerKw:11,stalls:1}]);
 $('fAccessMode').value='always';$('fTemporarilyUnavailable').checked=false;$('fCloseMode').value='must_stop';$('fCloseNote').value='';$('fUpdated').valueAsDate=new Date();
 for(let i=0;i<7;i++){$('dOpen'+i).checked=true;$('dStart'+i).value='00:00';$('dEnd'+i).value='24:00'}
 loadPricingRules({type:'kwh',pricePerKwh:.29});toggleAccessMode();
}
function editStation(id){
 let st=stations.find(x=>x.id===id);if(!st)return;document.querySelector('[data-tab="edit"]').click();
 $('formTitle').textContent='Modifier la borne';$('editId').value=st.id;$('fName').value=st.name;$('fOperator').value=st.operator||'';$('fAddress').value=st.address||'';loadChargingConfigurations(st.chargingConfigurations,st);
 $('fAccessMode').value=st.access?.limited?'schedule':'always';$('fTemporarilyUnavailable').checked=!!st.temporarilyUnavailable;$('fCloseMode').value=st.access?.afterCloseMode||'must_stop';$('fCloseNote').value=st.access?.afterCloseNote||'';$('fUpdated').value=st.lastUpdated||new Date().toISOString().slice(0,10);
 for(let i=0;i<7;i++){let d=st.access?.days?.[String(i)]||{open:true,start:'00:00',end:'24:00'};$('dOpen'+i).checked=d.open;$('dStart'+i).value=d.start;$('dEnd'+i).value=d.end}
 loadPricingRules(st.pricing);toggleAccessMode();
}
function saveStation(){
 let id=$('editId').value||('station-'+Date.now()),days={};
 for(let i=0;i<7;i++)days[String(i)]={open:$('dOpen'+i).checked,start:$('dStart'+i).value,end:$('dEnd'+i).value};
 let i=stations.findIndex(x=>x.id===id),existing=i>=0?stations[i]:{};
 let configs=readChargingConfigurations(),totalStalls=configs.reduce((sum,c)=>sum+c.stalls,0),first=configs[0];
 let st={...existing,id,name:$('fName').value.trim()||'Nouvelle borne',operator:$('fOperator').value.trim(),stalls:totalStalls,address:$('fAddress').value.trim(),kind:first.kind,source:existing.source||'custom',powerKw:first.powerKw,chargingConfigurations:configs,pricing:readPricingRules(),lastUpdated:$('fUpdated').value,temporarilyUnavailable:$('fTemporarilyUnavailable').checked,access:{limited:$('fAccessMode').value==='schedule',days,afterCloseMode:$('fCloseMode').value,afterCloseNote:$('fCloseNote').value.trim()}};
 if(i>=0)stations[i]=st;else stations.push(st);saveLocal();renderStations();resetForm();alert('Borne enregistrée.');
}
function deleteStation(id){if(confirm('Supprimer cette borne ?')){stations=stations.filter(x=>x.id!==id);saveLocal();renderStations()}}
loadPublishedFx().then(()=>Promise.all([
 fetch('data/tesla_stations.json').then(r=>r.json()),
 fetch('data/custom_stations.json').then(r=>r.json()),
 fetch('data/metadata.json').then(r=>r.json()).catch(()=>({}))
])).then(([teslaData,customData,metadata])=>{
 defaultStations=[...teslaData,...customData].map(s=>normalizeStation(s));
 let saved=localStations();
 if(saved){
   stations=saved.map(s=>normalizeStation(s,defaultStations.find(d=>d.id===s.id)||{}));
   // Add newly published stations that do not yet exist locally.
   for(let official of defaultStations){
     if(!stations.some(s=>s.id===official.id))stations.push(official);
   }
 }else{
   let old=oldLocalStations();
   stations=old?old.map(s=>normalizeStation(s,defaultStations.find(d=>d.id===s.id)||{})):defaultStations;
   saveLocal();
 }
 $('results').innerHTML='<div class="small">Saisis une adresse de départ puis touche Simuler pour afficher jusqu’à 20 bornes selon le prix et la distance.</div>';
 if($('dataFreshness')){
   let teslaDate=metadata.teslaUpdated||'inconnue',fxDate=metadata.fxUpdated||'inconnue';
   $('dataFreshness').innerHTML=`Base Tesla : ${teslaDate}<br>Taux de change : ${fxDate}`;
 }
 renderStations();renderFxRates();
}).catch(err=>{
 $('results').innerHTML=`<div class="bad">Chargement des données impossible : ${err.message}</div>`;
});
buildDays();resetForm();
