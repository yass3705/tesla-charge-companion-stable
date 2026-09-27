(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoPublic=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const slug=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const validMoroccoGps=(lat,lon)=>lat!=null&&lon!=null&&lat>=20&&lat<=37&&lon>=-18&&lon<=0;
  async function fetchJson(url,fetchImpl){const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);if(!f)throw new Error('fetch unavailable');const r=await f(url,{cache:'no-cache'});if(!r.ok)throw new Error(`resource unavailable (${r.status}): ${url}`);return r.json();}

  function evgoClassify(evse){
    if(evse?.isLongTermUnavailable===true||evse?.isTemporarilyUnavailable===true)return'out_of_service';
    const native=text(evse?.status);
    if(['charging','suspendedEV','finishing','preparing'].includes(native))return'occupied_or_active_session';
    if(native==='available'&&evse?.isAvailable===true)return'available';
    if(['unavailable','faulted','offline','unknown'].includes(native))return'out_of_service';
    return'unknown';
  }
  function evgoStationState(evses){const states=(evses||[]).map(evgoClassify);if(states.includes('available'))return'available';if(states.includes('occupied_or_active_session'))return'occupied';if(states.length&&states.every(s=>s==='out_of_service'))return'out_of_service';return'unknown';}
  function evgoOverlayFreshness(overlay,maxMinutes=120,nowMs=Date.now()){
    const raw=text(overlay?.source_generated_at||overlay?.generated_at),timestamp=Date.parse(raw),limit=number(maxMinutes);
    if(!raw||!Number.isFinite(timestamp)||limit==null||limit<=0)return{fresh:false,generatedAt:raw||null,ageMinutes:null,maxMinutes:limit};
    const ageMinutes=Math.max(0,(Number(nowMs)-timestamp)/60000);
    return{fresh:ageMinutes<=limit,generatedAt:raw,ageMinutes,maxMinutes:limit};
  }
  function applyEvgoStatusOverlay(dataset,overlay){
    const base=JSON.parse(JSON.stringify(dataset||{})),baseStations=Array.isArray(base.stations)?base.stations:[],freshStations=Array.isArray(overlay?.stations)?overlay.stations:[];
    if(baseStations.length!==17||freshStations.length!==17)throw new Error(`EVGO overlay expected 17/17 stations, got ${baseStations.length}/${freshStations.length}`);
    const byLocation=new Map(freshStations.map(st=>[text(st.locationId),st]));let overlayEvseCount=0;
    for(const st of baseStations){
      const fresh=byLocation.get(text(st.locationId));if(!fresh)throw new Error(`EVGO overlay missing station ${st.locationId}`);
      const freshEvses=Array.isArray(fresh.evses)?fresh.evses:[];overlayEvseCount+=freshEvses.length;
      const byEvse=new Map(freshEvses.map(e=>[text(e.id),e]));
      st.evses=(st.evses||[]).map(e=>{const next=byEvse.get(text(e.id));if(!next)throw new Error(`EVGO overlay missing EVSE ${st.locationId}/${e.id}`);const merged={...e,status:next.status,isAvailable:next.isAvailable,isLongTermUnavailable:next.isLongTermUnavailable,isTemporarilyUnavailable:next.isTemporarilyUnavailable};merged.operational_class=evgoClassify(merged);return merged;});
      st.updatedAt=fresh.updatedAt||st.updatedAt||overlay?.source_generated_at||null;
    }
    if(overlayEvseCount!==43)throw new Error(`EVGO overlay expected 43 EVSE, got ${overlayEvseCount}`);
    return base;
  }
  function normalizeEvgoDataset(dataset,{sourceId='morocco-evgo-native',statusFresh=true,statusGeneratedAt=null}={}){
    const stations=Array.isArray(dataset?.stations)?dataset.stations:[],errors=[];let evseCount=0;
    if(stations.length!==17)errors.push(`expected 17 EVGO stations, got ${stations.length}`);
    for(const st of stations){if(!validMoroccoGps(number(st.latitude),number(st.longitude)))errors.push(`invalid EVGO GPS ${st.locationId}`);for(const e of st.evses||[]){evseCount++;if(text(e.operational_class)!==evgoClassify(e))errors.push(`EVGO status mismatch ${st.locationId}/${e.id}`);}}
    if(evseCount!==43)errors.push(`expected 43 EVGO EVSE, got ${evseCount}`);if(errors.length)throw new Error(errors.join('; '));
    return stations.map(st=>{
      const evses=(st.evses||[]).map(e=>({id:`evgo:${text(e.id)}`,aliases:[`evgo-evse:${text(e.id)}`],label:text(e.identifier)||text(e.id),connectors:(e.connectors||[{id:e.id,name:text(e.currentType)}]).map((c,i)=>({id:`evgo:${text(e.id)}:connector:${text(c?.id)||i}`,kind:text(e.currentType).toUpperCase()==='DC'?'DC':'AC',powerKw:number(e.maxPower)??number(e.powerCandidateKW),powerSource:number(e.maxPower)!=null?'native':number(e.powerCandidateKW)!=null?text(e.powerCandidateSource)||'candidate':null,plugName:text(c?.name)||null})),status:{state:statusFresh?evgoClassify(e):'unknown',nativeState:text(e.status),isAvailable:e.isAvailable===true,isLongTermUnavailable:e.isLongTermUnavailable===true,isTemporarilyUnavailable:e.isTemporarilyUnavailable===true,freshness:statusFresh?'fresh':'stale'},model:text(e.chargePointModel)||null}));
      const free=(st.evses||[]).length>0&&(st.evses||[]).every(e=>e?.isFree===true&&number(e?.priceMAD)===0);
      return{canonicalId:`MA:evgo:${st.locationId}`,aliases:[`evgo-location:${st.locationId}`],sourceStationId:text(st.locationId),countryCode:'MA',name:text(st.name),address:text(st.address),latitude:number(st.latitude),longitude:number(st.longitude),physicalOperator:{name:text(st.operator_cpo_candidate)||'Nareva Services / EVGO'},networkBrand:'EVGO',evses,access:{kind:'public',limited:false,siteBrand:st.site_brand==null?null:text(st.site_brand),appSource:text(st.app_source)||'EVGO',accessNetwork:'EVGO'},status:{state:statusFresh?evgoStationState(st.evses):'unknown',sourceId,updatedAt:statusGeneratedAt||st.updatedAt||null,statusSource:text(st.status_source)||'EVGO native backend cp.evgo.ma',freshness:statusFresh?'fresh':'stale'},offers:free?[{id:`evgo-free:${st.locationId}`,provider:'EVGO direct',kind:'direct',countries:['MA'],currency:'MAD',pricing:{type:'rules',rules:[{scope:'allDay',billing:'kwh',currency:'MAD',pricePerKwh:0}]},metadata:{tariffChannel:text(st.tariff_channel)||'EVGO native',interpretation:'EVGO-only explicit normalized free rule; never generalize to another operator.'}}]:[],updatedAt:st.updatedAt||null};
    });
  }

  const FASTVOLT_OVERRIDE={W00057:{siteBrand:'Afriquia',connectors:[...Array.from({length:4},(_,i)=>({id:`fastvolt:W00057:ccs:${i+1}`,kind:'DC',plugName:'CCS2',powerKw:360,powerSource:'native_app_verified'})),...Array.from({length:2},(_,i)=>({id:`fastvolt:W00057:type2:${i+1}`,kind:'AC',plugName:'Type 2',powerKw:22,powerSource:'native_app_verified'}))]}};
  function fastVoltPublicConnectors(row){const out=[],max=number(row?.max_output);const add=(count,kind,plug)=>{for(let i=0;i<Number(count||0);i++)out.push({id:`fastvolt:${text(row.charger_id)}:${slug(plug)}:${i+1}`,kind,plugName:plug,powerKw:max,powerSource:'public_map_station_max_output'});};add(row?.ccs_count,'DC','CCS');add(row?.chademo_count,'DC','CHAdeMO');add(row?.type2_count,'AC','Type 2');return out;}
  function fastVoltOffers(id){return[{id:`fastvolt-direct-dc:${id}`,provider:'FastVolt direct',kind:'direct',countries:['MA'],currency:'MAD',connectorKinds:['DC'],pricing:{type:'rules',rules:[{scope:'allDay',billing:'minute',currency:'MAD',pricePerMinute:2.5}]},metadata:{tariffChannel:'FastVolt direct',source:'official FastVolt HowIts/FAQ'}},{id:`fastvolt-direct-ac:${id}`,provider:'FastVolt direct',kind:'direct',countries:['MA'],currency:'MAD',connectorKinds:['AC'],pricing:{type:'rules',rules:[{scope:'allDay',billing:'minute',currency:'MAD',pricePerMinute:0.5}]},metadata:{tariffChannel:'FastVolt direct',source:'official FastVolt HowIts/FAQ'}}];}
  function normalizeFastVoltDataset(dataset,{sourceId='morocco-fastvolt-public'}={}){const rows=Array.isArray(dataset?.chargers)?dataset.chargers:[],production=rows.filter(r=>r?.production_candidate===true);if(rows.length!==100||production.length!==97)throw new Error(`FastVolt expected 100/97, got ${rows.length}/${production.length}`);return production.map(row=>{const id=text(row.charger_id),lat=number(row.latitude),lon=number(row.longitude);if(!id||!validMoroccoGps(lat,lon))throw new Error(`invalid FastVolt station ${id}`);const override=FASTVOLT_OVERRIDE[id];const connectors=override?.connectors||fastVoltPublicConnectors(row);return{canonicalId:`MA:fastvolt:${id}`,aliases:[`fastvolt-charger:${id}`],sourceStationId:id,countryCode:'MA',name:text(row.charger_name||row.label)||`FastVolt ${id}`,address:[text(row.address_line_1),text(row.address_line_2),text(row.city)].filter(Boolean).join(', '),latitude:lat,longitude:lon,physicalOperator:{name:'FastVolt / Afrimobility'},networkBrand:'FastVolt',access:{kind:'public',limited:false,siteBrand:override?.siteBrand??(row.site_brand==null?null:text(row.site_brand)),appSource:'FastVolt public web map',accessNetwork:'FastVolt'},status:{state:'unknown',sourceId,statusSource:null,updatedAt:null},evses:[{id:`fastvolt:${id}`,aliases:[`fastvolt-evse:${id}`],connectors}],offers:fastVoltOffers(id)};});}

  function kilowattState(v){const s=text(v).toLowerCase();return s==='available'?'available':s==='occupied'||s==='charging'?'occupied':['faulted','offline','unknown','unavailable'].includes(s)?'out_of_service':'unknown';}
  function normalizeKilowattDataset(dataset,{sourceId='morocco-kilowatt-public'}={}){const rows=Array.isArray(dataset?.stations)?dataset.stations:[],production=rows.filter(r=>r?.production_candidate===true);if(rows.length!==47||production.length!==43)throw new Error(`Kilowatt expected 47/43, got ${rows.length}/${production.length}`);return production.map(st=>{const lat=number(st.latitude),lon=number(st.longitude);if(!validMoroccoGps(lat,lon))throw new Error(`invalid Kilowatt GPS ${st.id}`);const connectors=(st.connectors||[]).map((c,i)=>({id:`kilowatt:${st.id}:connector:${i}`,kind:(text(c?.type).toUpperCase().includes('CCS')||text(c?.type).toUpperCase().includes('CHADEMO'))?'DC':'AC',powerKw:number(c?.power_kw),plugName:text(c?.type)||null}));return{canonicalId:`MA:kilowatt:${text(st.id)}`,aliases:[`kilowatt-station:${text(st.id)}`],sourceStationId:text(st.id),countryCode:'MA',name:text(st.name)||'Kilowatt',address:text(st.address),latitude:lat,longitude:lon,physicalOperator:{name:'Kilowatt'},networkBrand:'Kilowatt',access:{kind:'public',limited:false,siteBrand:st.site_brand==null?null:text(st.site_brand),appSource:'Kilowatt public web map',accessNetwork:'Kilowatt'},evses:[{id:`kilowatt:${text(st.id)}`,connectors}],status:{state:kilowattState(st.status),sourceId,statusSource:text(st.status_source)||'Kilowatt public web map',updatedAt:null},offers:[]};});}


  function kilowattNativeConnectorState(connector,parentById){
    const parent=parentById?.get?.(text(connector?.chargestation_id));
    if(connector?.active===false||parent?.active===false||parent?.online===false)return'out_of_service';
    const s=text(connector?.status).toLowerCase();
    if(['available','charging','preparing','finishing','reserved','occupied','suspendedev','suspendedevse'].includes(s))return'available';
    if(['faulted','unavailable','offline','inoperative'].includes(s))return'out_of_service';
    return'unknown';
  }
  function kilowattNativeAggregateState(states){
    const values=(states||[]).filter(Boolean);
    if(values.includes('available'))return'available';
    if(values.length&&values.every(v=>v==='out_of_service'))return'out_of_service';
    return'unknown';
  }
  function kilowattNativeFreshness(dataset,maxMinutes=1560,nowMs=Date.now()){
    const raw=text(dataset?.generated_at),timestamp=Date.parse(raw),limit=number(maxMinutes);
    if(!raw||!Number.isFinite(timestamp)||limit==null||limit<=0)return{fresh:false,generatedAt:raw||null,ageMinutes:null,maxMinutes:limit};
    const ageMinutes=Math.max(0,(Number(nowMs)-timestamp)/60000);
    return{fresh:ageMinutes<=limit,generatedAt:raw,ageMinutes,maxMinutes:limit};
  }
  function kilowattNativePricing(connector){
    const rate=number(connector?.rate_price),currency=text(connector?.rate_currency).toUpperCase(),description=text(connector?.rate_description);
    if(rate==null||!currency)return null;
    const rule={scope:'allDay'};
    if(rate===0||/^free$/i.test(description)||/gratuit/i.test(description))rule.pricePerKwh=0;
    else if(/kwh/i.test(description))rule.pricePerKwh=rate;
    else if(/session/i.test(description))rule.sessionFeeEur=rate;
    else return null;
    const pricing={type:'rules',rules:[rule]};
    const idle=description.match(/inactivit[^0-9]*([0-9]+(?:[.,][0-9]+)?)\s*dh\s*\/\s*min/i);
    if(idle){
      const perMinute=number(String(idle[1]).replace(',','.'));
      if(perMinute!=null)pricing.postChargeFee={graceMinutes:0,eurPerMinute:perMinute};
    }
    return{rate,currency,description,pricing};
  }
  function normalizeKilowattNativeDataset(inventory,native,{sourceId='morocco-kilowatt-public',statusFresh=true,statusGeneratedAt=null,minStations=43,minConnectors=80}={}){
    const base=normalizeKilowattDataset(inventory,{sourceId});
    const rows=Array.isArray(native?.stations)?native.stations:[];
    const stationFloor=number(minStations)??43,connectorFloor=number(minConnectors)??80;
    if(rows.length<stationFloor)throw new Error(`Kilowatt native expected at least ${stationFloor} stations, got ${rows.length}`);
    const byId=new Map(rows.map(x=>[text(x?.station_id),x]));
    let connectorCount=0;
    const stations=base.map(st=>{
      const nativeStation=byId.get(text(st.sourceStationId));
      if(!nativeStation)throw new Error(`Kilowatt native station missing ${st.sourceStationId}`);
      const parentById=new Map((nativeStation.chargestations||[]).map(x=>[text(x?.id),x]));
      const groups=new Map(),offers=[];
      for(const c of nativeStation.connectors||[]){
        const nativeId=text(c?.id);if(!nativeId)continue;
        connectorCount++;
        const csid=text(c?.chargestation_id)||`unknown-${nativeId}`;
        const rawType=text(c?.type),rawPowerType=text(c?.power_type).toUpperCase();
        const kind=(rawPowerType.includes('DC')||rawType.toUpperCase().includes('CCS')||rawType.toUpperCase().includes('CHADEMO'))?'DC':'AC';
        const power=number(c?.power),state=kilowattNativeConnectorState(c,parentById),connectorId=`kilowatt-native:${nativeId}`;
        const parsed=kilowattNativePricing(c);
        const connector={
          id:connectorId,kind,powerKw:power,plugName:rawType||null,powerSource:'Kilowatt native Supabase',
          status:{state,nativeState:text(c?.status)||null,active:c?.active!==false,parentOnline:parentById.get(csid)?.online!==false,freshness:statusFresh?'fresh':'stale'},
          tariff:parsed?{rate:parsed.rate,currency:parsed.currency,description:parsed.description,rateId:text(c?.rate_id)||null}:null
        };
        if(!groups.has(csid))groups.set(csid,[]);
        groups.get(csid).push(connector);
        if(parsed&&power!=null&&power>0){
          offers.push({
            id:`kilowatt-native:${st.sourceStationId}:${nativeId}`,
            provider:'Kilowatt direct',kind:'direct',countries:['MA'],currency:parsed.currency,
            pricingModelId:`kilowatt-native-${nativeId}`,
            connectorKinds:[kind],plugNames:rawType?[rawType]:[],connectorIds:[connectorId],
            minPowerKw:power,maxPowerKw:power,pricing:parsed.pricing,
            metadata:{
              tariffChannel:'Kilowatt native Supabase',nativeRate:parsed.rate,nativeRateId:text(c?.rate_id)||null,
              nativeRateDescription:parsed.description,nativeConnectorId:nativeId,
              billingBasis:/kwh/i.test(parsed.description)?'kWh':(/session/i.test(parsed.description)?'session':'free'),
              taxTreatment:'native rate as returned; no additional tax applied'
            }
          });
        }
      }
      const evses=[...groups.entries()].map(([csid,list])=>({
        id:`kilowatt-native:${csid}`,aliases:[`kilowatt-chargestation:${csid}`],connectors:list,
        status:{state:kilowattNativeAggregateState(list.map(c=>c.status?.state)),freshness:statusFresh?'fresh':'stale'}
      }));
      const states=evses.flatMap(e=>e.connectors.map(c=>c.status?.state));
      return{...st,evses,offers,status:{
        state:kilowattNativeAggregateState(states),sourceId,statusSource:'Kilowatt native Supabase snapshot',
        updatedAt:statusGeneratedAt||text(native?.generated_at)||null,freshness:statusFresh?'fresh':'stale'
      },updatedAt:statusGeneratedAt||text(native?.generated_at)||null};
    });
    if(connectorCount<connectorFloor)throw new Error(`Kilowatt native expected at least ${connectorFloor} connectors, got ${connectorCount}`);
    return stations;
  }



  function totalNativeConnectorState(v){
    const s=text(v).toLowerCase();
    if(s==='available')return'available';
    if(['charging','preparing','suspendedev','suspendedevse','finishing','reserved','occupied'].includes(s))return'available';
    if(['faulted','unavailable','offline','inoperative'].includes(s))return'out_of_service';
    return'unknown';
  }
  function totalNativeAggregateState(states){
    const values=(states||[]).filter(Boolean);
    if(values.includes('available'))return'available';
    if(values.includes('occupied'))return'available';
    if(values.length&&values.every(v=>v==='out_of_service'))return'out_of_service';
    return'unknown';
  }
  function totalNativeFreshness(dataset,maxMinutes=180,nowMs=Date.now()){
    const raw=text(dataset?.generated_at),timestamp=Date.parse(raw),limit=number(maxMinutes);
    if(!raw||!Number.isFinite(timestamp)||limit==null||limit<=0)return{fresh:false,generatedAt:raw||null,ageMinutes:null,maxMinutes:limit};
    const ageMinutes=Math.max(0,(Number(nowMs)-timestamp)/60000);
    return{fresh:ageMinutes<=limit,generatedAt:raw,ageMinutes,maxMinutes:limit};
  }
  const TOTAL_NATIVE_CANONICAL_SLUG_BY_ID={
    '1':'relais-chaouia','2':'tanger-med','3':'relais-atlantis','4':'relais-oulmes','5':'relais-chichaoua','6':'palmeraie',
    '7':'bouregreg','8':'relais-al-baida','10':'relais-de-tanger','11':'djebilet','12':'relais-agadir','13':'relais-amsekroud',
    '15':'taourirt','17':'tamesna','18':'relais-mazagan','19':'relais-lissasfa','20':'relais-khemisset','22':'mogador'
  };
  function normalizeTotalNativeDataset(dataset,{sourceId='morocco-totalenergies-hosts',statusFresh=true,statusGeneratedAt=null,minStations=18,minConnectors=38}={}){
    const rows=Array.isArray(dataset?.results)?dataset.results:[];
    const stationFloor=number(minStations)??18,connectorFloor=number(minConnectors)??38;
    if(rows.length<stationFloor)throw new Error(`TotalEnergies native expected at least ${stationFloor} stations, got ${rows.length}`);
    let connectorCount=0;
    const stations=rows.map(st=>{
      const sid=text(st?.station_id??st?.detail?.ChargeStationID),lat=number(st?.detail?.ChargeStationLat??st?.lat),lon=number(st?.detail?.ChargeStationLong??st?.lon);
      if(!sid||!validMoroccoGps(lat,lon))throw new Error(`invalid TotalEnergies native station ${sid}`);
      const connectors=Array.isArray(st?.connectors)?st.connectors:[];connectorCount+=connectors.length;
      const live=Array.isArray(st?.live_status)?st.live_status:[],liveByKey=new Map(live.map(x=>[`${text(x?.cpid)}|${text(x?.connectorId)}`,x]));
      const groups=new Map();
      for(const c of connectors){
        const cpid=text(c?.ChargePointName||c?.ChargePointDisplayName||c?.chargePointName||c?.chargePointDisplayName||c?.cpId||c?.CPID),cid=text(c?.ChargePointConnectorNumber??c?.connectorId??c?.ConnectorId);
        if(!cpid||!cid)continue;
        const liveRow=liveByKey.get(`${cpid}|${cid}`),safe=liveRow?.safe_status||{};
        const nativeState=text(safe.ComputedStatusForCpo||safe.ComputedStatus||safe.CpLastReportedStatus||c?.ComputedStatus||c?.CpLastReportedStatus);
        const state=totalNativeConnectorState(nativeState);
        const connectorKind=(text(c?.ConnectorModelCurrentType||c?.connectorModelCurrentType).toUpperCase()==='DC'||['CCS','CCS2','CHADEMO'].some(x=>text(c?.connectorType||c?.ConnectorModelStandardName).toUpperCase().includes(x)))?'DC':'AC';
        const connectorPower=number(c?.MaxConnectorPower)??number(c?.ConnectorModelPower)??number(c?.connectorModelPower);
        const tariffRate=number(c?.rate),tariffUnit=text(c?.tariffType).toLowerCase(),tariffCurrency=text(c?.currencyType).toUpperCase();
        const connector={
          id:`totalenergies:${sid}:${slug(cpid)}:${cid}`,
          kind:connectorKind,
          powerKw:connectorPower,
          powerSource:'Club EV-Charge native',
          plugName:text(c?.ConnectorModelStandardName||c?.connectorType)||null,
          tariff:tariffRate!=null&&tariffUnit&&tariffCurrency?{rate:tariffRate,unit:tariffUnit,currency:tariffCurrency,source:'Club EV-Charge native'}:null,
          status:{state,nativeState:nativeState||null,error:text(safe.Error)||null,freshness:statusFresh?'fresh':'stale'}
        };
        if(!groups.has(cpid))groups.set(cpid,[]);
        groups.get(cpid).push(connector);
      }
      const evses=[...groups.entries()].map(([cpid,list])=>({
        id:`totalenergies:${sid}:cp:${slug(cpid)}`,
        aliases:[`totalenergies-cpid:${cpid}`],
        label:cpid,
        connectors:list,
        status:{state:totalNativeAggregateState(list.map(c=>c.status?.state)),freshness:statusFresh?'fresh':'stale'}
      }));
      const stationState=totalNativeAggregateState(evses.flatMap(e=>e.connectors.map(c=>c.status?.state)));
      const tariffGroups=new Map();
      for(const e of evses)for(const c of e.connectors||[]){
        const rate=number(c?.tariff?.rate),unit=text(c?.tariff?.unit).toLowerCase(),currency=text(c?.tariff?.currency).toUpperCase(),power=number(c?.powerKw),kind=text(c?.kind).toUpperCase();
        if(rate==null||!unit||!currency||power==null||!kind)continue;
        const key=`${kind}|${power}|${rate}|${unit}|${currency}`;
        const row=tariffGroups.get(key)||{kind,power,rate,unit,currency,connectorIds:[]};
        row.connectorIds.push(c.id);tariffGroups.set(key,row);
      }
      const offers=[...tariffGroups.values()].map(t=>{
        const pricing=t.unit==='min'?{type:'rules',rules:[{scope:'allDay',billing:'minute',currency:t.currency,pricePerMinute:t.rate}]}:null;
        if(!pricing)return null;
        return{
          id:`totalenergies-native:${sid}:${t.kind.toLowerCase()}:${String(t.power).replace(/[^0-9.]+/g,'-')}kw:${String(t.rate).replace(/[^0-9.]+/g,'-')}`,
          provider:'TotalEnergies direct',kind:'direct',countries:['MA'],currency:t.currency,
          pricingModelId:`total-native-${t.kind.toLowerCase()}-${t.power}kw-${t.rate}-${t.unit}`,
          connectorKinds:[t.kind],minPowerKw:t.power,maxPowerKw:t.power,pricing,
          metadata:{tariffChannel:'Club EV-Charge native',billingUnit:t.unit,nativeRate:t.rate,nativeConnectorIds:t.connectorIds,taxTreatment:'native rate as returned; no additional tax applied'}
        };
      }).filter(Boolean);
      const nativeName=text(st?.detail?.ChargeStationName||st?.name)||`TotalEnergies ${sid}`;
      const canonicalSlug=TOTAL_NATIVE_CANONICAL_SLUG_BY_ID[sid]||slug(nativeName.replace(/^TotalEnergies\s+/i,''));
      const address=[text(st?.detail?.ChargeStationAddress),text(st?.detail?.ChargeStationCity)].filter(Boolean).join(', ');
      return{
        canonicalId:`MA:totalenergies-host:${canonicalSlug}`,
        aliases:[`totalenergies-host:${canonicalSlug}`,`totalenergies-native-station:${sid}`],
        sourceStationId:sid,countryCode:'MA',name:nativeName,address,latitude:lat,longitude:lon,
        physicalOperator:{name:'TotalEnergies'},networkBrand:'TotalEnergies',
        evses,
        access:{kind:'public',limited:false,siteBrand:'TotalEnergies',appSource:'Club EV-Charge public guest native',accessNetwork:'Club EV-Charge'},
        status:{state:stationState,sourceId,statusSource:'Numocity native connector status',updatedAt:statusGeneratedAt||text(dataset?.generated_at)||null,freshness:statusFresh?'fresh':'stale'},
        offers,updatedAt:statusGeneratedAt||text(dataset?.generated_at)||null
      };
    });
    if(connectorCount<connectorFloor)throw new Error(`TotalEnergies native expected at least ${connectorFloor} connectors, got ${connectorCount}`);
    return stations;
  }

  function normalizeTotalEnergies(official,alWaha,links,{sourceId='morocco-totalenergies-hosts'}={}){
    if(!Array.isArray(official?.rows))throw new Error('invalid TotalEnergies official inventory');
    const corrected=text(links?.reconciliation?.corrected_second_tamesna_label),coords=new Map((links?.official_link_coordinates||[]).map(x=>[text(x.site_name),{lat:number(x.latitude),lon:number(x.longitude)}]));
    const grouped=new Map();let tamesnaSeen=0;
    for(const row of official.rows){let name=text(row.site_name);if(!name)continue;if(name==='TAMESNA'){tamesnaSeen++;if(tamesnaSeen===2&&corrected)name=corrected;}if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(row);}
    if(grouped.size!==18)throw new Error(`TotalEnergies expected 18 reconciled hosts, got ${grouped.size}`);
    const exact=alWaha?.station||{},exactId=text(exact.kilowatt_station_id);
    const diagnostics=[];const stations=[];
    for(const [name,rows] of grouped){const geo=coords.get(name);if(!geo||!validMoroccoGps(geo.lat,geo.lon)){diagnostics.push({name,reason:'missing_official_link_coordinates'});continue;}const isAlWaha=name==='AL WAHA'&&exact.operator_cpo==='Kilowatt'&&exactId;const connectors=[];for(const row of rows){const count=Math.max(1,Number(row.charger_count||0));const kind=text(row.current_class).toUpperCase().includes('DC')?'DC':'AC';for(let i=0;i<count;i++)connectors.push({id:`totalenergies:${slug(name)}:${kind.toLowerCase()}:${i+1}`,kind,powerKw:number(row.power_kw),plugName:null,powerSource:'TotalEnergies official public table'});}stations.push({canonicalId:isAlWaha?`MA:kilowatt:${exactId}`:`MA:totalenergies-host:${slug(name)}`,aliases:[`totalenergies-host:${slug(name)}`,...(isAlWaha?[`kilowatt-station:${exactId}`]:[])],sourceStationId:`totalenergies:${slug(name)}`,countryCode:'MA',name:isAlWaha?(text(exact.canonical_name)||'TotalEnergies AL WAHA'):name,address:'',latitude:geo.lat,longitude:geo.lon,physicalOperator:isAlWaha?{name:'Kilowatt'}:null,networkBrand:isAlWaha?'Kilowatt':null,access:{kind:'public',limited:false,siteBrand:'TotalEnergies',appSource:isAlWaha?'Kilowatt public web map':'TotalEnergies official public website',accessNetwork:isAlWaha?'Kilowatt':null},evses:[{id:isAlWaha?`kilowatt:${exactId}`:`totalenergies:${slug(name)}`,connectors}],status:isAlWaha?{state:'available',sourceId,statusSource:'Kilowatt public web map',updatedAt:null}:{state:'unknown',sourceId,statusSource:null,updatedAt:null},offers:[]});}
    return{stations,diagnostics,summary:{officialRows:official.rows.length,reconciledHosts:grouped.size,geolocatedHosts:stations.length,excludedWithoutGeo:diagnostics.length,alWahaExactMerged:stations.some(s=>s.canonicalId===`MA:kilowatt:${exactId}`)}};
  }


  // Narrow policy scope: this fallback must never apply to Shell-hosted third-party CPOs.
  function normalizeShellAlJazira(dataset,{sourceId='morocco-shell-al-jazira'}={}){
    const s=dataset?.station;
    if(dataset?.schemaVersion!==1||s?.id!=='10125255'||s?.countryCode!=='MA'||s?.networkBrand!=='Shell Recharge')
      throw new Error('Shell Al Jazira policy scope mismatch');
    const lat=number(s.latitude),lon=number(s.longitude);
    if(!validMoroccoGps(lat,lon))throw new Error('Shell Al Jazira coordinates invalid');
    const tariff=dataset.tariff;
    const explicit=tariff!=null;
    if(explicit&&(!['official','native'].includes(tariff.sourceType)||!text(tariff.sourceUrl)||tariff.currency!=='MAD'||number(tariff.pricePerKwh)==null||number(tariff.pricePerKwh)<0))
      throw new Error('Shell Al Jazira explicit tariff invalid');
    const rate=explicit?number(tariff.pricePerKwh):0;
    return [{
      canonicalId:'MA:shell:10125255',aliases:['shell-station:10125255'],sourceStationId:s.id,
      countryCode:'MA',name:'Shell Al Jazira',address:text(s.address),latitude:lat,longitude:lon,
      physicalOperator:null,networkBrand:'Shell Recharge',
      access:{kind:'public',limited:false,siteBrand:'Shell',appSource:'Shell official station directory',accessNetwork:'Shell Recharge'},
      evses:[],status:{state:'unknown',sourceId,statusSource:null,updatedAt:null},
      offers:[{id:'shell-al-jazira-direct',provider:explicit?'Shell Recharge':'Shell Recharge — gratuité de repli TCC',
        kind:'direct',countries:['MA'],currency:'MAD',pricing:{type:'rules',rules:[{scope:'allDay',pricePerKwh:rate}]},
        metadata:{tariffChannel:'Shell Recharge direct',tariffSource:explicit?tariff.sourceType:'tcc_policy_fallback',
          fallbackApplied:!explicit,officialPriceVerified:explicit,sourceUrl:explicit?tariff.sourceUrl:dataset.policyUrl}}],
      metadata:{evidence:s.evidence,coordinateConfidence:'candidate',connectorDetailsVerified:false},
      updatedAt:null
    }];
  }

  function createLoader({source,fetchImpl,nowMs}={}){
    if(!source?.profile)throw new Error('Morocco source profile missing');
    return async function(){
      if(source.profile==='shell-al-jazira-policy')return normalizeShellAlJazira(await fetchJson(source.url,fetchImpl),{sourceId:source.id});
      if(source.profile==='evgo'){
        const statusUrl=text(source.statusUrl)||String(source.url||'').replace(/latest-normalized-stations\.json(?:\?.*)?$/,'latest-status-overlay.json');
        if(!statusUrl||statusUrl===source.url)throw new Error('EVGO status overlay URL unresolved');
        const [inventory,overlay]=await Promise.all([fetchJson(source.url,fetchImpl),fetchJson(statusUrl,fetchImpl)]);
        const freshness=evgoOverlayFreshness(overlay,number(source.freshnessMaxMinutes)??120,nowMs==null?Date.now():Number(nowMs));
        return normalizeEvgoDataset(applyEvgoStatusOverlay(inventory,overlay),{sourceId:source.id,statusFresh:freshness.fresh,statusGeneratedAt:freshness.generatedAt});
      }
      if(source.profile==='fastvolt')return normalizeFastVoltDataset(await fetchJson(source.url,fetchImpl),{sourceId:source.id});
      if(source.profile==='kilowatt-native'){const [inventory,native]=await Promise.all([fetchJson(source.urls.inventory,fetchImpl),fetchJson(source.urls.native,fetchImpl)]);const freshness=kilowattNativeFreshness(native,number(source.freshnessMaxMinutes)??1560,nowMs==null?Date.now():Number(nowMs));return normalizeKilowattNativeDataset(inventory,native,{sourceId:source.id,statusFresh:freshness.fresh,statusGeneratedAt:freshness.generatedAt,minStations:number(source.expectedMinStations)??43,minConnectors:number(source.expectedMinConnectors)??80});}
      if(source.profile==='kilowatt')return normalizeKilowattDataset(await fetchJson(source.url,fetchImpl),{sourceId:source.id});
      if(source.profile==='totalenergies-native'){const dataset=await fetchJson(source.url,fetchImpl);const freshness=totalNativeFreshness(dataset,number(source.freshnessMaxMinutes)??180,nowMs==null?Date.now():Number(nowMs));return normalizeTotalNativeDataset(dataset,{sourceId:source.id,statusFresh:freshness.fresh,statusGeneratedAt:freshness.generatedAt,minStations:number(source.expectedMinStations)??18,minConnectors:number(source.expectedMinConnectors)??38});}
      if(source.profile==='totalenergies'){const [official,alWaha,links]=await Promise.all([fetchJson(source.urls.official,fetchImpl),fetchJson(source.urls.alWaha,fetchImpl),fetchJson(source.urls.links,fetchImpl)]);return normalizeTotalEnergies(official,alWaha,links,{sourceId:source.id}).stations;}
      throw new Error(`unsupported Morocco profile ${source.profile}`);
    };
  }

  return{createLoader,normalizeShellAlJazira,normalizeEvgoDataset,applyEvgoStatusOverlay,evgoOverlayFreshness,normalizeFastVoltDataset,normalizeKilowattDataset,normalizeKilowattNativeDataset,kilowattNativeConnectorState,kilowattNativeAggregateState,kilowattNativeFreshness,kilowattNativePricing,normalizeTotalNativeDataset,totalNativeFreshness,totalNativeConnectorState,normalizeTotalEnergies,evgoClassify,kilowattState};
});