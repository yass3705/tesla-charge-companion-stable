(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoEvonePolicy=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ALLOWED=new Set(['available','occupied','charging']);
  const DIAGNOSTIC_ONLY=new Set(['faulted','offline','unknown','unavailable']);
  const text=v=>String(v==null?'':v).trim();

  function classifyEvoneStatus(value){
    const native=text(value);
    const normalized=native.toLowerCase();
    if(ALLOWED.has(normalized))return{nativeStatus:native,productionEligible:true,diagnosticOnly:false,state:normalized==='available'?'available':'occupied'};
    if(DIAGNOSTIC_ONLY.has(normalized))return{nativeStatus:native,productionEligible:false,diagnosticOnly:true,state:'out_of_service'};
    return{nativeStatus:native||null,productionEligible:false,diagnosticOnly:true,state:'unknown'};
  }

  function normalizeEvoneObservation(row,{sourceId='morocco-evone-emsp'}={}){
    const status=classifyEvoneStatus(row?.status);
    return{
      sourceStationId:text(row?.id)||null,
      countryCode:'MA',
      physicalOperator:row?.cpo_operator?{name:text(row.cpo_operator)}:null,
      access:{
        siteBrand:row?.site_brand==null?null:text(row.site_brand),
        appSource:'EVPlug / EvOne',
        accessNetwork:'EVPlug / EvOne'
      },
      status:{state:status.state,nativeState:status.nativeStatus,sourceId,statusSource:'EVPlug / EvOne'},
      tariffChannel:row?.tariff_channel==null?null:text(row.tariff_channel),
      productionEligible:status.productionEligible,
      diagnosticOnly:status.diagnosticOnly
    };
  }

  function splitProductionAndDiagnostics(rows,{sourceId}={}){
    const normalized=(Array.isArray(rows)?rows:[]).map(row=>normalizeEvoneObservation(row,{sourceId}));
    return{
      production:normalized.filter(x=>x.productionEligible),
      diagnostics:normalized,
      excluded:normalized.filter(x=>!x.productionEligible)
    };
  }

  return{classifyEvoneStatus,normalizeEvoneObservation,splitProductionAndDiagnostics};
});
