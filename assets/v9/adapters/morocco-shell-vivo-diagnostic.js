(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoShellVivoDiagnostic=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();

  function normalizeShellVivoDiagnostic(report,{sourceId='morocco-shell-vivo-diagnostic'}={}){
    const station=report?.station||report?.station_candidate||{};
    const modeling=report?.modeling||{};
    const coords=station?.shell_directory_coordinates||station?.coordinates||{};
    const latitude=Number.isFinite(coords?.lat)?coords.lat:(Number.isFinite(station?.latitude_candidate)?station.latitude_candidate:null);
    const longitude=Number.isFinite(coords?.lng)?coords.lng:(Number.isFinite(station?.longitude_candidate)?station.longitude_candidate:null);
    const accessNetwork=text(station?.app_source_access_network||modeling?.access_network||station?.network_brand)||null;
    const siteBrand=text(station?.site_brand||modeling?.site_brand)||'Shell';

    return{
      sourceStationId:null,
      canonicalId:null,
      countryCode:'MA',
      name:text(station?.canonical_name||station?.name)||null,
      latitude,
      longitude,
      physicalOperator:null,
      networkBrand:text(station?.network_brand||modeling?.network_brand)||accessNetwork,
      access:{
        siteBrand,
        appSource:null,
        accessNetwork
      },
      offers:[],
      status:{
        state:'unknown',
        nativeState:null,
        sourceId,
        statusSource:null
      },
      productionEligible:false,
      diagnosticOnly:true,
      diagnosticEvidence:{
        operatorCandidate:text(station?.operator_cpo_candidate)||null,
        connectorPowerCandidate:report?.validated_or_candidate_shape?.connector_power_candidate||null,
        secondaryFreeEvidence:report?.validated_or_candidate_shape?.secondary_free_evidence===true,
        reason:text(report?.production_recommendation?.reason||report?.assessment?.reason)||null
      }
    };
  }

  return{normalizeShellVivoDiagnostic};
});
