(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(require('./data-engine.js'),require('./offer-engine.js'),require('./session-engine.js'),require('./station-score-engine.js'),require('./routing-engine.js'));
  }else{
    root.TCCV9RuntimeEngine=factory(root.TCCV9DataEngine,root.TCCV9OfferEngine,root.TCCV9SessionEngine,root.TCCV9StationScoreEngine,root.TCCV9RoutingEngine);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(DataEngine,OfferEngine,SessionEngine,StationScoreEngine,RoutingEngine){
  'use strict';

  if(!DataEngine)throw new Error('TCC V9 data engine is required');
  if(!OfferEngine)throw new Error('TCC V9 offer engine is required');
  if(!SessionEngine)throw new Error('TCC V9 session engine is required');
  if(!StationScoreEngine)throw new Error('TCC V9 station score engine is required');
  if(!RoutingEngine)throw new Error('TCC V9 routing engine is required');

  const text=v=>String(v==null?'':v).trim();
  const country=v=>text(v).toUpperCase();
  const uniq=values=>[...new Set((values||[]).filter(Boolean))];
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};

  function coverageIndex(registry){
    const map=new Map();
    for(const raw of registry?.subscriptionCoverage||[]){
      const id=text(raw.subscriptionId||raw.id);if(!id)continue;
      map.set(id,{countries:uniq((raw.countries||[]).map(country)),globalCoverage:raw.globalCoverage===true||(raw.countries||[]).includes('*'),operatorIds:uniq((raw.operatorIds||[]).map(OfferEngine.providerId)),evidenceSources:uniq(raw.evidenceSources||[])});
    }
    return map;
  }
  function applyCoverage(rows,index){
    return (rows||[]).map(row=>{const coverage=index.get(text(row.id));if(!coverage)return row;const globalCoverage=row.globalCoverage===true||coverage.globalCoverage===true;const countries=uniq([...(row.countries||[]),...coverage.countries.filter(c=>c!=='*')]).sort();return{...row,countries,globalCoverage,countryCount:globalCoverage?null:countries.length,operatorIds:uniq([...(row.operatorIds||[]),...coverage.operatorIds]).sort(),coverageEvidenceSources:coverage.evidenceSources};});
  }
  function filterSubscriptions(rows,filters={}){
    const min=number(filters.minCountries),max=number(filters.maxCountries),wanted=(filters.countryCodes||[]).map(country).filter(Boolean),mode=filters.coverageMode==='all'?'all':'any',providers=(filters.providerIds||[]).map(OfferEngine.providerId),operators=(filters.operatorIds||[]).map(OfferEngine.providerId);
    return (rows||[]).filter(row=>{const score=row.globalCoverage?Infinity:(row.countries||[]).length;if(min!=null&&score<min)return false;if(max!=null&&score>max)return false;if(providers.length&&!providers.includes(row.providerId))return false;if(operators.length&&!operators.some(id=>(row.operatorIds||[]).includes(id)))return false;if(wanted.length&&!row.globalCoverage){const matches=wanted.map(c=>(row.countries||[]).includes(c));if(mode==='all'&&!matches.every(Boolean))return false;if(mode==='any'&&!matches.some(Boolean))return false;}return true;}).sort((a,b)=>{if(a.globalCoverage!==b.globalCoverage)return a.globalCoverage?-1:1;const ca=a.countryCount??Infinity,cb=b.countryCount??Infinity;if(ca!==cb)return cb-ca;return `${a.providerId}|${a.label}|${a.id}`.localeCompare(`${b.providerId}|${b.label}|${b.id}`);});
  }

  function createEngine(config={}){
    const base=DataEngine.createEngine(config),coverage=coverageIndex(config.registry||{}),routeProvider=config.routeProvider||null;
    function deriveSubscriptionOptions(stations,filters={}){return filterSubscriptions(applyCoverage(OfferEngine.deriveSubscriptionOptions(stations,{}),coverage),filters);}

    async function queryArea(query={}){
      const area=await base.queryArea(query);
      const stations=(area.stations||[]).map(station=>OfferEngine.mergeStationOffers(station,[],{countryCode:station.countryCode||query.countryCode}));
      const stationById=new Map(stations.map(st=>[st.id,st]));
      const routingCandidates=(area.routingCandidates||[]).map(st=>stationById.get(st.id)||st);
      const subscriptions=deriveSubscriptionOptions(stations,query.subscriptionFilters||{});
      let routeResult={byStationId:{},errors:[],routedCount:0,requestedCount:0};
      const provider=query.routeProvider||routeProvider;
      if(query.session&&provider&&query.origin){routeResult=await RoutingEngine.routeCandidates(routingCandidates,{origin:query.origin,provider,session:query.session,concurrency:query.routingConcurrency||6});}
      const routeMap={...(area.routes?.byStationId||area.routes||{}),...(query.route?.byStationId||query.route||{}),...(routeResult.byStationId||{})};
      const approachEnergyKwhByStationId=RoutingEngine.energyByStationId({byStationId:routeMap});
      let sessionEvaluations=null,stationScores=null,rankedStations=null;
      if(query.session){
        const rows=SessionEngine.evaluateArea(stations,query.session,{selectedSubscriptions:query.selectedSubscriptions||query.session.selectedSubscriptions||[],targetCurrency:query.targetCurrency||query.session.targetCurrency||'EUR',fxRates:query.fxRates||query.session.fxRates||{},sortBy:'total',approachEnergyKwhByStationId});
        sessionEvaluations=Object.fromEntries(rows.map(row=>[row.evaluation.stationId,row.evaluation]));
        const scored=StationScoreEngine.scoreArea(stations,sessionEvaluations,query.session,{route:{byStationId:routeMap},sortBy:query.sortBy||query.session.sortBy||'finalCost'});
        stationScores=Object.fromEntries(scored.map(row=>[row.score.stationId,row.score]));rankedStations=scored.map(row=>row.station);
      }
      return{...area,stations,routingCandidates,subscriptions,routes:{byStationId:routeMap},routeResult,sessionEvaluations,stationScores,rankedStations,diagnostics:{...(area.diagnostics||{}),subscriptionOptionCount:subscriptions.length,routingRequestedCount:routeResult.requestedCount,routedStationCount:routeResult.routedCount,routingErrorCount:routeResult.errors.length,sessionEvaluatedStationCount:sessionEvaluations?Object.keys(sessionEvaluations).length:0,sessionComparableStationCount:sessionEvaluations?Object.values(sessionEvaluations).filter(x=>x?.best).length:0,scoredStationCount:stationScores?Object.keys(stationScores).length:0,fullyScoredStationCount:stationScores?Object.values(stationScores).filter(x=>x?.complete?.pricing&&x?.complete?.route&&x?.complete?.charging).length:0}};
    }

    return{...base,queryArea,eligibleOffers:OfferEngine.eligibleOffers,deriveSubscriptionOptions,dedupeOffers:OfferEngine.dedupeOffers,mergeStationOffers:OfferEngine.mergeStationOffers,evaluateStation:SessionEngine.evaluateStation,evaluateArea:SessionEngine.evaluateArea,scoreStation:StationScoreEngine.scoreStation,scoreArea:StationScoreEngine.scoreArea,routeCandidates:RoutingEngine.routeCandidates};
  }
  return{createEngine,applyCoverage,filterSubscriptions};
});
