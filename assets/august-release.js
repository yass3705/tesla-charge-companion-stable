/* Tesla Charge Companion — August 2026 release layer (V8.0 RC1)
 * Loaded after app.js + dedupe.js. Keeps the V7.3 data model compatible while
 * adding the August simulation, filters, station UX and map view.
 */
(function(){
  'use strict';

  const AUG_VERSION='8.0 RC1';
  const AUG_SETTINGS_KEY='tccAugustSettingsV1';
  const AUG_TEMPLATES_KEY='tccStationTemplatesV1';
  const AUG_CONGESTION_KEY='tccCongestionSimulationV1';
  const AUG_DUP_IGNORE_KEY='tccCustomDuplicateIgnoreV1';
  const COUNTRY_NAMES={BE:'Belgique',CH:'Suisse',ES:'Espagne',FR:'France',LU:'Luxembourg',MA:'Maroc',NL:'Pays-Bas',PT:'Portugal',DE:'Allemagne',IT:'Italie',GB:'Royaume-Uni'};
  const OPERATOR_ALIASES={
    'total energies':'TotalEnergies','totalenergies':'TotalEnergies','total energie':'TotalEnergies',
    'tesla':'Tesla','swish':'Swish','izivia':'Izivia','alize':'Alizé','alizé':'Alizé',
    'kilowatt':'Kilowatt','iecharge':'IECharge','fastvolt':'FastVolt'
  };
  let lastRows=[];
  let lastPreparedOrigin=null;
  let congestionState=safeJsonParse(localStorage.getItem(AUG_CONGESTION_KEY)||'{}',{})||{};
  let editorSnapshot=null;
  let editorGuardBypass=false;
  let mapInstance=null;
  let mapCluster=null;
  let leafletPromise=null;
  let publishedTemplates=[];

  function augSettings(){
    return {
      batteryCapacity:75,
      referenceConsumption:16,
      consumptionMode:'simple',
      cityConsumption:12,
      fastConsumption:10,
      motorwayConsumption:18,
      safetySoc:8,
      preconditioning:'normal',
      preconditioningCustom:1,
      ...safeJsonParse(localStorage.getItem(AUG_SETTINGS_KEY)||'{}',{})
    };
  }
  function saveAugSettings(){
    const s={
      batteryCapacity:num('simBatteryCapacity',75),
      referenceConsumption:num('simConsumption',16),
      consumptionMode:val('simConsumptionMode','simple'),
      cityConsumption:num('simCityConsumption',12),
      fastConsumption:num('simFastConsumption',10),
      motorwayConsumption:num('simMotorwayConsumption',18),
      safetySoc:num('simSafetySoc',8),
      preconditioning:val('simPrecondition','normal'),
      preconditioningCustom:num('simPreconditionCustom',1)
    };
    localStorage.setItem(AUG_SETTINGS_KEY,JSON.stringify(s));
    return {...augSettings(),...s};
  }
  function num(id,fallback=0){
    let n=Number($(id)?.value);
    return Number.isFinite(n)?n:fallback;
  }
  function val(id,fallback=''){return $(id)?.value??fallback}
  function esc(v){return escapeHtml(v==null?'':v)}
  function today(){return new Date().toISOString().slice(0,10)}
  function deepClone(v){return JSON.parse(JSON.stringify(v))}
  function plain(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
  function normalizeOperator(v){
    let p=plain(v).replace(/\s+/g,' ');
    return OPERATOR_ALIASES[p]||String(v||'').trim()||'Autre / opérateur non renseigné';
  }
  function stationCountry(st){
    if(st.countryCode)return String(st.countryCode).toUpperCase();
    let a=plain(st.address);
    for(const [code,name] of Object.entries(COUNTRY_NAMES)){
      if(a.includes(plain(name)))return code;
    }
    if(a.includes('belgium'))return'BE'; if(a.includes('switzerland'))return'CH'; if(a.includes('spain'))return'ES';
    if(a.includes('france'))return'FR'; if(a.includes('morocco'))return'MA'; if(a.includes('netherlands'))return'NL';
    if(a.includes('portugal'))return'PT';
    return'';
  }
  function unplugWindowMinutes(startTime,unplugTime){
    if(!unplugTime)return Infinity;
    let d=mins(unplugTime)-mins(startTime);
    if(d<0)d+=1440;
    return d;
  }
  function routeConsumptionProfile(route,s){
    let ref=Math.max(1,Number(s.referenceConsumption||16));
    if(s.consumptionMode!=='adaptive'||!route||!Number.isFinite(route.durationMin)||route.durationMin<=0){
      return{average:ref,city:0,fast:0,motorway:0,label:`moyenne véhicule ${ref.toFixed(1)} kWh/100 km`};
    }
    let speed=route.distanceKm/(route.durationMin/60);
    let mix;
    if(speed<35)mix={city:.70,fast:.25,motorway:.05};
    else if(speed<55)mix={city:.40,fast:.50,motorway:.10};
    else if(speed<80)mix={city:.15,fast:.60,motorway:.25};
    else if(speed<105)mix={city:.05,fast:.30,motorway:.65};
    else mix={city:.02,fast:.13,motorway:.85};
    let average=mix.city*s.cityConsumption+mix.fast*s.fastConsumption+mix.motorway*s.motorwayConsumption;
    return{...mix,average,speed,label:`profil estimé ${Math.round(mix.city*100)} % ville · ${Math.round(mix.fast*100)} % voie rapide · ${Math.round(mix.motorway*100)} % autoroute`};
  }
  function preconditioningKwh(st,s){
    if(st.source!=='teslaSupercharger'||st.kind!=='DC')return 0;
    const map={none:0,light:.5,normal:1,strong:1.5};
    return s.preconditioning==='custom'?Math.max(0,s.preconditioningCustom||0):(map[s.preconditioning]??1);
  }
  function chargingBase(st,startSoc,endSoc,s,condition='normal',profile='realistic'){
    const cap=Math.max(20,Number(s.batteryCapacity||75));
    const loss=st.kind==='AC'?.10:.05;
    let batt=0,billed=0,minutes=0,segments=[];
    startSoc=Math.max(0,Math.min(100,startSoc)); endSoc=Math.max(startSoc,Math.min(100,endSoc));
    for(let soc=startSoc;soc<endSoc-1e-9;){
      let next=Math.min(endSoc,Math.floor(soc+1e-9)+1);
      if(next<=soc)next=Math.min(endSoc,soc+1);
      let batteryKwh=cap*(next-soc)/100,wallKwh=batteryKwh/(1-loss);
      let mid=(soc+next)/2;
      let power=st.kind==='AC'?acPowerAtSoc(mid,st.powerKw):dcCurvePower(mid,condition,profile,st.powerKw);
      let segmentMinutes=(wallKwh/Math.max(.1,power))*60;
      segments.push({startMin:minutes,endMin:minutes+segmentMinutes,powerKw:power,wallKwh,batteryKwh,startSoc:soc,endSoc:next});
      batt+=batteryKwh;billed+=wallKwh;minutes+=segmentMinutes;soc=next;
    }
    return{batt,billed,minutes,avg:minutes>0?billed/(minutes/60):0,segments};
  }
  function trimChargeToMinutes(base,maxMinutes,startSoc,s){
    if(!Number.isFinite(maxMinutes)||maxMinutes>=base.minutes-1e-9)return{...base,reached:startSoc+(base.batt/Math.max(1,s.batteryCapacity))*100};
    if(maxMinutes<=0)return{batt:0,billed:0,minutes:0,avg:0,segments:[],reached:startSoc};
    let batt=0,billed=0,segments=[],used=0;
    for(const seg of base.segments){
      if(used>=maxMinutes-1e-9)break;
      let span=seg.endMin-seg.startMin;
      let take=Math.min(span,maxMinutes-used),ratio=span>0?take/span:0;
      segments.push({...seg,startMin:used,endMin:used+take,wallKwh:seg.wallKwh*ratio,batteryKwh:seg.batteryKwh*ratio,endSoc:seg.startSoc+(seg.endSoc-seg.startSoc)*ratio});
      billed+=seg.wallKwh*ratio;batt+=seg.batteryKwh*ratio;used+=take;
    }
    let reached=startSoc+(batt/Math.max(1,s.batteryCapacity))*100;
    return{batt,billed,minutes:used,avg:used>0?billed/(used/60):0,segments,reached};
  }
  function legacyPrice(st,startMin,charge,unplugTime,startTime){
    let pp=st.pricing,total=0,unknown=false,pricingDetails={connection:0,chargeCost:0,idleCost:0,durationSurcharge:0,occupiedMinutes:charge.minutes,currencies:['EUR']};
    if(pp?.type==='rules'){
      if(!(pp.rules||[]).length)return{total:NaN,unknown:true,message:'Tarif non disponible',pricingDetails};
      let priced=priceWithRules(pp,startMin,charge.minutes,charge.billed,unplugTime,startTime,charge.segments);
      if(priced.error)return{total:NaN,unknown:true,message:priced.error,pricingDetails};
      return{total:priced.total,unknown:false,pricingDetails:priced};
    }
    try{
      if(pp?.type==='kwh'){
        let c=pp.currency||'EUR'; total=fxToEur(charge.billed*(pp.pricePerKwh||0),c);pricingDetails.chargeCost=total;pricingDetails.currencies=[c];
      }else if(pp?.type==='timeBandsKwh'){
        let raw=energyCostBands(pp,startMin,charge.minutes,charge.billed);if(raw===null)return{total:NaN,unknown:true,message:'Tarif absent pour une partie de la session',pricingDetails};
        let c=pp.currency||'EUR';total=fxToEur(raw,c);pricingDetails.chargeCost=total;pricingDetails.currencies=[c];
      }else if(pp?.type==='kwhPlusParking'){
        let c=pp.currency||'EUR',parking=Math.max(0,charge.minutes-(pp.freeMinutes||0))*(pp.parkingPerMinute||0);
        if(pp.nightCap&&minutesInWindow((startMin+(pp.freeMinutes||0))%1440,Math.max(0,charge.minutes-(pp.freeMinutes||0)),pp.nightStart||'00:00',pp.nightEnd||'24:00')>0)parking=Math.min(parking,pp.nightCap);
        let raw=charge.billed*(pp.pricePerKwh||0)+parking;total=fxToEur(raw,c);pricingDetails.chargeCost=fxToEur(charge.billed*(pp.pricePerKwh||0),c);pricingDetails.idleCost=fxToEur(parking,c);pricingDetails.currencies=[c];
      }else if(pp?.type==='accessPlusTime'){
        let c=pp.currency||'EUR',paid=Math.max(0,charge.minutes-(pp.freeMinutes||0)),dayM=minutesInWindow((startMin+(pp.freeMinutes||0))%1440,paid,pp.dayStart||'08:00',pp.dayEnd||'20:00');
        total=fxToEur((pp.accessFee||0)+dayM*((pp.dayPerHour||0)/60),c);pricingDetails.connection=fxToEur(pp.accessFee||0,c);pricingDetails.chargeCost=total-pricingDetails.connection;pricingDetails.currencies=[c];
      }else if(pp?.type==='freeWindowUnknownAfter'){
        if(charge.minutes<=(pp.freeMinutes||0))total=0;else unknown=true;
      }else unknown=true;
    }catch(err){return{total:NaN,unknown:true,message:err.message,pricingDetails}}
    return{total,unknown,pricingDetails};
  }
  function tariffLabel(st,time){
    let rules=legacyPricingToRules(st.pricing),rule=ruleForMinute(rules,mins(time));
    if(!rule)return'Tarif non disponible';
    let c=rule.currency||'EUR',connected=Number(rule.belibConnectedTimePerMinute||0),suffix=connected>0?` + ${connected.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min de branchement`:'';
    if(rule.billing==='kwh')return`${Number(rule.pricePerKwh||0).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/kWh${suffix}`;
    if(rule.billing==='minute')return`${Number(rule.chargePerMinute||0).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} ${c}/min`;
    if(rule.billing==='powerMinute')return`Tarif/min selon puissance (${c})`;
    return'Tarif variable';
  }
  function congestionInfo(st,charge,arrivalSoc,unplugTime,startTime,enabled){
    let rate=Number(st.teslaCongestionFeePerMinute??st.congestionFeePerMinute??st.congestion?.feePerMinute??0);
    if(!(rate>0))return{available:false,enabled:false,cost:0};
    let threshold=Number(st.teslaCongestionThresholdPct??st.congestionThresholdPct??st.congestion?.thresholdPct??80);
    threshold=Number.isFinite(threshold)?threshold:80;
    let crossing=arrivalSoc>=threshold?0:null;
    if(crossing===null){
      for(const seg of charge.segments||[]){
        if(seg.endSoc>=threshold){
          let spanSoc=seg.endSoc-seg.startSoc;
          let frac=spanSoc>0?(threshold-seg.startSoc)/spanSoc:0;
          crossing=seg.startMin+(seg.endMin-seg.startMin)*Math.max(0,Math.min(1,frac));
          break;
        }
      }
    }
    if(crossing===null)return{available:true,enabled:!!enabled,cost:0,threshold,rate,minutes:0};
    let occupied=Number.isFinite(unplugWindowMinutes(startTime,unplugTime))?unplugWindowMinutes(startTime,unplugTime):charge.minutes;
    occupied=Math.max(charge.minutes,occupied);
    let exposed=Math.max(0,occupied-crossing);
    if(!enabled)return{available:true,enabled:false,cost:0,threshold,rate,minutes:exposed,crossing};
    let rules=legacyPricingToRules(st.pricing),rule=ruleForMinute(rules,(mins(startTime)+Math.floor(crossing))%1440);
    let currency=rule?.currency||st.pricing?.currency||'EUR';
    let cost=0;try{cost=fxToEur(rate*exposed,currency)}catch(e){cost=rate*exposed}
    return{available:true,enabled:true,cost,threshold,rate,minutes:exposed,crossing,currency};
  }
  function simulateAugust(st,date,time,arrivalSoc,target,s,condition,profile,unplugTime,congestionEnabled){
    let a=accessStatus(st,date,time);
    if(!a.canStart)return{unavailable:true,message:a.label,access:a};
    let targetDefined=Number.isFinite(target);
    let wanted=targetDefined?Math.max(0,Math.min(100,target)):100;
    if(wanted<=arrivalSoc+1e-9){
      let empty={batt:0,billed:0,minutes:0,avg:0,segments:[],reached:arrivalSoc};
      let price=legacyPrice(st,mins(time),empty,unplugTime,time);
      let congestion=congestionInfo(st,empty,arrivalSoc,unplugTime,time,congestionEnabled);
      return{...empty,allowed:0,deliveredBilled:0,deliveredBatt:0,reached:arrivalSoc,total:(price.total||0)+congestion.cost,pricingDetails:{...price.pricingDetails,congestionCost:congestion.cost},congestion,access:a,targetReached:true,targetDefined,truncated:false,unknown:price.unknown,message:price.message};
    }
    let full=chargingBase(st,arrivalSoc,wanted,s,condition,profile);
    let maxByUnplug=unplugWindowMinutes(time,unplugTime);
    let maxByClose=(st.access?.limited&&st.access.afterCloseMode==='must_stop')?a.remaining:Infinity;
    let maxCharge=Math.min(full.minutes,maxByUnplug,maxByClose);
    let charge=trimChargeToMinutes(full,maxCharge,arrivalSoc,s);
    let reached=Math.min(100,charge.reached);
    let targetReached=!targetDefined||reached>=wanted-.05;
    let truncatedByUnplug=Number.isFinite(maxByUnplug)&&maxByUnplug<full.minutes-.01;
    let truncatedByClose=Number.isFinite(maxByClose)&&maxByClose<full.minutes-.01;
    let price=legacyPrice(st,mins(time),charge,unplugTime,time);
    let congestion=congestionInfo(st,charge,arrivalSoc,unplugTime,time,congestionEnabled);
    let total=Number.isFinite(price.total)?price.total+congestion.cost:NaN;
    return{
      ...charge,allowed:charge.minutes,deliveredBilled:charge.billed,deliveredBatt:charge.batt,reached,total,
      pricingDetails:{...(price.pricingDetails||{}),congestionCost:congestion.cost},
      congestion,access:a,targetReached,targetDefined,wanted,truncated:truncatedByUnplug||truncatedByClose,
      truncatedByUnplug,truncatedByClose,unknown:price.unknown,message:price.message
    };
  }
  function selectedOperators(){
    let boxes=[...document.querySelectorAll('#augOperatorChoices input[type=checkbox]')];
    if(!boxes.length)return null;
    return new Set(boxes.filter(x=>x.checked).map(x=>x.value));
  }
  function operatorAllowed(st,selected){
    if(!selected)return true;
    return selected.has(normalizeOperator(st.operator||((st.source==='teslaSupercharger')?'Tesla':'')));
  }
  function refreshOperatorChoices(){
    let host=$('augOperatorChoices');if(!host)return;
    let previous=new Map([...host.querySelectorAll('input[type=checkbox]')].map(x=>[x.value,x.checked]));
    let ops=[...new Set((stations||[]).map(st=>normalizeOperator(st.operator||((st.source==='teslaSupercharger')?'Tesla':''))))].sort((a,b)=>a.localeCompare(b,'fr'));
    host.innerHTML=ops.map(op=>`<label class="operator-choice"><input type="checkbox" value="${esc(op)}" ${previous.has(op)?(previous.get(op)?'checked':''):(op==='Tesla'?'checked':'')}> ${esc(op)}</label>`).join('');
  }
  function selectAllOperators(on){document.querySelectorAll('#augOperatorChoices input').forEach(x=>x.checked=!!on)}
  window.augSelectAllOperators=selectAllOperators;

  function currentSortMode(){return val('simRanking','cost')}
  function rankingSubscriptionEligible(st){
    if(window.TCCV8Subscriptions?.isStationEligible)return window.TCCV8Subscriptions.isStationEligible(st);
    let selected=[];try{const saved=JSON.parse(localStorage.getItem('tccSubscriptionsV1')||'{}');selected=Array.isArray(saved.selected)?saved.selected:[]}catch(e){}
    const provider=plain(st?.configurationLabel||st?.label||st?.offerProvider||'');
    let id='';if(provider.includes('belib direct abonne non resident'))id='belib-nonresident';else if(provider.includes('belib direct abonne resident'))id='belib-resident';
    return !id||selected.includes(id);
  }
  function physicalResultKey(row){return`${String(row?.st?.catalogStationId||row?.st?.baseStationId||row?.st?.id||'').split('::')[0]}|${String(row?.st?.kind||'').toUpperCase()}|${Number(row?.st?.powerKw||0).toFixed(2)}`}
  function sortRows(rows,mode){
    let available=rows.filter(x=>!x.r.unavailable);
    const finite=(n,fallback=1e12)=>Number.isFinite(n)?n:fallback;
    const compareRows=(a,b)=>{
      if(mode==='finish')return finite(a.totalDuration)-finite(b.totalDuration);
      if(mode==='chargeFinish')return finite(a.r.allowed)-finite(b.r.allowed);
      if(mode==='costPerKm')return finite(a.centsPerKm)-finite(b.centsPerKm);
      if(mode==='arrival')return finite(b.arrivalSoc,-1)-finite(a.arrivalSoc,-1);
      if(mode==='distance')return finite(a.distanceKm)-finite(b.distanceKm);
      return finite(a.r.total)-finite(b.r.total);
    };
    const eligible=available.filter(x=>rankingSubscriptionEligible(x.st)).sort(compareRows);
    const topPhysical=[...new Set(eligible.map(physicalResultKey))].slice(0,20),physicalOrder=new Map(topPhysical.map((key,index)=>[key,index]));
    return available.filter(x=>physicalOrder.has(physicalResultKey(x))).sort((a,b)=>{
      const group=physicalOrder.get(physicalResultKey(a))-physicalOrder.get(physicalResultKey(b));if(group)return group;
      const eligibility=Number(!rankingSubscriptionEligible(a.st))-Number(!rankingSubscriptionEligible(b.st));return eligibility||compareRows(a,b);
    });
  }
  function routeTripData(st,s){
    let route=routeResults[st.baseStationId||st.id];
    let distanceKm=route?.distanceKm??st._airKm;
    let durationMin=route?.durationMin??(Number.isFinite(distanceKm)?distanceKm/50*60:0);
    let profile=routeConsumptionProfile({distanceKm,durationMin},s);
    let tripEnergy=Math.max(0,distanceKm||0)*profile.average/100;
    let precond=preconditioningKwh(st,s);
    let arrivalSoc=num('simNow',20)-((tripEnergy+precond)/Math.max(1,s.batteryCapacity))*100;
    return{route,distanceKm,durationMin,profile,tripEnergy,precond,arrivalSoc};
  }
  function congestionEnabledFor(st){return !!congestionState[st.baseStationId||st.id]}
  function setCongestion(id,on){
    congestionState[id]=!!on;localStorage.setItem(AUG_CONGESTION_KEY,JSON.stringify(congestionState));
    compare();
  }
  window.augSetCongestion=setCongestion;

  async function compareAugust(){
    let departureSoc=num('simNow',20);
    let rawTarget=String($('simTarget')?.value??'').trim();
    let target=rawTarget===''?NaN:Number(rawTarget);
    let date=val('simDate'),time=val('simTime'),unplugTime=val('simUnplugTime');
    let condition=val('simCondition','normal'),profile=val('simProfile','realistic');
    let rawMax=String(val('simMaxDistance','')).trim(),maxDistanceKm=rawMax===''?0:Math.max(0,Number(rawMax)||0);
    let kind=val('simKindFilter','all'),selected=selectedOperators(),settings=saveAugSettings();
    if(departureSoc<0||departureSoc>100){$('results').innerHTML='<div class="bad">Batterie de départ invalide.</div>';return}
    if(Number.isFinite(target)&&(target<=0||target>100)){$('results').innerHTML='<div class="bad">Objectif invalide.</div>';return}
    if(!Number.isFinite(target)&&!unplugTime){$('results').innerHTML='<div class="bad">Indique un objectif de batterie, une heure de débranchement, ou les deux.</div>';return}
    localStorage.setItem('tccMaxDistanceKm',maxDistanceKm>0?String(maxDistanceKm):'0');
    $('results').innerHTML='<div class="small">Calcul des trajets, de la batterie à l’arrivée et du coût réel de recharge…</div>';
    try{
      let prepared=await candidateStations('all',maxDistanceKm);
      lastPreparedOrigin=prepared.origin;
      let expanded=expandConfigurations(prepared.stations).filter(st=>operatorAllowed(st,selected)&&(kind==='all'||st.kind===kind));
      let rows=expanded.map(st=>{
        let trip=routeTripData(st,settings);
        if(maxDistanceKm>0&&(!Number.isFinite(trip.distanceKm)||trip.distanceKm>maxDistanceKm))return null;
        if(trip.arrivalSoc<0){
          return{st,...trip,totalDuration:trip.durationMin,r:{unavailable:true,message:'Borne non atteignable avec la batterie de départ.'}};
        }
        let r=simulateAugust(st,date,time,Math.max(0,trip.arrivalSoc),target,settings,condition,profile,unplugTime,congestionEnabledFor(st));
        let recoveredKm=Number.isFinite(r.deliveredBatt)?r.deliveredBatt/Math.max(1,settings.referenceConsumption)*100:0;
        let effectiveRate=Number.isFinite(r.total)&&r.deliveredBilled>0?r.total/r.deliveredBilled:NaN;
        let centsPerKm=Number.isFinite(r.total)&&recoveredKm>0?r.total/recoveredKm*100:NaN;
        return{st,...trip,r,recoveredKm,effectiveRate,centsPerKm,totalDuration:trip.durationMin+(r.allowed||0)};
      }).filter(Boolean);
      let ranked=sortRows(rows,currentSortMode());
      lastRows=ranked;
      let radius=maxDistanceKm>0?` dans un rayon routier maximal de ${maxDistanceKm} km`:' sans limite de distance';
      $('routeStatus').innerHTML=`<span class="good">${ranked.length} résultat(s) depuis ${esc(prepared.origin.label)}${radius}.</span>`;
      renderResultsAugust(ranked,date,time,target,settings);
      if($('augMapView')&&!$('augMapView').classList.contains('hidden'))renderMapAugust();
    }catch(err){
      console.error(err);
      $('results').innerHTML=`<div class="bad">${esc(err.message)}</div>`;
      $('routeStatus').innerHTML='<span class="bad">Impossible de terminer la simulation.</span>';
    }
  }

  function targetStatusHtml(row,target){
    let r=row.r;
    if(r.unavailable)return`<div class="bad small">${esc(r.message||'Indisponible')}</div>`;
    if(Number.isFinite(target)&&!r.targetReached){
      let why=r.truncatedByUnplug?'heure de débranchement':(r.truncatedByClose?'fermeture du site':'temps disponible');
      return`<div class="warn small"><b>Objectif ${target.toFixed(0)} % non atteint (${why}).</b> Niveau estimé au départ : ${r.reached.toFixed(1)} %.</div>`;
    }
    if(Number.isFinite(target))return`<div class="good small">✓ Objectif ${target.toFixed(0)} % atteignable.</div>`;
    return`<div class="good small">✓ Charge maximisée jusqu’à l’heure de débranchement.</div>`;
  }
  function commercialAndEffective(row,time){
    let parts=[`Tarif : <b>${esc(tariffLabel(row.st,time))}</b>`];
    if(Number.isFinite(row.effectiveRate))parts.push(`effectif session : <b>${row.effectiveRate.toFixed(3)} €/kWh</b>`);
    if(Number.isFinite(row.centsPerKm))parts.push(`<b>${row.centsPerKm.toFixed(1)} ct/km récupéré</b>`);
    return parts.join(' · ');
  }
  function renderResultsAugust(rows,date,time,target,settings){
    if(!rows.length){$('results').innerHTML='<div class="warn">Aucune borne ne correspond aux filtres actuels.</div>';return}
    $('results').innerHTML=rows.map((row,idx)=>{
      let {st,r}=row;
      let route=row.route?`${row.route.distanceKm.toFixed(1)} km · ${Math.round(row.route.durationMin)} min`:`≈ ${Number(row.distanceKm||0).toFixed(1)} km`;
      let operator=normalizeOperator(st.operator||((st.source==='teslaSupercharger')?'Tesla':''));
      if(r.unavailable){
        return`<div class="station result-card"><div class="station-head"><div><h3>${idx+1}. ${esc(st.name)} — ${esc(st.configurationLabel||`${st.kind} ${st.powerKw} kW`)}</h3><span class="badge operator-badge">${esc(operator)}</span><span class="badge">${esc(st.kind)} ${Number(st.powerKw)} kW</span></div></div><div class="routeinfo"><b>${route}</b></div><div class="bad small">${esc(r.message||'Indisponible')}</div></div>`;
      }
      let currencies=r.pricingDetails?.currencies?.length?r.pricingDetails.currencies:['EUR'];
      let cost=Number.isFinite(r.total)?localCostHtml(r.total,currencies):'<div class="cost">Tarif à compléter</div>';
      let arrivalClass=row.arrivalSoc<settings.safetySoc?'warn':'good';
      let tripProfile=settings.consumptionMode==='adaptive'?`<br>${esc(row.profile.label)} · moyenne calculée ${row.profile.average.toFixed(1)} kWh/100 km`:'';
      let precond=row.precond>0?` · préconditionnement ${row.precond.toFixed(1)} kWh`:'';
      let recovered=`${r.deliveredBatt.toFixed(1)} kWh récupérés · <b>≈ ${Math.round(row.recoveredKm)} km</b>`;
      let wall=`${r.deliveredBilled.toFixed(1)} kWh au compteur`;
      let finish=finishTime(date,time,r.allowed||0);
      let breakdown=r.pricingDetails&&(r.pricingDetails.connection||r.pricingDetails.connectedTimeCost||r.pricingDetails.idleCost||r.pricingDetails.durationSurcharge||r.pricingDetails.congestionCost)?`<div class="small cost-breakdown">Frais fixe : ${(r.pricingDetails.connection||0).toFixed(2)} € · Temps de branchement tarifaire : ${(r.pricingDetails.connectedTimeCost||0).toFixed(2)} € · Stationnement après charge : ${(r.pricingDetails.idleCost||0).toFixed(2)} € · Après durée : ${(r.pricingDetails.durationSurcharge||0).toFixed(2)} € · Congestion ≥${r.congestion?.threshold??80}% : ${(r.pricingDetails.congestionCost||0).toFixed(2)} €</div>`:'';
      let congestion=r.congestion?.available?`<div class="congestion-toggle"><label><input type="checkbox" ${r.congestion.enabled?'checked':''} onchange="augSetCongestion('${esc(st.baseStationId||st.id)}',this.checked)"> Appliquer les frais de congestion Tesla au-delà de ${Number(r.congestion.threshold||80).toFixed(0)} %</label><span class="small">${Number(r.congestion.rate||0).toFixed(2)} ${esc(r.congestion.currency||currencies[0]||'EUR')}/min · ${r.congestion.enabled?`${Math.round(r.congestion.minutes||0)} min exposées`:'désactivés pour cette simulation'}</span></div>`:'';
      let taper=r.reached>80&&st.kind==='DC'?'<div class="warn small">Le ralentissement de charge au-dessus de 80 % est inclus.</div>':'';
      return`<div class="station result-card" data-result-id="${esc(st.baseStationId||st.id)}" data-recovered-km="${Number(row.recoveredKm||0).toFixed(6)}" data-cents-per-km="${Number.isFinite(row.centsPerKm)?row.centsPerKm.toFixed(6):''}">
        <div class="station-head"><div><h3>${idx+1}. ${esc(st.name)} — ${esc(st.configurationLabel||`${st.kind} ${st.powerKw} kW`)}</h3>
        <span class="badge operator-badge">${esc(operator)}</span><span class="badge">${esc(st.kind)}</span><span class="badge">${Number(st.powerKw)} kW</span>${st.stalls?`<span class="badge">${st.stalls} point${st.stalls>1?'s':''}</span>`:''}<span class="badge">MAJ ${esc(st.lastUpdated||'—')}</span></div>${cost}</div>
        <div class="routeinfo"><b>${route}</b><br>Départ ${num('simNow',20).toFixed(0)} % → trajet ${row.tripEnergy.toFixed(1)} kWh${precond} → <span class="${arrivalClass}"><b>arrivée ${Math.max(0,row.arrivalSoc).toFixed(1)} %</b></span>${tripProfile}</div>
        <div class="result-metrics">
          <div><span>Recharge</span><b>${fmtMin(r.allowed||0)}</b></div>
          <div><span>Fin charge</span><b>${finish}</b></div>
          <div><span>Batterie départ borne</span><b>${r.reached.toFixed(1)} %</b></div>
          <div><span>Trajet + recharge</span><b>${fmtMin(row.totalDuration||0)}</b></div>
        </div>
        <div class="small energy-line"><b>${recovered}</b> · ${wall} · puissance moyenne ≈ ${r.avg.toFixed(0)} kW</div>
        <div class="small">${commercialAndEffective(row,time)}</div>
        ${breakdown}${targetStatusHtml(row,target)}${congestion}${taper}
        <div class="row result-actions"><button class="secondary" onclick="window.open('${mapsUrl(st)}','_blank')">Itinéraire Google Maps</button>${st.teslaUrl?`<button class="secondary" onclick="window.open('${esc(st.teslaUrl)}','_blank')">Fiche Tesla</button>`:''}</div>
      </div>`;
    }).join('');
  }

  function switchResultView(mode){
    let list=$('results'),map=$('augMapView'),listBtn=$('augListBtn'),mapBtn=$('augMapBtn');
    if(!list||!map)return;
    let isMap=mode==='map';
    list.classList.toggle('hidden',isMap);map.classList.toggle('hidden',!isMap);
    listBtn?.classList.toggle('active-view',!isMap);mapBtn?.classList.toggle('active-view',isMap);
    if(isMap)renderMapAugust();
  }
  window.augSwitchResultView=switchResultView;

  function loadLeaflet(){
    if(window.L&&window.L.map)return Promise.resolve(window.L);
    if(leafletPromise)return leafletPromise;
    leafletPromise=new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-aug-leaflet]')){
        let css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.dataset.augLeaflet='1';document.head.appendChild(css);
        let mc=document.createElement('link');mc.rel='stylesheet';mc.href='https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';mc.dataset.augLeaflet='1';document.head.appendChild(mc);
      }
      let s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.onload=()=>{
        let c=document.createElement('script');c.src='https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';c.onload=()=>resolve(window.L);c.onerror=()=>resolve(window.L);document.head.appendChild(c);
      };s.onerror=reject;document.head.appendChild(s);
    });
    return leafletPromise;
  }
  async function renderMapAugust(){
    let host=$('augMapView');if(!host||host.classList.contains('hidden'))return;
    host.innerHTML='<div class="small">Chargement de la carte OpenStreetMap…</div>';
    try{
      let L=await loadLeaflet();
      host.innerHTML='<div id="augLeafletMap"></div>';
      mapInstance=L.map('augLeafletMap',{scrollWheelZoom:false});
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(mapInstance);
      mapCluster=L.markerClusterGroup?L.markerClusterGroup():L.layerGroup();
      let bounds=[];
      for(const row of lastRows){
        let st=row.st,lat=Number(st.latitude),lon=Number(st.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        let marker=L.marker([lat,lon]);
        let cost=Number.isFinite(row.r.total)?`${row.r.total.toFixed(2)} €`:'tarif à compléter';
        marker.bindPopup(`<b>${esc(st.name)}</b><br>${esc(normalizeOperator(st.operator))} · ${esc(st.kind)} ${Number(st.powerKw)} kW<br>${Number(row.distanceKm||0).toFixed(1)} km · arrivée ${Math.max(0,row.arrivalSoc||0).toFixed(0)} %<br><b>${cost}</b> · ≈ ${Math.round(row.recoveredKm||0)} km récupérés<br><a href="${mapsUrl(st)}" target="_blank" rel="noopener">Itinéraire</a>`);
        mapCluster.addLayer(marker);bounds.push([lat,lon]);
      }
      mapCluster.addTo(mapInstance);
      if(lastPreparedOrigin&&Number.isFinite(lastPreparedOrigin.lat)&&Number.isFinite(lastPreparedOrigin.lon)){
        L.circleMarker([lastPreparedOrigin.lat,lastPreparedOrigin.lon],{radius:7}).bindPopup('Départ').addTo(mapInstance);bounds.push([lastPreparedOrigin.lat,lastPreparedOrigin.lon]);
      }
      if(bounds.length)mapInstance.fitBounds(bounds,{padding:[30,30],maxZoom:13});else mapInstance.setView([46.5,2.5],5);
      setTimeout(()=>mapInstance.invalidateSize(),100);
    }catch(err){host.innerHTML=`<div class="warn">Carte indisponible : ${esc(err.message)}. La liste reste utilisable.</div>`}
  }

  function stationSearchState(){
    return{
      q:plain(val('stationSearch','')),
      kind:val('stationKindFilter','all'),
      operator:val('stationOperatorFilter','all'),
      country:val('stationCountryFilter','all'),
      power:val('stationPowerFilter','all'),
      source:val('stationSourceFilter','all'),
      incomplete:!!$('stationIncompleteFilter')?.checked,
      sort:val('stationSort','alpha')
    };
  }
  function powerBucket(st,bucket){
    let p=Math.max(...stationConfigurations(st).map(c=>Number(c.powerKw||0)),0);
    if(bucket==='le11')return p<=11;
    if(bucket==='22')return p>11&&p<=22;
    if(bucket==='50-100')return p>=50&&p<=100;
    if(bucket==='150+')return p>=150;
    return true;
  }
  function stationIncomplete(st){
    let cfgs=stationConfigurations(st);
    return !st.operator||!st.address||(!Number.isFinite(Number(st.latitude))&&!Number.isFinite(Number(st.longitude)))||cfgs.some(c=>!(legacyPricingToRules(c.pricing)||[]).length);
  }
  function stationCity(st){
    let a=String(st.address||'').split(',').map(x=>x.trim()).filter(Boolean);
    return a.length>1?a[a.length-2]:(a[0]||'');
  }
  function stationCard(st){
    let custom=st.source!=='teslaSupercharger',op=normalizeOperator(st.operator||'');
    let configs=stationConfigurations(st).map(c=>{
      let first=legacyPricingToRules(c.pricing)[0],price=first?(first.billing==='kwh'?`${Number(first.pricePerKwh||0).toFixed(2)} ${first.currency||'EUR'}/kWh`:(first.billing==='minute'?`${Number(first.chargePerMinute||0).toFixed(3)} ${first.currency||'EUR'}/min`:'tarif/min selon puissance')):'tarif à définir';
      return`<span class="badge">${c.stalls?`${c.stalls} × `:''}${esc(c.kind)} ${Number(c.powerKw)} kW · ${esc(price)}</span>`;
    }).join('');
    return`<div class="station ${st.temporarilyUnavailable?'disabled-station':''}">
      <div class="station-head"><div><h3>${esc(st.name)}</h3><span class="badge operator-badge">${esc(op)}</span>${st.countryCode?`<span class="badge">${esc(COUNTRY_NAMES[st.countryCode]||st.countryCode)}</span>`:''}<span class="badge">MAJ ${esc(st.lastUpdated||'—')}</span><div>${configs}</div>
      ${st.temporarilyUnavailable?'<span class="badge badge-unavailable">Temporairement indisponible</span>':''}<div class="small">${esc(st.address||'Aucune adresse')}<br>${custom?'Borne tierce modifiable':'Base Tesla · lecture seule'}</div></div></div>
      <div class="row station-actions">${st.address?`<button class="secondary" onclick="window.open('${mapsUrl(st)}','_blank')">Itinéraire</button>`:''}${st.teslaUrl?`<button class="secondary" onclick="window.open('${esc(st.teslaUrl)}','_blank')">Fiche Tesla</button>`:''}
      ${custom?`<button class="secondary" onclick="toggleStationAvailability('${esc(st.id)}')">${st.temporarilyUnavailable?'Réactiver':'Indisponible'}</button><button class="secondary" onclick="editStation('${esc(st.id)}')">Modifier</button><button class="secondary" onclick="augDuplicateStation('${esc(st.id)}')">Dupliquer</button><button class="danger" onclick="deleteStation('${esc(st.id)}')">Supprimer</button>`:''}</div>
    </div>`;
  }
  function updateStationFilterOptions(){
    let opSel=$('stationOperatorFilter'),countrySel=$('stationCountryFilter');if(!opSel||!countrySel)return;
    let opCurrent=opSel.value,countryCurrent=countrySel.value;
    let ops=[...new Set(stations.map(st=>normalizeOperator(st.operator)))].sort((a,b)=>a.localeCompare(b,'fr'));
    opSel.innerHTML='<option value="all">Tous</option>'+ops.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if([...opSel.options].some(o=>o.value===opCurrent))opSel.value=opCurrent;
    let countries=[...new Set(stations.map(stationCountry).filter(Boolean))].sort();
    countrySel.innerHTML='<option value="all">Tous</option>'+countries.map(c=>`<option value="${c}">${esc(COUNTRY_NAMES[c]||c)}</option>`).join('');
    if([...countrySel.options].some(o=>o.value===countryCurrent))countrySel.value=countryCurrent;
  }
  function renderStationsAugust(){
    ensureStationFilters();
    updateStationFilterOptions();
    let state=stationSearchState();
    let filtered=(stations||[]).filter(st=>{
      let blob=plain([st.name,st.address,st.operator,st.countryCode,st.id,...stationConfigurations(st).map(c=>`${c.kind} ${c.powerKw}`)].join(' '));
      if(state.q&&!blob.includes(state.q))return false;
      if(state.kind!=='all'&&!stationConfigurations(st).some(c=>c.kind===state.kind))return false;
      if(state.operator!=='all'&&normalizeOperator(st.operator)!==state.operator)return false;
      if(state.country!=='all'&&stationCountry(st)!==state.country)return false;
      if(state.power!=='all'&&!powerBucket(st,state.power))return false;
      if(state.source==='tesla'&&st.source!=='teslaSupercharger')return false;
      if(state.source==='custom'&&st.source==='teslaSupercharger')return false;
      if(state.incomplete&&!stationIncomplete(st))return false;
      return true;
    });
    filtered.sort((a,b)=>{
      if(state.sort==='operator')return normalizeOperator(a.operator).localeCompare(normalizeOperator(b.operator),'fr')||(a.name||'').localeCompare(b.name||'','fr');
      if(state.sort==='power')return Math.max(...stationConfigurations(b).map(c=>c.powerKw))-Math.max(...stationConfigurations(a).map(c=>c.powerKw));
      if(state.sort==='updated')return String(b.lastUpdated||'').localeCompare(String(a.lastUpdated||''));
      return(a.name||'').localeCompare(b.name||'','fr');
    });
    $('stationResultCount').textContent=`${filtered.length} borne(s) trouvée(s) sur ${stations.length}`;
    $('stationList').innerHTML=filtered.length?filtered.map(stationCard).join(''):'<div class="small">Aucune borne ne correspond aux critères.</div>';
  }
  function ensureStationFilters(){
    let section=$('stations'),list=$('stationList');if(!section||!list||$('stationFilters'))return;
    let card=document.createElement('div');card.className='card station-filter-card';card.id='stationFilters';
    card.innerHTML=`<div class="station-search-row"><div class="grow"><label>Rechercher une borne</label><input id="stationSearch" type="search" placeholder="Nom, ville, adresse, opérateur, identifiant…"></div><button class="secondary" type="button" onclick="augResetStationFilters()">Réinitialiser</button></div>
    <div class="filter-grid">
      <div><label>Type</label><select id="stationKindFilter"><option value="all">Tous</option><option>AC</option><option>DC</option></select></div>
      <div><label>Opérateur</label><select id="stationOperatorFilter"><option value="all">Tous</option></select></div>
      <div><label>Pays</label><select id="stationCountryFilter"><option value="all">Tous</option></select></div>
      <div><label>Puissance</label><select id="stationPowerFilter"><option value="all">Toutes</option><option value="le11">≤ 11 kW</option><option value="22">12–22 kW</option><option value="50-100">50–100 kW</option><option value="150+">≥ 150 kW</option></select></div>
      <div><label>Source</label><select id="stationSourceFilter"><option value="all">Toutes</option><option value="tesla">Tesla</option><option value="custom">Tierces</option></select></div>
      <div><label>Tri</label><select id="stationSort"><option value="alpha">Nom A–Z</option><option value="operator">Opérateur</option><option value="power">Puissance</option><option value="updated">MAJ récente</option></select></div>
      <label class="full checkline"><input id="stationIncompleteFilter" type="checkbox"> Afficher uniquement les fiches potentiellement incomplètes</label>
    </div><div id="stationResultCount" class="small"></div>`;
    section.insertBefore(card,list);
    card.querySelectorAll('input,select').forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',renderStationsAugust));
  }
  function resetStationFilters(){
    ['stationSearch'].forEach(id=>{if($(id))$(id).value=''});
    ['stationKindFilter','stationOperatorFilter','stationCountryFilter','stationPowerFilter','stationSourceFilter'].forEach(id=>{if($(id))$(id).value='all'});
    if($('stationSort'))$('stationSort').value='alpha';if($('stationIncompleteFilter'))$('stationIncompleteFilter').checked=false;renderStationsAugust();
  }
  window.augResetStationFilters=resetStationFilters;

  function formState(){
    if(!$('fName'))return null;
    return{
      id:val('editId'),name:val('fName'),operator:val('fOperator'),address:val('fAddress'),
      configs:readChargingConfigurations(),accessMode:val('fAccessMode'),unavailable:!!$('fTemporarilyUnavailable')?.checked,
      closeMode:val('fCloseMode'),closeNote:val('fCloseNote'),
      days:Array.from({length:7},(_,i)=>({open:!!$('dOpen'+i)?.checked,start:val('dStart'+i),end:val('dEnd'+i)}))
    };
  }
  function formSignature(state){return JSON.stringify(state)}
  function formDirty(){return editorSnapshot!==null&&formSignature(formState())!==editorSnapshot}
  function captureEditorSnapshot(){editorSnapshot=formSignature(formState())}
  function cancelEdit(){
    if(formDirty()&&!confirm('Abandonner les modifications non enregistrées ?'))return;
    editorGuardBypass=true;
    if(val('editId')){
      let st=stations.find(x=>x.id===val('editId'));if(st)loadStationIntoForm(st);else resetForm();
    }else resetForm();
    captureEditorSnapshot();
    document.querySelector('[data-tab="stations"]')?.click();
    setTimeout(()=>editorGuardBypass=false,0);
  }
  window.augCancelEdit=cancelEdit;
  function clearFormAugust(){
    if(formDirty()&&!confirm('Vider le formulaire et abandonner les saisies non enregistrées ?'))return;
    resetForm();captureEditorSnapshot();
  }
  window.augClearForm=clearFormAugust;

  function loadStationIntoForm(st){
    $('formTitle').textContent='Modifier la borne';$('editId').value=st.id;$('fName').value=st.name||'';$('fOperator').value=st.operator||'';$('fAddress').value=st.address||'';
    loadChargingConfigurations(st.chargingConfigurations,st);
    $('fAccessMode').value=st.access?.limited?'schedule':'always';$('fTemporarilyUnavailable').checked=!!st.temporarilyUnavailable;$('fCloseMode').value=st.access?.afterCloseMode||'must_stop';$('fCloseNote').value=st.access?.afterCloseNote||'';$('fUpdated').value=st.lastUpdated||today();
    for(let i=0;i<7;i++){let d=st.access?.days?.[String(i)]||{open:true,start:'00:00',end:'24:00'};$('dOpen'+i).checked=!!d.open;$('dStart'+i).value=d.start||'00:00';$('dEnd'+i).value=d.end||'24:00'}
    toggleAccessMode();captureEditorSnapshot();
  }

  const oldToggleStationAvailability=toggleStationAvailability;
  toggleStationAvailability=function(id){
    let st=stations.find(x=>x.id===id);if(!st)return;
    if(st.source==='teslaSupercharger'){alert('La base Tesla est en lecture seule.');return}
    st.temporarilyUnavailable=!st.temporarilyUnavailable;
    st.lastUpdated=today();st._syncUpdatedAt=new Date().toISOString();
    saveLocal();renderStationsAugust();queueGithubSync();
  };

  const oldEditStation=editStation;
  editStation=function(id){
    let st=stations.find(x=>x.id===id);if(!st)return;
    if(st.source==='teslaSupercharger'){alert('Les bornes Tesla de la base publiée sont en lecture seule.');return}
    editorGuardBypass=true;document.querySelector('[data-tab="edit"]')?.click();loadStationIntoForm(st);editorGuardBypass=false;
  };
  const oldResetForm=resetForm;
  resetForm=function(){oldResetForm();if($('fUpdated')){$('fUpdated').value=today();$('fUpdated').readOnly=true}$('formTitle').textContent='Ajouter une borne';editorSnapshot=null};
  const oldSaveStation=saveStation;
  saveStation=function(){
    let id=val('editId'),existing=id?stations.find(x=>x.id===id):null;
    if(existing?.source==='teslaSupercharger'){alert('La base Tesla est en lecture seule.');return}
    if(existing&&!formDirty()){alert('Aucune modification à enregistrer. La date de MAJ reste inchangée.');return}
    if(!$('fName').value.trim()){alert('Renseigne le nom de la borne.');return}
    $('fUpdated').value=today();
    oldSaveStation();
    refreshOperatorChoices();
    setTimeout(()=>{editorSnapshot=null;renderStationsAugust()},0);
  };

  function duplicateStation(id){
    let st=stations.find(x=>x.id===id);if(!st||st.source==='teslaSupercharger')return;
    editorGuardBypass=true;document.querySelector('[data-tab="edit"]')?.click();
    let copy=deepClone(st);copy.id='';copy.name='';copy.address='';delete copy.latitude;delete copy.longitude;copy.lastUpdated=today();copy.source='custom';
    $('formTitle').textContent='Dupliquer une borne';$('editId').value='';$('fName').value='';$('fOperator').value=copy.operator||'';$('fAddress').value='';loadChargingConfigurations(copy.chargingConfigurations,copy);
    $('fAccessMode').value=copy.access?.limited?'schedule':'always';$('fTemporarilyUnavailable').checked=false;$('fCloseMode').value=copy.access?.afterCloseMode||'must_stop';$('fCloseNote').value=copy.access?.afterCloseNote||'';$('fUpdated').value=today();
    for(let i=0;i<7;i++){let d=copy.access?.days?.[String(i)]||{open:true,start:'00:00',end:'24:00'};$('dOpen'+i).checked=!!d.open;$('dStart'+i).value=d.start||'00:00';$('dEnd'+i).value=d.end||'24:00'}
    toggleAccessMode();captureEditorSnapshot();editorGuardBypass=false;$('fName').focus();
  }
  window.augDuplicateStation=duplicateStation;

  function userTemplates(){return safeJsonParse(localStorage.getItem(AUG_TEMPLATES_KEY)||'[]',[])||[]}
  function derivedTemplates(){
    let out=[],seen=new Set();
    for(const st of stations.filter(x=>x.source!=='teslaSupercharger'&&x.operator)){
      for(const cfg of stationConfigurations(st)){
        let key=`${normalizeOperator(st.operator)}|${cfg.kind}|${cfg.powerKw}|${JSON.stringify(cfg.pricing)}`;
        if(seen.has(key))continue;seen.add(key);
        out.push({id:`derived-${out.length}`,name:`${normalizeOperator(st.operator)} · ${cfg.kind} ${cfg.powerKw} kW`,operator:st.operator,chargingConfigurations:[deepClone(cfg)],access:deepClone(st.access||{})});
      }
    }
    return out;
  }
  function allTemplates(){return[...userTemplates(),...publishedTemplates,...derivedTemplates()]}
  async function loadPublishedTemplates(){
    try{
      let data=await fetch(`data/station_templates.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null);
      publishedTemplates=Array.isArray(data)?data:(Array.isArray(data?.templates)?data.templates:[]);
    }catch(e){publishedTemplates=[]}
    refreshTemplates();
  }
  function refreshTemplates(){
    let sel=$('stationTemplateSelect');if(!sel)return;let templates=allTemplates();
    sel.innerHTML='<option value="">Choisir un modèle…</option>'+templates.map((t,i)=>`<option value="${i}">${esc(t.name||t.operator||'Modèle')}</option>`).join('');
  }
  function applyTemplate(){
    let idx=Number(val('stationTemplateSelect',''));if(!Number.isFinite(idx))return;
    let t=allTemplates()[idx];if(!t)return;
    if(t.operator)$('fOperator').value=t.operator;
    if(t.chargingConfigurations)loadChargingConfigurations(deepClone(t.chargingConfigurations),t);
    if(t.access){
      $('fAccessMode').value=t.access.limited?'schedule':'always';$('fCloseMode').value=t.access.afterCloseMode||'must_stop';$('fCloseNote').value=t.access.afterCloseNote||'';
      for(let i=0;i<7;i++){let d=t.access.days?.[String(i)];if(d){$('dOpen'+i).checked=!!d.open;$('dStart'+i).value=d.start||'00:00';$('dEnd'+i).value=d.end||'24:00'}}
      toggleAccessMode();
    }
  }
  window.augApplyTemplate=applyTemplate;
  function createTemplateFromForm(){
    let state=formState();if(!state)return;
    let name=prompt('Nom du modèle fournisseur',`${state.operator||'Fournisseur'} · ${state.configs?.[0]?.kind||''} ${state.configs?.[0]?.powerKw||''} kW`);if(!name)return;
    let templates=userTemplates();templates.push({id:`user-${Date.now()}`,name,operator:state.operator,chargingConfigurations:deepClone(state.configs),access:{limited:state.accessMode==='schedule',days:Object.fromEntries(state.days.map((d,i)=>[String(i),d])),afterCloseMode:state.closeMode,afterCloseNote:state.closeNote}});
    localStorage.setItem(AUG_TEMPLATES_KEY,JSON.stringify(templates));refreshTemplates();alert('Modèle enregistré sur cet appareil.');
  }
  window.augCreateTemplate=createTemplateFromForm;

  function ensureEditEnhancements(){
    let section=$('edit'),card=section?.querySelector('.card');if(!card||$('stationTemplateTools'))return;
    let title=$('formTitle');
    let tools=document.createElement('div');tools.id='stationTemplateTools';tools.className='box template-tools';
    tools.innerHTML=`<b>Modèles fournisseur</b><div class="template-row"><select id="stationTemplateSelect"><option value="">Choisir un modèle…</option></select><button class="secondary" type="button" onclick="augApplyTemplate()">Appliquer</button><button class="secondary" type="button" onclick="augCreateTemplate()">Créer un modèle depuis ce formulaire</button></div><div class="small">Les modèles suggérés sont dérivés des bornes tierces déjà validées. Le nom, l’adresse et le GPS ne sont jamais copiés.</div>`;
    title.insertAdjacentElement('afterend',tools);
    let buttons=[...card.querySelectorAll('button')],saveBtn=buttons.find(b=>String(b.getAttribute('onclick')||'').includes('saveStation'));
    let clearBtn=buttons.find(b=>String(b.getAttribute('onclick')||'').includes('resetForm'));
    if(clearBtn){clearBtn.setAttribute('onclick','augClearForm()');clearBtn.textContent='Vider le formulaire'}
    if(saveBtn){
      let cancel=document.createElement('button');cancel.className='secondary';cancel.type='button';cancel.textContent='Annuler';cancel.setAttribute('onclick','augCancelEdit()');cancel.style.cssText='width:100%;margin-top:8px';
      saveBtn.insertAdjacentElement('afterend',cancel);
    }
    if($('fUpdated')){$('fUpdated').readOnly=true;$('fUpdated').title='Mise à jour automatiquement lors d’un enregistrement réel.'}
    refreshTemplates();captureEditorSnapshot();
  }

  function ensureCompareEnhancements(){
    let section=$('compare'),card=section?.querySelector('.card');if(!card||$('augVehicleBox'))return;
    let target=$('simTarget');if(target){target.removeAttribute('required');target.placeholder='Optionnel';target.previousElementSibling.textContent='Objectif (%) — optionnel si heure de débranchement'}
    let scope=$('simOperatorFilter');if(scope){scope.closest('div').classList.add('hidden')}
    let ranking=$('simRanking');if(ranking){
      ranking.previousElementSibling.textContent='Trier les résultats par';
      ranking.innerHTML='<option value="cost" selected>Coût final</option><option value="costPerKm">Coût au km récupéré</option><option value="finish">Temps trajet + recharge</option><option value="chargeFinish">Durée de recharge</option><option value="arrival">Batterie à l’arrivée</option><option value="distance">Distance</option>';
    }
    let grid=card.querySelector('.grid'),box=document.createElement('div');box.id='augVehicleBox';box.className='full box';
    box.innerHTML=`<div class="aug-section-title"><b>Véhicule & consommation</b><span class="small">La batterie actuelle correspond au niveau au départ.</span></div>
      <div class="filter-grid">
        <div><label>Batterie utilisable (kWh)</label><input id="simBatteryCapacity" type="number" min="20" max="150" step=".5"></div>
        <div><label>Consommation de référence (kWh/100 km)</label><input id="simConsumption" type="number" min="5" max="50" step=".1"></div>
        <div><label>Modèle de consommation trajet</label><select id="simConsumptionMode"><option value="simple">Moyenne véhicule</option><option value="adaptive">Adaptatif (profil routier estimé)</option></select></div>
        <div><label>Marge batterie basse (%)</label><input id="simSafetySoc" type="number" min="0" max="30" step="1"></div>
      </div>
      <div id="augAdaptiveConsumption" class="filter-grid compact-grid">
        <div><label>Ville</label><input id="simCityConsumption" type="number" step=".1"></div><div><label>Voie rapide</label><input id="simFastConsumption" type="number" step=".1"></div><div><label>Autoroute</label><input id="simMotorwayConsumption" type="number" step=".1"></div>
      </div>
      <div class="filter-grid compact-grid">
        <div><label>Préconditionnement Tesla</label><select id="simPrecondition"><option value="none">Aucun</option><option value="light">Léger (~0,5 kWh)</option><option value="normal">Normal (~1,0 kWh)</option><option value="strong">Fort (~1,5 kWh)</option><option value="custom">Personnalisé</option></select></div>
        <div id="augPrecondCustom"><label>Énergie préconditionnement (kWh)</label><input id="simPreconditionCustom" type="number" min="0" max="10" step=".1"></div>
      </div>`;
    grid.appendChild(box);
    let filters=document.createElement('div');filters.id='augCompareFilters';filters.className='full box';
    filters.innerHTML=`<div class="aug-section-title"><b>Filtres bornes</b><div class="row mini-actions"><button type="button" class="secondary" onclick="augSelectAllOperators(true)">Tout sélectionner</button><button type="button" class="secondary" onclick="augSelectAllOperators(false)">Tout désélectionner</button></div></div>
      <div class="filter-grid"><div><label>Type de recharge</label><select id="simKindFilter"><option value="all">AC + DC</option><option value="AC">AC uniquement</option><option value="DC">DC uniquement</option></select></div></div>
      <div id="augOperatorChoices" class="operator-choices"></div>`;
    grid.appendChild(filters);
    let s=augSettings();
    $('simBatteryCapacity').value=s.batteryCapacity;$('simConsumption').value=s.referenceConsumption;$('simConsumptionMode').value=s.consumptionMode;$('simCityConsumption').value=s.cityConsumption;$('simFastConsumption').value=s.fastConsumption;$('simMotorwayConsumption').value=s.motorwayConsumption;$('simSafetySoc').value=s.safetySoc;$('simPrecondition').value=s.preconditioning;$('simPreconditionCustom').value=s.preconditioningCustom;
    function refreshConditional(){
      $('augAdaptiveConsumption').classList.toggle('hidden',$('simConsumptionMode').value!=='adaptive');
      $('augPrecondCustom').classList.toggle('hidden',$('simPrecondition').value!=='custom');
    }
    $('simConsumptionMode').addEventListener('change',refreshConditional);$('simPrecondition').addEventListener('change',refreshConditional);refreshConditional();
    refreshOperatorChoices();
    let resultCard=$('results'),toggle=document.createElement('div');toggle.className='result-view-toggle';toggle.innerHTML='<button id="augListBtn" class="secondary active-view" type="button" onclick="augSwitchResultView(\'list\')">Liste</button><button id="augMapBtn" class="secondary" type="button" onclick="augSwitchResultView(\'map\')">Carte</button>';
    resultCard.parentElement.insertBefore(toggle,resultCard);
    let map=document.createElement('div');map.id='augMapView';map.className='card hidden';resultCard.insertAdjacentElement('afterend',map);
  }

  async function renderTeslaBaseInfo(){
    let section=$('compare');if(!section)return;
    let info=$('teslaBaseInfo');if(!info){info=document.createElement('div');info.id='teslaBaseInfo';info.className='card small';section.appendChild(info)}
    let tesla=(stations||[]).filter(st=>st.source==='teslaSupercharger'),codes=[...new Set(tesla.map(st=>String(st.countryCode||'').toUpperCase()).filter(Boolean))].sort();
    let metadata={};try{metadata=await fetch(`data/metadata.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():{})}catch(e){}
    info.innerHTML=`<b>Base Tesla :</b> ${tesla.length} stations dans ${codes.length} pays · dernière mise à jour : <b>${esc(metadata.teslaUpdated||'inconnue')}</b><br>${codes.map(c=>esc(COUNTRY_NAMES[c]||c)).join(' · ')}`;
  }

  function installUnsavedGuard(){
    document.querySelectorAll('nav button').forEach(btn=>{
      btn.addEventListener('click',e=>{
        if(editorGuardBypass)return;
        let leavingEdit=$('edit')?.classList.contains('active')&&btn.dataset.tab!=='edit';
        if(leavingEdit&&formDirty()){
          if(!confirm('Abandonner les modifications non enregistrées ?')){e.preventDefault();e.stopImmediatePropagation();return}
          editorGuardBypass=true;resetForm();captureEditorSnapshot();setTimeout(()=>editorGuardBypass=false,0);
        }
      },true);
    });
  }

  // Conservative custom duplicate assistant. It never decides silently:
  // likely pairs can be merged or explicitly kept as two stations.
  function duplicatePairKey(a,b){return[a.id,b.id].sort().join('|')}
  function ignoredDuplicatePairs(){return new Set(safeJsonParse(localStorage.getItem(AUG_DUP_IGNORE_KEY)||'[]',[])||[])}
  function likelyCustomDuplicates(){
    let custom=stations.filter(st=>st.source!=='teslaSupercharger'),pairs=[],ignored=ignoredDuplicatePairs();
    for(let i=0;i<custom.length;i++)for(let j=i+1;j<custom.length;j++){
      let a=custom[i],b=custom[j],sameOp=normalizeOperator(a.operator)===normalizeOperator(b.operator),sameName=plain(a.name)===plain(b.name);
      let meters=Infinity;
      if([a.latitude,a.longitude,b.latitude,b.longitude].every(x=>Number.isFinite(Number(x)))){
        meters=haversineKm(Number(a.latitude),Number(a.longitude),Number(b.latitude),Number(b.longitude))*1000;
      }
      if(((sameName&&sameOp)||(sameOp&&meters<=80))&&!ignored.has(duplicatePairKey(a,b)))pairs.push([a,b]);
    }
    return pairs;
  }
  function keepDuplicatePair(aId,bId){
    let ignored=ignoredDuplicatePairs();ignored.add([aId,bId].sort().join('|'));localStorage.setItem(AUG_DUP_IGNORE_KEY,JSON.stringify([...ignored]));showDuplicateWarning();
  }
  window.augKeepDuplicatePair=keepDuplicatePair;
  function mergeDuplicatePair(aId,bId){
    let a=stations.find(x=>x.id===aId),b=stations.find(x=>x.id===bId);if(!a||!b)return;
    if(!confirm(`Fusionner « ${a.name} » et « ${b.name} » ? La version la plus récente sera conservée comme identité.`))return;
    let aTime=isoTime(stationSyncTime(a)),bTime=isoTime(stationSyncTime(b)),winner=aTime>=bTime?a:b,loser=winner===a?b:a;
    let merged={...loser,...winner};
    if(!winner.address&&loser.address)merged.address=loser.address;
    if(!winner.operator&&loser.operator)merged.operator=loser.operator;
    if(!winner.chargingConfigurations?.length&&loser.chargingConfigurations?.length)merged.chargingConfigurations=deepClone(loser.chargingConfigurations);
    if(!Number.isFinite(Number(winner.latitude))&&Number.isFinite(Number(loser.latitude)))merged.latitude=loser.latitude;
    if(!Number.isFinite(Number(winner.longitude))&&Number.isFinite(Number(loser.longitude)))merged.longitude=loser.longitude;
    merged._syncUpdatedAt=new Date().toISOString();
    stations=stations.filter(x=>x.id!==loser.id).map(x=>x.id===winner.id?normalizeStation(merged):x);
    let deletions=customDeletions();deletions[loser.id]=new Date().toISOString();saveCustomDeletions(deletions);
    saveLocal();renderStationsAugust();showDuplicateWarning();queueGithubSync();
  }
  window.augMergeDuplicatePair=mergeDuplicatePair;
  function showDuplicateWarning(){
    let pairs=likelyCustomDuplicates(),sync=$('sync')?.querySelector('.card');if(!sync)return;
    let box=$('augDuplicateWarning');if(!box){box=document.createElement('div');box.id='augDuplicateWarning';box.className='small box';sync.appendChild(box)}
    box.innerHTML=pairs.length?`<span class="warn"><b>${pairs.length} doublon(s) potentiel(s)</b> parmi les bornes tierces.</span>${pairs.slice(0,5).map(([a,b])=>`<div class="duplicate-pair"><span>${esc(a.name)} ↔ ${esc(b.name)}</span><div class="row"><button class="secondary" type="button" onclick="augMergeDuplicatePair('${a.id}','${b.id}')">Fusionner</button><button class="secondary" type="button" onclick="augKeepDuplicatePair('${a.id}','${b.id}')">Conserver les deux</button></div></div>`).join('')}`:'<span class="good">✓ Aucun doublon tierce évident détecté.</span>';
  }

  const originalSyncGithubNowAugust=syncGithubNow;
  syncGithubNow=async function(silent=false){
    let cfg=githubSettings(),first=!githubLastSync()?.at;
    if(first&&!cfg.readOnly&&cfg.owner&&cfg.repo&&githubToken()){
      let local=customStationsForSync();
      let remote;
      try{remote=await readGithubCustomFile(cfg)}catch(err){return originalSyncGithubNowAugust(silent)}
      let remoteState=parseCustomCloudData(remote.data);
      if(local.length&&remoteState.stations.length){
        if(silent){
          updateGithubStatus('Première synchronisation à confirmer manuellement : données locales et GitHub existent déjà.','warn');
          addGithubLog('warn','Première synchronisation mise en attente pour éviter une fusion automatique.');
          return null;
        }
        let choice=prompt(
          `Première synchronisation : ${local.length} borne(s) locale(s) et ${remoteState.stations.length} borne(s) sur GitHub.\n\n`+
          `1 = Télécharger GitHub sur cet appareil\n2 = Remplacer GitHub par les données locales\n3 = Fusionner les deux\n\nSaisis 1, 2 ou 3.`,
          '3'
        );
        if(choice===null)return null;
        choice=String(choice).trim();
        if(choice==='1'){
          applyMergedCustomState(remoteState);
          setGithubLastSync({at:new Date().toISOString(),count:remoteState.stations.length,device:remoteState.lastDevice||'GitHub',readOnly:true});
          updateGithubStatus(`Données GitHub téléchargées : ${remoteState.stations.length} borne(s).`,'good');addGithubLog('good','Première synchronisation : version GitHub téléchargée.');showDuplicateWarning();return remoteState;
        }
        if(choice==='2'){
          let state={schemaVersion:2,updatedAt:new Date().toISOString(),lastDevice:cfg.deviceName||defaultDeviceName(),stations:local,deletedIds:customDeletions()};
          await writeGithubCustomFile(cfg,state,remote.sha);applyMergedCustomState(state);
          setGithubLastSync({at:new Date().toISOString(),count:state.stations.length,device:state.lastDevice,readOnly:false});
          updateGithubStatus(`GitHub remplacé par ${state.stations.length} borne(s) locales.`,'good');addGithubLog('good','Première synchronisation : GitHub remplacé par les données locales.');showDuplicateWarning();return state;
        }
        if(choice!=='3'){alert('Choix non reconnu. Synchronisation annulée.');return null}
      }
    }
    let result=await originalSyncGithubNowAugust(silent);showDuplicateWarning();return result;
  };

  // Install overrides after app.js/dedupe are fully defined.
  compare=compareAugust;
  renderStations=renderStationsAugust;

  function updateReleaseChrome(){
    let meta=document.querySelector('meta[name="tcc-build"]');if(meta)meta.content='8001';
    document.title='Tesla Charge Companion 8.0 RC1 — Août 2026';
    let hp=document.querySelector('header p');
    if(hp&&hp.firstChild)hp.firstChild.nodeValue='Version 8.0 RC1 · release août 2026 · ';
    let about=$('fx')?.querySelector('.card .small');
    if(about)about.innerHTML=about.innerHTML.replace(/V7\.3 Stable/g,'V8.0 RC1');
    let compareCards=$('compare')?.querySelectorAll('.card');
    if(compareCards?.length){
      let note=[...compareCards].find(c=>c.textContent.includes('Calcul V2'));
      if(note)note.innerHTML='<b>Calcul V3 :</b> la batterie est estimée à l’arrivée pour chaque borne à partir du trajet. L’objectif de batterie et l’heure de débranchement peuvent être utilisés séparément ou ensemble. Les coûts incluent les règles tarifaires, les frais de durée et, lorsqu’ils sont activés, les frais de congestion Tesla.';
    }
  }

  function initAugust(){
    updateReleaseChrome();ensureCompareEnhancements();ensureEditEnhancements();installUnsavedGuard();loadPublishedTemplates();
    buildDays();
    if(!$('editId').value)resetForm();
    captureEditorSnapshot();
    let wait=0,timer=setInterval(()=>{
      wait++;
      if(Array.isArray(stations)&&stations.length){
        clearInterval(timer);refreshOperatorChoices();refreshTemplates();renderTeslaBaseInfo();showDuplicateWarning();
        if($('stations')?.classList.contains('active'))renderStationsAugust();
      }else if(wait>120)clearInterval(timer);
    },250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initAugust);else initAugust();
})();
