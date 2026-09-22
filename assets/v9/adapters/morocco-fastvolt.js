(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoFastVolt=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};

  const VERIFIED_OVERRIDES={
    W00057:{
      siteBrand:'Afriquia',
      source:'manual_native_app_verification_2026-08-29',
      connectors:[
        ...Array.from({length:4},(_,i)=>({id:`fastvolt:W00057:ccs:${i+1}`,kind:'DC',plugName:'CCS2',powerKw:360,powerSource:'native_app_verified'})),
        ...Array.from({length:2},(_,i)=>({id:`fastvolt:W00057:type2:${i+1}`,kind:'AC',plugName:'Type 2',powerKw:22,powerSource:'native_app_verified'}))
      ]
    }
  };

  function publicConnectors(row){
    const out=[],max=number(row?.max_output);
    const add=(count,kind,plug)=>{for(let i=0;i<Number(count||0);i++)out.push({id:`fastvolt:${text(row.charger_id)}:${plug.toLowerCase().replace(/[^a-z0-9]+/g,'-')}:${i+1}`,kind,plugName:plug,powerKw:max,powerSource:'public_map_station_max_output'});};
    add(row?.ccs_count,'DC','CCS');add(row?.chademo_count,'DC','CHAdeMO');add(row?.type2_count,'AC','Type 2');return out;
  }

  function directOffers(id){return[
    {id:`fastvolt-direct-dc:${id}`,provider:'FastVolt direct',kind:'direct',countries:['MA'],currency:'MAD',connectorKinds:['DC'],pricing:{type:'rules',rules:[{scope:'allDay',billing:'minute',currency:'MAD',chargePerMinute:2.5}]},metadata:{tariffChannel:'FastVolt direct',source:'official FastVolt HowIts/FAQ'}},
    {id:`fastvolt-direct-ac:${id}`,provider:'FastVolt direct',kind:'direct',countries:['MA'],currency:'MAD',connectorKinds:['AC'],pricing:{type:'rules',rules:[{scope:'allDay',billing:'minute',currency:'MAD',chargePerMinute:0.5}]},metadata:{tariffChannel:'FastVolt direct',source:'official FastVolt HowIts/FAQ'}}
  ];}

  function normalizeRow(row,{sourceId='morocco-fastvolt-public-map'}={}){
    if(!row||row.production_candidate!==true||!text(row.charger_id))return null;
    const id=text(row.charger_id),override=VERIFIED_OVERRIDES[id]||null,lat=number(row.latitude),lon=number(row.longitude);
    const connectors=override?.connectors||publicConnectors(row);
    const siteBrand=override?.siteBrand??(row.site_brand==null?null:text(row.site_brand));
    return{
      canonicalId:`MA:fastvolt:${id}`,aliases:[`fastvolt-charger:${id}`],sourceStationId:id,countryCode:'MA',
      name:text(row.charger_name||row.label)||`FastVolt ${id}`,address:[text(row.address_line_1),text(row.address_line_2),text(row.city)].filter(Boolean).join(', '),
      latitude:lat,longitude:lon,physicalOperator:{name:'FastVolt / Afrimobility'},networkBrand:'FastVolt',
      access:{kind:'public',limited:false,siteBrand,appSource:'FastVolt public web map',accessNetwork:'FastVolt'},
      status:{state:'unknown',sourceId,statusSource:null,updatedAt:null},
      evses:[{id:`fastvolt:${id}`,aliases:[`fastvolt-evse:${id}`],connectors}],offers:directOffers(id),
      legacy:{hardwareBrand:text(row.brand)||null,hardwareModel:text(row.model)||null,regionRaw:text(row.state)||null,inventorySource:'FastVolt public web map',verifiedOverride:override?.source||null}
    };
  }

  function validateDataset(dataset){
    const rows=Array.isArray(dataset?.chargers)?dataset.chargers:[],production=rows.filter(r=>r?.production_candidate===true),errors=[];
    if(rows.length!==100)errors.push(`expected 100 raw chargers, got ${rows.length}`);
    if(production.length!==97)errors.push(`expected 97 production candidates, got ${production.length}`);
    for(const r of production){const lat=number(r.latitude),lon=number(r.longitude);if(lat==null||lon==null||lat<20||lat>37||lon<-18||lon>0)errors.push(`invalid Morocco GPS for ${r.charger_id}`);}
    const al=production.find(r=>text(r.charger_id)==='W00057');if(!al)errors.push('missing Al Boustane W00057');
    return{ok:errors.length===0,rawCount:rows.length,productionCount:production.length,errors};
  }

  function normalizeDataset(dataset,options={}){const v=validateDataset(dataset);if(!v.ok){const e=new Error(`FastVolt dataset validation failed: ${v.errors.join('; ')}`);e.validation=v;throw e;}return dataset.chargers.map(r=>normalizeRow(r,options)).filter(Boolean);}
  return{VERIFIED_OVERRIDES,publicConnectors,directOffers,normalizeRow,normalizeDataset,validateDataset};
});