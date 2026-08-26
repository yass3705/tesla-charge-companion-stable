// Tesla Charge Companion V8 — intégrité centrale des offres et métadonnées commerciales.
// Objectif: préserver la provenance, l'éligibilité abonnement et les offres directes
// à travers la normalisation historique, sans corriger les cartes au niveau DOM.
(function(){
  'use strict';
  const REVISION='v8-tariff-integrity-1';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const diagnostics=[];
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function record(message,detail){diagnostics.push({at:new Date().toISOString(),message,detail:detail||null});if(diagnostics.length>80)diagnostics.shift();}
  function commercialMetadata(raw){
    if(!raw||typeof raw!=='object')return{};
    const out={};
    for(const [key,value] of Object.entries(raw)){
      if(['id','label','kind','powerKw','stalls','pricing'].includes(key))continue;
      out[key]=value;
    }
    return out;
  }
  function preserveNormalizedMetadata(rawList,normalized){
    if(!Array.isArray(normalized))return normalized;
    const source=Array.isArray(rawList)?rawList:[];
    return normalized.map((cfg,index)=>{
      const raw=source[index];
      if(!raw||typeof raw!=='object'||!cfg||typeof cfg!=='object')return cfg;
      return{...commercialMetadata(raw),...cfg};
    });
  }
  function sourceConfigurations(configs,st){
    if(Array.isArray(configs)&&configs.length)return configs;
    if(Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length)return st.chargingConfigurations;
    return[];
  }
  function installNormalizeIntegrity(){
    const current=window.normalizeConfigurations;
    if(typeof current!=='function')return false;
    if(current.__tccTariffIntegrityV1)return true;
    const wrapped=function(configs,st){
      const raw=sourceConfigurations(configs,st);
      return preserveNormalizedMetadata(raw,current.call(this,configs,st));
    };
    wrapped.__tccTariffIntegrityV1=true;wrapped.__tccOriginal=current;
    window.normalizeConfigurations=wrapped;try{normalizeConfigurations=wrapped}catch(e){}
    record('normalizeConfigurations protège les métadonnées commerciales');
    return true;
  }

  function provider(cfg){return norm(cfg?.offerProvider||cfg?.configurationLabel||cfg?.label)}
  function hasDirect(st,wanted){return(st?.chargingConfigurations||[]).some(cfg=>provider(cfg).includes(norm(wanted))&&provider(cfg).includes('direct'))}
  function belibSubscriptionId(cfg){
    const plan=norm(cfg?.belibCustomerPlan);
    if(plan==='resident')return'belib-resident';
    if(plan==='nonresident'||plan==='non resident')return'belib-nonresident';
    return'';
  }
  function repairBelibMetadata(prepared){
    let changed=0;
    for(const st of prepared?.stations||[]){
      for(const cfg of st?.chargingConfigurations||[]){
        if(!cfg?.belibDirect)continue;
        const id=text(cfg.subscriptionId||cfg.subscriptionSelectionId)||belibSubscriptionId(cfg);
        if(!id)continue;
        if(cfg.subscriptionId!==id||cfg.subscriptionSelectionId!==id){cfg.subscriptionId=id;cfg.subscriptionSelectionId=id;changed++;}
      }
    }
    if(changed)record('Métadonnées abonnements Belib restaurées',{changed});
    return changed;
  }

  function sameIdentity(st,location){
    const sn=norm(st?.name),ln=norm(location?.name),sa=norm(st?.address),la=norm(location?.address);
    if(sn&&ln&&sn===ln)return true;
    if(sa&&la&&sa===la)return true;
    return false;
  }
  async function waitFor(fn,timeout=6000){const start=Date.now();while(Date.now()-start<timeout){const v=fn();if(v)return v;await sleep(40)}return fn()||null}
  async function enrichPowerdotIdentity(prepared){
    const catalog=await waitFor(()=>window.TCCFranceCatalog),api=await waitFor(()=>window.TCCFranceCatalogV8);
    if(!catalog?.loadPowerdotCatalog||!api?.powerdotLocations||!api?.powerdotDirectConfigurations||!api?.mergedPowerdotStation||!api?.isPowerdotOperator)return prepared;
    const data=await catalog.loadPowerdotCatalog();if(!Array.isArray(data?.chargers))return prepared;
    const locations=api.powerdotLocations(data).filter(loc=>api.powerdotDirectConfigurations(loc).length>0);
    let matched=0;
    prepared.stations=(prepared.stations||[]).map(st=>{
      if(!api.isPowerdotOperator(st)||hasDirect(st,'powerdot'))return st;
      const exact=locations.filter(loc=>sameIdentity(st,loc));
      if(exact.length!==1)return st;
      matched++;return api.mergedPowerdotStation(exact[0],data,[st]);
    });
    if(matched)record('Powerdot rapproché par identité stricte',{matched});
    return prepared;
  }

  function bumpOperator(st){return[st?.operator,st?._sourceOperator,st?.cpo,st?.network].map(norm).some(v=>v==='bump'||v.startsWith('bump ')||v.includes(' bump '))}
  function physicalConfigs(st){
    const src=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations:[{kind:st?.kind,powerKw:st?.powerKw,stalls:st?.stalls}];
    const seen=new Set(),out=[];
    for(const cfg of src){
      if(provider(cfg).includes('bump direct'))continue;
      const kind=text(cfg?.kind||st?.kind).toUpperCase(),power=Number(cfg?.powerKw??st?.powerKw??0);if(!['AC','DC'].includes(kind)||!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);out.push({kind,powerKw:power,stalls:Number(cfg?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function bumpIdentityRecords(st,data){
    const name=norm(st?.name),address=norm(st?.address);
    return(data?.stations||[]).filter(rec=>(name&&norm(rec?.name)===name)||(address&&norm(rec?.address)===address));
  }
  function bumpRankable(p){return p?.rankable===true&&(p?.status==='rankable_static'||p?.status==='rankable_rule_based')}
  function signature(p){return JSON.stringify({components:p?.components||null,rules:p?.rules||null})}
  function safeBumpPoint(st,cfg,data){
    const records=bumpIdentityRecords(st,data);if(!records.length)return null;
    const points=records.flatMap(rec=>(rec?.points||[]).map(p=>({...p,stationId:rec.stationId}))).filter(p=>Number(p?.powerKw)>0);
    if(!points.length)return null;
    const distances=points.map(p=>Math.abs(Number(p.powerKw)-cfg.powerKw));const nearest=Math.min(...distances);
    const tolerance=Math.max(.6,cfg.powerKw*.10);if(nearest>tolerance+1e-9)return null;
    const nearestPoints=points.filter(p=>Math.abs(Math.abs(Number(p.powerKw)-cfg.powerKw)-nearest)<1e-6);
    if(!nearestPoints.length||nearestPoints.some(p=>!bumpRankable(p)))return null;
    const signatures=new Set(nearestPoints.map(signature));if(signatures.size!==1)return null;
    return{...nearestPoints[0],matchedIds:nearestPoints.map(p=>text(p.idPdcItinerance)).filter(Boolean),sourcePowerKw:Number(nearestPoints[0].powerKw)};
  }
  async function enrichBumpNominalPower(prepared){
    const api=await waitFor(()=>window.TCCBumpDirectV8,7000);if(!api?.loadCatalog||!api?.basePricing)return prepared;
    const data=await api.loadCatalog();if(!data?.stations)return prepared;
    let addedCount=0;
    prepared.stations=(prepared.stations||[]).map(st=>{
      if(!bumpOperator(st)||hasDirect(st,'bump'))return st;
      const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
      for(const cfg of physicalConfigs(st)){
        const point=safeBumpPoint(st,cfg,data);if(!point)continue;
        added.push({
          id:`bump-direct-integrity:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
          label:`Bump Direct · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:Math.max(1,cfg.stalls||1),
          pricing:api.basePricing(point),offerProvider:'Bump Direct',offerType:'operator_direct',bumpDirectOffer:true,bumpVerified:true,
          bumpMatchMode:'strict_identity_nominal_power',bumpMatchedEvseIds:point.matchedIds||[],bumpStationId:point.stationId||'',bumpSourcePowerKw:point.sourcePowerKw,
          bumpTariffGroupId:point.tariffGroupId||'',bumpTariffId:point.tariffId||'',bumpRankableStatus:point.status
        });
      }
      if(!added.length)return st;addedCount+=added.length;return{...st,chargingConfigurations:[...base,...added],_bumpDirectOffers:[...(st._bumpDirectOffers||[]),...added.map(x=>x.id)]};
    });
    if(addedCount)record('Bump rapproché par identité + puissance nominale',{added:addedCount});
    return prepared;
  }

  async function integrityEnricher(prepared){
    repairBelibMetadata(prepared);
    await enrichPowerdotIdentity(prepared);
    await enrichBumpNominalPower(prepared);
    repairBelibMetadata(prepared);
    return prepared;
  }
  function register(){
    const pipeline=window.TCCV8DirectPipeline;if(!pipeline?.registerPreparedEnricher)return false;
    pipeline.registerPreparedEnricher('tariff-integrity',integrityEnricher,90);return true;
  }
  function boot(){
    installNormalizeIntegrity();register();
    let tries=0;const timer=setInterval(()=>{tries++;installNormalizeIntegrity();register();if(tries>600)clearInterval(timer)},100);
  }

  window.TCCV8TariffIntegrity={revision:REVISION,preserveNormalizedMetadata,installNormalizeIntegrity,repairBelibMetadata,enrichPowerdotIdentity,enrichBumpNominalPower,integrityEnricher,safeBumpPoint,sameIdentity,get diagnostics(){return diagnostics.slice()}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else queueMicrotask(boot);
  console.info('[TCC V8] Intégrité tarifaire centrale active:',REVISION);
})();
