(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoNonProduction=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const EVONE_ALLOWED=new Set(['Available','Occupied','Charging']);
  const EVONE_EXCLUDED=new Set(['Faulted','Offline','Unknown','Unavailable']);
  function evoneStatusClass(value){const s=text(value);if(EVONE_ALLOWED.has(s))return'production';if(EVONE_EXCLUDED.has(s))return'diagnostic_only';return'excluded_unmapped';}
  function mapEvoneState(value){const s=text(value);return s==='Available'?'available':s==='Occupied'||s==='Charging'?'occupied':'unknown';}
  function hasNativeCpoStatus(base){const state=text(base?.status?.state);const src=text(base?.status?.statusSource);return !!src&&src!=='EVOne / EVPlug roaming status'&&state&&state!=='unknown';}
  function applyEvoneOverlay(base,row){
    if(!base||!row||!EVONE_ALLOWED.has(text(row.status)))return null;
    const out=clone(base),baseAccess=clone(base.access)||{};
    out.physicalOperator=clone(base.physicalOperator);
    out.access={...baseAccess,siteBrand:baseAccess.siteBrand??(row.site_brand==null?null:text(row.site_brand)),appSource:'EVOne',accessNetwork:'EVPlug',emsp:'EVPlug'};
    if(!hasNativeCpoStatus(base))out.status={state:mapEvoneState(row.status),nativeState:text(row.status),sourceId:'morocco-evone-evplug-overlay',statusSource:'EVOne / EVPlug roaming status'};
    if(Array.isArray(row.offers)&&row.offers.length)out.offers=[...(out.offers||[]),...row.offers.map(o=>({...clone(o),kind:o.kind||'emsp',metadata:{...(clone(o.metadata)||{}),tariffChannel:'EVOne / EVPlug eMSP'}}))];
    return out;
  }
  function shellVivoDiagnostic(report){
    const c=report?.station_candidate||report?.station||{},m=report?.modeling||{},coords=c.shell_directory_coordinates||c.coordinates||{};
    return{countryCode:'MA',name:c.name||c.canonical_name||null,latitude:coords.lat??c.latitude_candidate??null,longitude:coords.lng??c.longitude_candidate??null,physicalOperator:null,networkBrand:m.network_brand||c.network_brand||null,access:{siteBrand:m.site_brand||c.site_brand||'Shell',appSource:null,accessNetwork:m.access_network||c.app_source_access_network||null},offers:[],status:{state:'unknown',statusSource:null},productionEligible:false,diagnosticOnly:true,reason:report?.assessment?.reason||report?.production_recommendation?.reason||null};
  }
  return{evoneStatusClass,applyEvoneOverlay,shellVivoDiagnostic,allowedStatuses:[...EVONE_ALLOWED],excludedStatuses:[...EVONE_EXCLUDED]};
});
