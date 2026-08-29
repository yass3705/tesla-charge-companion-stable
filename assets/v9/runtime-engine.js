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

  const text=v=>String(v==null?'':v).trim();
  const country=v=>text(v).toUpperCase();
  const uniq=values=>[...new Set((values||[]).filter(Boolean))];
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};

  function coverageIndex(registry){
    const map=new Map();
    for(const raw of registry?.subscriptionCoverage||[]){
      const id=text(raw.subscriptionId||raw.id);if(!id)continue;
      map.set(id,{
        countries:uniq((raw.countries||[]).map(country)),
        globalCoverage:raw.globalCoverage===true||(raw.countries||[]).includes('*'),
        operatorIds:uniq((raw.operatorIds||[]).map(OfferEngine.providerId)),
        evidenceSources:uniq(raw.evidenceSources||[])
      });
    }
    return map;
  }

  function applyCoverage(rows,index){
    return (rows||[]).map(row=>{
      const coverage=index.get(text(row.id));if(!coverage)return row;
      const globalCoverage=row.globalCoverage===true||coverage.globalCoverage===true;
      const countries=uniq([...(row.countries||[]),...coverage.countries.filter(c=>c!=='*')]).sort();
      return{
        ...row,
        countries,
        globalCoverage,
        countryCount:globalCoverage?null:countries.length,
        operatorIds:uniq([...(row.operatorIds||[]),...coverage.operatorIds]).sort(),
        coverageEvidenceSources:coverage.evidenceSources
      };
    });
  }

  function filterSubscriptions(rows,filters={}){
    const min=number(filters.minCountries),max=number(filters.maxCountries);
    const wanted=(filters.countryCodes||[]).map(country).filter(Boolean),mode=filters.coverageMode==='all'?'all':'any';
    const providers=(filters.providerIds||[]).map(OfferEngine.providerId),operators=(filters.operatorIds||[]).map(OfferEngine.providerId);
    return (rows||[]).filter(row=>{
      const score=row.globalCoverage?Infinity:(row.countries||[]).length;
      if(min!=null&&score<min)return false;
      if(max!=null&&score>max)return false;
      if(providers.length&&!providers.includes(row.providerId))return false;
      if(operators.length&&!operators.some(id=>(row.operatorIds||[]).includes(id)))return false;
      if(wanted.length&&!row.globalCoverage){const matches=wanted.map(c=>(row.countries||[]).includes(c));if(mode==='all'&&!matches.every(Boolean))return false;if(mode==='any'&&!matches.some(Boolean))return false;}
      return true;
    }).sort((a,b)=>{
      if(a.globalCoverage!==b.globalCoverage)return a.globalCoverage?-1:1;
      const ca=a.countryCount??Infinity,cb=b.countryCount??Infinity;if(ca!==cb)return cb-ca;
      return `${a.providerId}|${a.label}|${a.id}`.localeCompare(`${b.providerId}|${b.label}|${b.id}`);
    });
  }

  function createEngine(config={}){
    const base=DataEngine.createEngine(config),coverage=coverageIndex(config.registry||{});

    function deriveSubscriptionOptions(stations,filters={}){
      const local=OfferEngine.deriveSubscriptionOptions(stations,{});
      return filterSubscriptions(applyCoverage(local,coverage),filters);
    }

    async function queryArea(query={}){
      const area=await base.queryArea(query);
      const stations=(area.stations||[]).map(station=>OfferEngine.mergeStationOffers(station,[],{countryCode:station.countryCode||query.countryCode}));
      const stationById=new Map(stations.map(st=>[st.id,st]));
      const routingCandidates=(area.routingCandidates||[]).map(st=>stationById.get(st.id)||st);
      const subscriptions=deriveSubscriptionOptions(stations,query.subscriptionFilters||{});
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
      deriveSubscriptionOptions,
      dedupeOffers:OfferEngine.dedupeOffers,
      mergeStationOffers:OfferEngine.mergeStationOffers
    };
  }

  return{createEngine,applyCoverage,filterSubscriptions};
});
