// Tesla Charge Companion V8 RC4.8 — tarifs directs DRIVECO validés EVSE par EVSE.
// Aucun tarif d'itinérance. Aucun fallback national. Les matrices OSF non validées restent exclues.
(function(){
  'use strict';
  const VERSION='rc48-driveco-direct-20260826a';
  const MAP_URL='data/driveco_evse_tariffs_v1.json?v=20260826a';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const compact=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  let tariffMap=null,mapPromise=null,indexCache=null;

  function loadMap(){
    if(mapPromise)return mapPromise;
    mapPromise=fetch(MAP_URL,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`carte DRIVECO indisponible (${r.status})`);
      return r.json();
    }).then(data=>{
      if(!data||data.operator!=='DRIVECO'||!data.evses||typeof data.evses!=='object')throw new Error('carte DRIVECO invalide');
      tariffMap=data;indexCache=null;window.TCC_DRIVECO_TARIFF_MAP_V1=data;
      document.dispatchEvent(new CustomEvent('tcc:driveco-map-ready',{detail:{safe:Number(data?.validatedInventory?.fullSessionCostSafeEvseCount||0)}}));
      return data;
    }).catch(err=>{
      console.warn('[TCC V8] Carte DRIVECO non chargée:',err);return null;
    });
    return mapPromise;
  }

  function operatorValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network].map(norm).filter(Boolean)}
  function isDrivecoOperator(st){return operatorValues(st).some(v=>v==='driveco'||v==='driveco network'||v==='driveco partner network'||v.startsWith('driveco '))}
  function providerOf(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls,pricing:st?.pricing}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(providerOf(c)==='driveco direct'||c?.drivecoDirectOffer)continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function hasDirect(configs,cfg){return(configs||[]).some(c=>providerOf(c)==='driveco direct'&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.35)}

  function indexes(map){
    if(indexCache?.map===map)return indexCache;
    const byStation=new Map(),byName=new Map(),byAddress=new Map();
    const add=(idx,key,rec)=>{if(!key)return;if(!idx.has(key))idx.set(key,[]);idx.get(key).push(rec)};
    for(const [evseId,raw] of Object.entries(map?.evses||{})){
      if(raw?.rankable!==true||raw?.fullSessionCostSafe!==true)continue;
      const rec={...raw,evseId:compact(evseId)};
      add(byStation,compact(rec.stationId),rec);add(byName,norm(rec.stationName),rec);add(byAddress,norm(rec.address),rec);
    }
    indexCache={map,byStation,byName,byAddress};return indexCache;
  }
  function collectDrivecoIds(st){
    const evse=new Set(),station=new Set(),seen=new Set();
    function scan(v,depth=0,key=''){
      if(v==null||depth>4)return;
      if(typeof v==='string'||typeof v==='number'){
        const raw=String(v).toUpperCase();
        for(const m of raw.match(/FRDRVE[A-Z0-9]+/g)||[])evse.add(compact(m));
        for(const m of raw.match(/FRDRVP[A-Z0-9]+/g)||[])station.add(compact(m));
        return;
      }
      if(typeof v!=='object'||seen.has(v))return;seen.add(v);
      if(Array.isArray(v)){v.slice(0,250).forEach(x=>scan(x,depth+1,key));return;}
      for(const [k,x] of Object.entries(v)){
        const nk=norm(k);if(depth<=1||/(?:evse|pdc|station|source|external|identifier|^id$|ids)/.test(nk))scan(x,depth+1,k);
      }
    }
    scan(st);return{evse:[...evse],station:[...station]};
  }
  function compatible(rec,cfg){return Math.abs(Number(rec?.powerKw||0)-Number(cfg?.powerKw||0))<.35}
  function consistent(records,mode){
    const rows=(records||[]).filter(r=>r?.rankable===true&&r?.fullSessionCostSafe===true);
    if(!rows.length)return null;
    const sig=new Set(rows.map(r=>[
      Number(r.pricePerKwhEur).toFixed(6),Number(r?.fixedPriceEur||0).toFixed(6),Number(r?.minimumBillingEur||0).toFixed(6),
      Number(r?.occupancy?.ratePerMinuteEur||0).toFixed(6),Number(r?.occupancy?.graceMinutes||0),text(r?.occupancy?.trigger)
    ].join('|')));
    if(sig.size!==1)return null;
    return {...rows[0],drivecoMatchMode:mode,drivecoMatchedEvseIds:rows.map(r=>r.evseId).filter(Boolean)};
  }
  function resolve(st,cfg,map){
    if(!map?.evses)return null;const idx=indexes(map),ids=collectDrivecoIds(st);
    const exact=ids.evse.map(id=>map.evses[id]?{...map.evses[id],evseId:id}:null).filter(Boolean).filter(r=>compatible(r,cfg));
    const exactHit=consistent(exact,'evse');if(exactHit)return exactHit;
    for(const sid of ids.station){const hit=consistent((idx.byStation.get(sid)||[]).filter(r=>compatible(r,cfg)),'station_id');if(hit)return hit;}
    if(!isDrivecoOperator(st))return null;
    const names=[norm(st?.name),norm(st?._sourceName)].filter(x=>x.length>=6);
    for(const n of names){const hit=consistent((idx.byName.get(n)||[]).filter(r=>compatible(r,cfg)),'exact_name_power');if(hit)return hit;}
    const addresses=[norm(st?.address),norm(st?._sourceAddress)].filter(x=>x.length>=8);
    for(const a of addresses){const hit=consistent((idx.byAddress.get(a)||[]).filter(r=>compatible(r,cfg)),'exact_address_power');if(hit)return hit;}
    return null;
  }
  function pricing(rec){
    const occ=rec?.occupancy||{};
    return {type:'rules',rules:[{
      scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(rec.pricePerKwhEur),
      chargePerMinute:0,connectionFee:Number(rec.fixedPriceEur||0),idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,
      afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00',postChargeRate:Number(occ.ratePerMinuteEur||0),postChargeGraceMinutes:Number(occ.graceMinutes||0),
      startedKwhCharged:false
    }]};
  }
  function addOffers(st,map=tariffMap){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!map?.evses)return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      if(hasDirect([...base,...added],cfg))continue;
      const rec=resolve(st,cfg,map);if(!rec)continue;
      added.push({
        id:`driveco-direct:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,label:`DRIVECO direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,
        pricing:pricing(rec),offerProvider:'DRIVECO direct',offerType:'operator_direct',drivecoDirectOffer:true,drivecoMapVersion:map.schemaVersion,
        drivecoMatchMode:rec.drivecoMatchMode,drivecoMatchedEvseIds:rec.drivecoMatchedEvseIds||[],drivecoStationId:rec.stationId||'',drivecoReferenceAddress:rec.address||'',
        drivecoEnergyExact:true,drivecoFullSessionCostSafe:true,drivecoValidationSource:rec?.occupancy?.validationSource||'validated_no_osf'
      });
    }
    return added.length?{...st,chargingConfigurations:[...base,...added],_drivecoDirectOffers:[...(st._drivecoDirectOffers||[]),...added.map(x=>x.id)]}:st;
  }
  function install(){
    const current=window.expandConfigurations;if(typeof current!=='function')return false;if(current.__tccDrivecoDirect20260826)return true;
    const wrapped=function(baseStations){const source=Array.isArray(baseStations)?baseStations.map(st=>addOffers(st)):baseStations;return current.call(this,source)};
    wrapped.__tccDrivecoDirect20260826=true;wrapped.__tccOriginal=current;
    if(current.__tccOverlayExpansionGuard)wrapped.__tccOverlayExpansionGuard=true;
    if(current.__tccDirectResolverPowerV1)wrapped.__tccDirectResolverPowerV1=true;
    if(current.__tccDirectSmokeFix)wrapped.__tccDirectSmokeFix=true;
    window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}
    return true;
  }
  loadMap();
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>240)clearInterval(timer)},50);
  document.addEventListener('tcc:driveco-map-ready',()=>install());
  window.TCCV8DrivecoDirect={version:VERSION,loadMap,addOffers,resolve,isDrivecoOperator,get map(){return tariffMap}};
})();
