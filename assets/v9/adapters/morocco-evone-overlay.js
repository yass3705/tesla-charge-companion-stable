(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.TCCV9Adapters=root.TCCV9Adapters||{};root.TCCV9Adapters.moroccoEvoneOverlay=api;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const ALLOWED=new Set(['Available','Occupied','Charging']);
  const EXCLUDED=new Set(['Faulted','Offline','Unknown','Unavailable']);

  function productionEligibleStatus(status){return ALLOWED.has(text(status));}
  function diagnosticStatusClass(status){const s=text(status);if(ALLOWED.has(s))return'production';if(EXCLUDED.has(s))return'diagnostic_only';return'excluded_unmapped';}

  function normalizeOverlay(row,{sourceId='morocco-evone-evplug'}={}){
    if(!row)return null;
    const stationId=text(row.stationId||row.station_id||row.sourceStationId||row.id);
    const cpo=text(row.cpo_operator||row.cpoOperator);
    const status=text(row.status);
    if(!stationId||!cpo)return null;
    return{
      canonicalId:row.canonicalId||null,
      aliases:Array.isArray(row.aliases)?row.aliases.slice():[],
      sourceStationId:stationId,
      countryCode:'MA',
      physicalOperator:{name:cpo},
      access:{
        appSource:'EVOne',
        accessNetwork:'EVPlug',
        emsp:'EVPlug',
        siteBrand:row.site_brand==null?null:text(row.site_brand)
      },
      status:productionEligibleStatus(status)?{
        state:status==='Available'?'available':status==='Charging'?'occupied':'occupied',
        nativeState:status,
        sourceId,
        statusSource:'EVOne / EVPlug roaming status'
      }:null,
      offers:Array.isArray(row.offers)?row.offers.map(o=>({
        ...o,
        metadata:{...(o.metadata||{}),tariffChannel:'EVOne / EVPlug eMSP'}
      })):[],
      overlayPolicy:{
        cpoFromSourceRequired:true,
        evoneVisibilityNeverDefinesCpo:true,
        productionStatusEligible:productionEligibleStatus(status),
        diagnosticStatusClass:diagnosticStatusClass(status),
        nativeCpoStatusPreferred:true
      }
    };
  }

  function productionRows(rows){return(rows||[]).filter(r=>productionEligibleStatus(r?.status));}
  return{productionEligibleStatus,diagnosticStatusClass,normalizeOverlay,productionRows,allowedStatuses:[...ALLOWED],excludedStatuses:[...EXCLUDED]};
});
