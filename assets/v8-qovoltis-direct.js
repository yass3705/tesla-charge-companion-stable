// Tesla Charge Companion V8 — Qovoltis direct, station/power exact and fail-closed.
// Source is a preview-local artifact generated from the public ChargeNow site-details endpoint.
(function(){
  'use strict';
  const VERSION='v8-qovoltis-direct-20260827a';
  const DATA_URL='data/qovoltis_direct_tariffs_v1.json?v=20260827a';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const compact=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  let catalog=null,catalogPromise=null,indexCache=null;

  function loadCatalog(){
    if(catalogPromise)return catalogPromise;
    catalogPromise=fetch(DATA_URL,{cache:'no-store'}).then(r=>{
      if(!r.ok)throw new Error(`Qovoltis dataset unavailable (${r.status})`);
      return r.json();
    }).then(data=>{
      if(data?.dataset!=='qovoltis-direct-safe-station-power-v1'||data?.policy?.failClosed!==true||!Array.isArray(data?.stations))throw new Error('Qovoltis dataset invalid');
      catalog=data;indexCache=null;return data;
    }).catch(err=>{console.warn('[TCC V8] Qovoltis direct not loaded:',err);return null;});
    return catalogPromise;
  }

  function providerOf(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function operatorValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network].map(norm).filter(Boolean)}
  function isQovoltisOperator(st){return operatorValues(st).some(v=>v==='qovoltis'||v.startsWith('qovoltis '))}
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls}];
    const seen=new Set(),out=[];
    for(const c of src){
      if(providerOf(c)==='qovoltis direct'||c?.qovoltisDirectOffer)continue;
      const kind=text(c?.kind||st?.kind||'').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function hasDirect(configs,cfg){return(configs||[]).some(c=>providerOf(c)==='qovoltis direct'&&text(c?.kind).toUpperCase()===cfg.kind&&Math.abs(Number(c?.powerKw||0)-cfg.powerKw)<.35)}

  function indexes(data){
    if(indexCache?.data===data)return indexCache;
    const byStation=new Map(),byName=new Map(),byAddress=new Map();
    const add=(idx,key,rec)=>{if(!key)return;if(!idx.has(key))idx.set(key,[]);idx.get(key).push(rec)};
    for(const raw of data?.stations||[]){
      const rec={...raw,stationId:compact(raw?.stationId)};
      add(byStation,rec.stationId,rec);add(byName,norm(rec.name),rec);add(byAddress,norm(rec.address),rec);
    }
    indexCache={data,byStation,byName,byAddress};return indexCache;
  }
  function collectStationIds(st){
    const ids=new Set(),seen=new Set();
    function scan(v,depth=0){
      if(v==null||depth>4)return;
      if(typeof v==='string'||typeof v==='number'){
        const raw=String(v).toUpperCase();
        for(const m of raw.match(/FRQO[VI][A-Z0-9]+/g)||[])ids.add(compact(m));
        return;
      }
      if(typeof v!=='object'||seen.has(v))return;seen.add(v);
      if(Array.isArray(v)){v.slice(0,250).forEach(x=>scan(x,depth+1));return;}
      for(const [k,x] of Object.entries(v)){
        const nk=norm(k);if(depth<=1||/(?:evse|pdc|station|source|external|identifier|^id$|ids)/.test(nk))scan(x,depth+1);
      }
    }
    scan(st);return[...ids];
  }
  function powerOffer(rec,cfg){
    const rows=(rec?.powers||[]).filter(p=>p?.rankable===true&&Number.isFinite(Number(p?.pricePerKwhEur))&&Math.abs(Number(p.powerKw)-Number(cfg.powerKw))<.35);
    if(rows.length!==1)return null;
    return rows[0];
  }
  function consistent(records,cfg,mode){
    const hits=(records||[]).map(rec=>({rec,power:powerOffer(rec,cfg)})).filter(x=>x.power);
    if(!hits.length)return null;
    const sig=new Set(hits.map(x=>Number(x.power.pricePerKwhEur).toFixed(6)));
    if(sig.size!==1)return null;
    return {...hits[0].power,qovoltisMatchMode:mode,qovoltisStationIds:hits.map(x=>x.rec.stationId).filter(Boolean)};
  }
  function resolve(st,cfg,data=catalog){
    if(!data?.stations)return null;const idx=indexes(data),ids=collectStationIds(st);
    for(const sid of ids){const hit=consistent(idx.byStation.get(sid)||[],cfg,'station_id');if(hit)return hit;}
    if(!isQovoltisOperator(st))return null;
    for(const n of [norm(st?.name),norm(st?._sourceName)].filter(x=>x.length>=6)){
      const hit=consistent(idx.byName.get(n)||[],cfg,'exact_name_power');if(hit)return hit;
    }
    for(const a of [norm(st?.address),norm(st?._sourceAddress)].filter(x=>x.length>=8)){
      const hit=consistent(idx.byAddress.get(a)||[],cfg,'exact_address_power');if(hit)return hit;
    }
    return null;
  }
  function pricing(rec){return{type:'rules',rules:[{scope:'allDay',start:'00:00',end:'24:00',billing:'kwh',currency:'EUR',pricePerKwh:Number(rec.pricePerKwhEur),chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0,afterMinutesThreshold:0,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00',postChargeRate:0,postChargeGraceMinutes:0,startedKwhCharged:false}]}}
  function addOffers(st,data=catalog){
    if(!st||String(st.countryCode||'FR').toUpperCase()!=='FR'||!data?.stations)return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      if(hasDirect([...base,...added],cfg))continue;
      const rec=resolve(st,cfg,data);if(!rec)continue;
      added.push({id:`qovoltis-direct:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,label:`Qovoltis direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,pricing:pricing(rec),offerProvider:'Qovoltis direct',offerType:'operator_direct',qovoltisDirectOffer:true,qovoltisMatchMode:rec.qovoltisMatchMode,qovoltisStationIds:rec.qovoltisStationIds||[],qovoltisEnergyExact:true,qovoltisStatusSeparated:true});
    }
    return added.length?{...st,chargingConfigurations:[...base,...added],_qovoltisDirectOffers:[...(st._qovoltisDirectOffers||[]),...added.map(x=>x.id)]}:st;
  }
  async function enrichPrepared(prepared){
    if(!prepared||!Array.isArray(prepared.stations))return prepared;
    const data=await loadCatalog();if(!data)return prepared;
    prepared.stations=prepared.stations.map(st=>addOffers(st,data));
    prepared.qovoltisDirectPipelineApplied=true;return prepared;
  }
  function register(){const p=window.TCCV8DirectPipeline;if(!p?.registerPreparedEnricher)return false;p.registerPreparedEnricher('qovoltis-direct',enrichPrepared,60);return true;}
  if(!register()&&typeof document!=='undefined')document.addEventListener('tcc:direct-offer-pipeline-ready',register,{once:true});
  window.TCCV8QovoltisDirect={version:VERSION,loadCatalog,addOffers,resolve,isQovoltisOperator,enrichPrepared,get catalog(){return catalog}};
})();
