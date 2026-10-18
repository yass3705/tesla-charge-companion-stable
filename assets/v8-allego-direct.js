// Tesla Charge Companion V8 — Allego CPO-direct exact tariff overlay.
// Exact station/EVSE energy prices only. Country defaults and roaming tariffs are never rankable.
(function(){
  'use strict';
  const DATA_URL='../data/allego_direct_stations_france.json.gz';
  const text=value=>String(value==null?'':value).trim();
  const norm=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  let dataPromise=null;

  function geoDistanceKm(aLat,aLon,bLat,bLon){
    const A=Number(aLat),B=Number(aLon),C=Number(bLat),D=Number(bLon);
    if(![A,B,C,D].every(Number.isFinite))return Infinity;
    const R=6371,toRad=value=>value*Math.PI/180;
    const dLat=toRad(C-A),dLon=toRad(D-B);
    const q=Math.sin(dLat/2)**2+Math.cos(toRad(A))*Math.cos(toRad(C))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(q));
  }

  async function readGzipJson(url){
    const response=await fetch(`${url}?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`Base Allego indisponible (${response.status})`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes[0]!==0x1f||bytes[1]!==0x8b)throw new Error('Compression Allego invalide');
    if(typeof DecompressionStream!=='function')throw new Error('Décompression Allego indisponible dans ce navigateur');
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }

  async function loadAllegoCatalog(){
    if(!dataPromise)dataPromise=readGzipJson(DATA_URL).then(data=>{
      const counts=data?.counts||{};
      if(data?.dataset!=='allego-direct-operated-stations-france'||data?.operator!=='Allego'||data?.country!=='FR')throw new Error('Dataset Allego inattendu');
      if(data?.scope?.operatorDirectOnly!==true||data?.scope?.roamingIncluded!==false||data?.scope?.countryDefaultsAreRankable!==false||data?.scope?.exactDirectPricesFromDxp!==true)throw new Error('Périmètre Allego Direct invalide');
      if(!Array.isArray(data?.stations)||data.stations.length<300||Number(counts.franceEvseCount)<2000)throw new Error('Inventaire Allego France incomplet');
      if(Number(counts.dxpPricedEvsePct)<60||Number(counts.dxpPricedEvseCount)<1500)throw new Error('Couverture tarifaire Allego DXP insuffisante');
      if(Number(counts.stationsWithCoordinates)<300||Number(counts.irveLinkedEvseCount)<2000)throw new Error('Rattachement IRVE Allego insuffisant');
      if(data.stations.some(station=>station.rankableDirect&&!Array.isArray(station.coordinates)))throw new Error('Station Allego tarifée sans coordonnées');
      window.TCC_ALLEGO_DIRECT_CATALOG_V1=data;
      return data;
    }).catch(error=>{
      console.warn('[TCC V8] Base Allego Direct ignorée :',error?.message||error);
      return {stations:[],counts:{},generatedAt:''};
    });
    return dataPromise;
  }

  function isAllegoOperator(station){
    const value=norm(station?.operator);
    return value==='allego'||value.startsWith('allego ');
  }

  function pricing(pricePerKwhEur){
    return {type:'rules',rules:[{
      scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(pricePerKwhEur),
      chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,
      afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'
    }]};
  }

  function directConfigurations(record){
    const groups=new Map(),powerVariants=new Map();
    for(const evse of record?.evses||[]){
      const price=Number(evse?.directEurPerKwh),power=Number(evse?.powerKw||evse?.dxpMaxPowerKw),kind=text(evse?.kind).toUpperCase()||((power>22.5)?'DC':'AC');
      if(!(price>0)||!(power>0)||!['AC','DC'].includes(kind))continue;
      const powerKey=`${kind}|${power.toFixed(3)}`,key=`${powerKey}|${price.toFixed(6)}`;
      if(!groups.has(key))groups.set(key,{kind,power,price,evses:[]});
      groups.get(key).evses.push(evse);
      if(!powerVariants.has(powerKey))powerVariants.set(powerKey,new Set());
      powerVariants.get(powerKey).add(price.toFixed(6));
    }
    const stationKey=text(record?.irveStationIds?.[0])||text(record?.name).replace(/\W+/g,'-').toLowerCase()||'station';
    return [...groups.values()].map((group,index)=>{
      const ids=[...new Set(group.evses.map(evse=>text(evse.evseId)).filter(Boolean))];
      const refs=ids.map(id=>id.replace(/^FRALLEGO/i,'')).filter(Boolean);
      const powerKey=`${group.kind}|${group.power.toFixed(3)}`;
      const provider=powerVariants.get(powerKey)?.size>1?`Allego Direct (bornes ${refs.join(', ')})`:'Allego Direct';
      return {
        id:`allego-direct-${stationKey}-${index}`,
        label:`${provider} · ${group.kind} ${group.power} kW`,kind:group.kind,powerKw:group.power,stalls:group.evses.length,
        pricing:pricing(group.price),offerProvider:provider,offerType:'operator_direct',allegoDirect:true,allegoVerified:true,
        allegoEvseIds:ids,allegoPricePerKwhEur:group.price,
        allegoDxpChargePointIds:[...new Set(group.evses.map(evse=>text(evse.dxpChargePointId)).filter(Boolean))],
        allegoSubscriberDiscountApplicable:group.evses.some(evse=>evse.subscriberDiscountApplicable===true),
        allegoFeeCandidates:group.evses.flatMap(evse=>Array.isArray(evse.dxpFeeCandidates)?evse.dxpFeeCandidates:[])
      };
    });
  }

  function priceSignature(config){
    return JSON.stringify((config?.pricing?.rules||[]).map(rule=>({
      billing:rule.billing||'',currency:(rule.currency||'EUR').toUpperCase(),k:Number(rule.pricePerKwh||0),m:Number(rule.chargePerMinute||0),f:Number(rule.connectionFee||0),i:Number(rule.idlePerMinute||0),ar:Number(rule.afterMinutesRate||0),at:Number(rule.afterMinutesThreshold||0)
    })));
  }

  function mergeConfigurations(configs){
    const map=new Map();
    for(const config of configs||[]){
      const provider=text(config.offerProvider)||text(config.label).split('·')[0].trim();
      const key=[norm(provider),text(config.kind).toUpperCase(),Number(config.powerKw||0).toFixed(3),priceSignature(config)].join('|');
      const existing=map.get(key);
      if(!existing){map.set(key,config);continue;}
      existing.stalls=Math.max(Number(existing.stalls||0),Number(config.stalls||0));
      if(config.allegoEvseIds)existing.allegoEvseIds=[...new Set([...(existing.allegoEvseIds||[]),...config.allegoEvseIds])];
    }
    return [...map.values()];
  }

  function recordId(record){
    return text(record?.irveStationIds?.[0])||text(record?.stationPageUrl)||text(record?.name);
  }

  function stationNameKey(value){
    return norm(value).replace(/\b(station|charging|charge|borne|allego|france)\b/g,' ').replace(/\s+/g,' ').trim();
  }

  function bestRecordForStation(station,records,used){
    let best=null;
    for(const record of records){
      const id=recordId(record);if(used.has(id))continue;
      const coords=record.coordinates||[],distance=geoDistanceKm(station.latitude,station.longitude,coords[0],coords[1]);
      if(distance>.15+1e-9)continue;
      const sourceName=stationNameKey(station.name),targetName=stationNameKey(record.name);
      const sameName=!!(sourceName&&targetName&&(sourceName.includes(targetName)||targetName.includes(sourceName)));
      const score=distance-(sameName ? .03 : 0);
      if(!best||score<best.score)best={record,distance,score};
    }
    return best;
  }

  function mergedStation(record,baseStation=null){
    const direct=directConfigurations(record);
    if(!direct.length)return baseStation;
    const existing=(baseStation?.chargingConfigurations||[]).filter(config=>!config.allegoDirect);
    const configurations=mergeConfigurations([...direct,...existing]);
    const first=direct[0];
    const coords=record.coordinates||[];
    const base=baseStation?{...baseStation}:{
      id:`france-catalog:allego:${recordId(record)}`,catalogStationId:`allego:${recordId(record)}`,source:'franceNationalCatalog',countryCode:'FR',temporarilyUnavailable:false,readOnlyCatalog:true,
      access:{limited:false,unknown:true,days:{},afterCloseMode:'exit_allowed',afterCloseNote:'Horaires non fournis par la base tarifaire Allego — accès à vérifier.'}
    };
    return {
      ...base,name:record.name||base.name||'Station Allego',address:record.irveAddress||record.address||base.address||'',latitude:Number(coords[0]),longitude:Number(coords[1]),
      operator:'Allego',stalls:direct.reduce((sum,config)=>sum+Number(config.stalls||0),0),kind:first.kind,powerKw:first.powerKw,pricing:first.pricing,chargingConfigurations:configurations,
      lastUpdated:String(window.TCC_ALLEGO_DIRECT_CATALOG_V1?.generatedAt||'').slice(0,10),allegoStrictCpo:true,allegoDirectPricingContext:'official_dxp',
      allegoIrveStationIds:[...(record.irveStationIds||[])],allegoOfficialEvseIds:[...(record.evses||[]).map(evse=>evse.evseId).filter(Boolean)],
      allegoDirectEvseCount:direct.reduce((sum,config)=>sum+Number(config.stalls||0),0),allegoPricingStatus:record.pricingStatus||'',allegoStationPageUrl:record.stationPageUrl||'',
      allegoSourceCatalogStationId:baseStation?.catalogStationId||'',allegoStatusJoinedExternally:!!baseStation
    };
  }

  function overlayPrepared(prepared,data,maxDistanceKm=0){
    if(!prepared||!Array.isArray(prepared.stations)||!Array.isArray(data?.stations)||!data.stations.length)return prepared;
    const origin=prepared.origin||{},radius=Number(maxDistanceKm)||0;
    const records=data.stations.filter(record=>record?.rankableDirect===true&&Array.isArray(record.coordinates)&&record.coordinates.length>=2)
      .filter(record=>!(radius>0)||geoDistanceKm(origin.lat,origin.lon,record.coordinates[0],record.coordinates[1])<=radius+1e-6);
    const used=new Set(),output=[];
    let matched=0,added=0,directEvses=0;
    for(const station of prepared.stations){
      if(!isAllegoOperator(station)){output.push(station);continue;}
      const best=bestRecordForStation(station,records,used);
      if(!best){output.push(station);continue;}
      const id=recordId(best.record);used.add(id);
      const merged=mergedStation(best.record,station);
      if(merged){output.push(merged);matched++;directEvses+=Number(merged.allegoDirectEvseCount||0);}else output.push(station);
    }
    for(const record of records){
      const id=recordId(record);if(used.has(id))continue;
      const station=mergedStation(record,null);if(!station)continue;
      station._airKm=geoDistanceKm(origin.lat,origin.lon,station.latitude,station.longitude);
      output.push(station);used.add(id);added++;directEvses+=Number(station.allegoDirectEvseCount||0);
    }
    output.sort((a,b)=>Number(a._airKm??Infinity)-Number(b._airKm??Infinity));
    prepared.stations=output;
    prepared.allegoDirectCatalogLoaded=true;
    prepared.allegoMergeStats={sourceStations:data.stations.length,rankableInArea:records.length,matched,added,directEvses,outputStations:output.length};
    window.TCC_ALLEGO_MERGE_STATS={...prepared.allegoMergeStats};
    return prepared;
  }

  if(typeof candidateStations!=='function'){
    console.warn('[TCC V8] Overlay Allego non chargé : candidateStations indisponible.');return;
  }
  const previousCandidateStations=candidateStations;
  candidateStations=async function(filterMode='tesla',maxDistanceKm=0){
    const prepared=await previousCandidateStations(filterMode,maxDistanceKm);
    if(filterMode!=='all')return prepared;
    const data=await loadAllegoCatalog();
    return overlayPrepared(prepared,data,maxDistanceKm);
  };

  window.TCCAllegoDirectV8={loadAllegoCatalog,directConfigurations,mergedStation,overlayPrepared,isAllegoOperator,geoDistanceKm,clearCache(){dataPromise=null;}};
  console.info('[TCC V8] Overlay Allego Direct exact par EVSE prêt.');
})();
