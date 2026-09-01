(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9BrowserRouting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  function osrmProvider({baseUrl='https://router.project-osrm.org',fetchImpl,defaultTimeoutMs=6000}={}){
    const f=fetchImpl||(typeof fetch==='function'?fetch.bind(globalThis):null);
    if(!f)throw new Error('fetch is required for OSRM routing');
    return async function route({origin,destination,stationId,signal,timeoutMs}={}){
      const oLat=num(origin?.lat??origin?.latitude),oLon=num(origin?.lon??origin?.longitude),dLat=num(destination?.lat),dLon=num(destination?.lon);
      if([oLat,oLon,dLat,dLon].some(v=>v==null))throw new Error(`invalid route coordinates for ${stationId||'station'}`);
      const url=`${baseUrl.replace(/\/$/,'')}/route/v1/driving/${oLon},${oLat};${dLon},${dLat}?overview=false&steps=false&alternatives=false`;
      const controller=typeof AbortController==='function'?new AbortController():null;
      const limit=Math.max(250,Number(timeoutMs)||Number(defaultTimeoutMs)||6000);
      let timer=null,onAbort=null;
      if(controller){
        if(signal?.aborted)controller.abort(signal.reason);
        else if(signal?.addEventListener){onAbort=()=>controller.abort(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}
        timer=setTimeout(()=>controller.abort(new Error('routing_request_timeout')),limit);
      }
      try{
        const response=await f(url,{cache:'no-store',...(controller?{signal:controller.signal}:{})});
        if(!response.ok)throw new Error(`OSRM ${response.status}`);
        const json=await response.json(),route=json?.routes?.[0];if(!route)throw new Error(`OSRM no route for ${stationId||'station'}`);
        return{distanceMeters:route.distance,durationSeconds:route.duration,provider:'osrm-public'};
      }catch(err){
        if(controller?.signal?.aborted){const reason=String(controller.signal.reason?.message||controller.signal.reason||'');throw new Error(reason.includes('routing_request_timeout')?'routing_request_timeout':'routing_aborted');}
        throw err;
      }finally{if(timer)clearTimeout(timer);if(onAbort&&signal?.removeEventListener)signal.removeEventListener('abort',onAbort);}
    };
  }
  return{osrmProvider};
});
