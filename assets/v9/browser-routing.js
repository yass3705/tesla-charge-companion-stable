(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9BrowserRouting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  function osrmProvider({baseUrl='https://router.project-osrm.org',fetchImpl}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);
    if(!f)throw new Error('fetch is required for OSRM routing');
    return async function route({origin,destination,stationId}){
      const oLat=num(origin?.lat??origin?.latitude),oLon=num(origin?.lon??origin?.longitude),dLat=num(destination?.lat),dLon=num(destination?.lon);
      if([oLat,oLon,dLat,dLon].some(v=>v==null))throw new Error(`invalid route coordinates for ${stationId||'station'}`);
      const url=`${baseUrl.replace(/\/$/,'')}/route/v1/driving/${oLon},${oLat};${dLon},${dLat}?overview=false&steps=false&alternatives=false`;
      const response=await f(url,{cache:'no-store'});if(!response.ok)throw new Error(`OSRM ${response.status}`);
      const json=await response.json(),route=json?.routes?.[0];if(!route)throw new Error(`OSRM no route for ${stationId||'station'}`);
      return{distanceMeters:route.distance,durationSeconds:route.duration,provider:'osrm-public'};
    };
  }
  return{osrmProvider};
});
