(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(require('./data-engine.js'),require('./offer-engine.js'));
  }else{
    root.TCCV9RuntimeEngine=factory(root.TCCV9DataEngine,root.TCCV9OfferEngine);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(DataEngine,OfferEngine){
  'use strict';

  if(!DataEngine)throw new Error('TCC V9 data engine is required');
  if(!OfferEngine)throw new Error('TCC V9 offer engine is required');

  function createEngine(config={}){
    const base=DataEngine.createEngine(config);

    async function queryArea(query={}){
      const area=await base.queryArea(query);
      const stations=(area.stations||[]).map(station=>OfferEngine.mergeStationOffers(station,[],{countryCode:station.countryCode||query.countryCode}));
      const stationById=new Map(stations.map(st=>[st.id,st]));
      const routingCandidates=(area.routingCandidates||[]).map(st=>stationById.get(st.id)||st);
      const subscriptions=OfferEngine.deriveSubscriptionOptions(stations,query.subscriptionFilters||{});
      return{
        ...area,
        stations,
        routingCandidates,
        subscriptions,
        diagnostics:{...(area.diagnostics||{}),subscriptionOptionCount:subscriptions.length}
      };
    }

    return{
      ...base,
      queryArea,
      eligibleOffers:OfferEngine.eligibleOffers,
      deriveSubscriptionOptions:OfferEngine.deriveSubscriptionOptions,
      dedupeOffers:OfferEngine.dedupeOffers,
      mergeStationOffers:OfferEngine.mergeStationOffers
    };
  }

  return{createEngine};
});
