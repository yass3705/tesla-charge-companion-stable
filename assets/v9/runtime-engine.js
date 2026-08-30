(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(require('./data-engine.js'),require('./offer-engine.js'),require('./cross-border-subscriptions.js'));
  }else{
    root.TCCV9RuntimeEngine=factory(root.TCCV9DataEngine,root.TCCV9OfferEngine,root.TCCV9CrossBorderSubscriptions);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(DataEngine,OfferEngine,CrossBorder){
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

  function mergeSubscriptionRows(rows){
    const map=new Map();
    for(const row of rows||[]){
      const key=text(row.id);if(!key)continue;
      const current=map.get(key);
      if(!current){map.set(key,{...row,countries:[...(row.countries||[])],operatorIds:[...(row.operatorIds||[])],sourceIds:[...(row.sourceIds||[])]});continue;}
      const globalCoverage=current.globalCoverage===true||row.globalCoverage===true;
      const countries=uniq([...(current.countries||[]),...(row.countries||[])]).sort();
      map.set(key,{...current,...row,countries,globalCoverage,countryCount:globalCoverage?null:countries.length,operatorIds:uniq([...(current.operatorIds||[]),...(row.operatorIds||[])]).sort(),sourceIds:uniq([...(current.sourceIds||[]),...(row.sourceIds||[])]).sort()});
    }
    return[...map.values()];
  }

  function exactStationOverride(query,station,subscriptionId){
    const all=query?.subscriptionStationPrices||{};
    const byStation=all[station?.id]||all[station?.canonicalId]||{};
    return byStation?.[subscriptionId]||null;
  }

  function applySelectedSubscriptions(station,selectedSubscriptions=[],crossBorderConfig={},query={}){
    if(!CrossBorder||!crossBorderConfig?.policy||!(selectedSubscriptions||[]).length)return station;
    let out={...station,offers:[...(station?.offers||[])]};
    const policyById=new Map((crossBorderConfig.policy.subscriptions||[]).map(s=>[text(s.id),s]));
    for(const id of selectedSubscriptions||[]){
      const subscription=policyById.get(text(id));if(!subscription)continue;
      const override=exactStationOverride(query,station,id);
      const resolved=CrossBorder.resolve({subscriptionId:id,countryCode:station.countryCode||query.countryCode,physicalOperator:station.physicalOperator,exactStationPrice:override?.pricePerKwh,exactStationCurrency:override?.currency},crossBorderConfig);
      const offer=CrossBorder.toOffer(resolved,subscription,station);if(offer)out=OfferEngine.mergeStationOffers(out,[offer],{countryCode:station.countryCode||query.countryCode});
    }
    out.eligibleOffers=OfferEngine.eligibleOffers(out,selectedSubscriptions,{countryCode:out.countryCode||query.countryCode});
    out.rankableOffers=(out.eligibleOffers||[]).filter(o=>o?.metadata?.rankable!==false);
    return out;
  }

  function createEngine(config={}){
    const base=DataEngine.createEngine(config),coverage=coverageIndex(config.registry||{}),crossBorderConfig=config.crossBorderPricing||{};

    function deriveSubscriptionOptions(stations,filters={}){
      const local=OfferEngine.deriveSubscriptionOptions(stations,{});
      const cross=CrossBorder&&crossBorderConfig?.policy?CrossBorder.subscriptionOptions(crossBorderConfig):[];
      return filterSubscriptions(applyCoverage(mergeSubscriptionRows([...local,...cross]),coverage),filters);
    }

    async function queryArea(query={}){
      const area=await base.queryArea(query);
      const selected=uniq((query.selectedSubscriptions||[]).map(text));
      const stations=(area.stations||[]).map(station=>{
        const merged=OfferEngine.mergeStationOffers(station,[],{countryCode:station.countryCode||query.countryCode});
        return applySelectedSubscriptions(merged,selected,crossBorderConfig,query);
      });
      const stationById=new Map(stations.map(st=>[st.id,st]));
      const routingCandidates=(area.routingCandidates||[]).map(st=>stationById.get(st.id)||st);
      const subscriptions=deriveSubscriptionOptions(stations,query.subscriptionFilters||{});
      return{
        ...area,
        stations,
        routingCandidates,
        subscriptions,
        selectedSubscriptions:selected,
        diagnostics:{...(area.diagnostics||{}),subscriptionOptionCount:subscriptions.length,selectedSubscriptionCount:selected.length,crossBorderPricingEnabled:!!(CrossBorder&&crossBorderConfig?.policy)}
      };
    }

    return{
      ...base,
      queryArea,
      eligibleOffers:OfferEngine.eligibleOffers,
      deriveSubscriptionOptions,
      applySelectedSubscriptions:(station,selected,query={})=>applySelectedSubscriptions(station,selected,crossBorderConfig,query),
      dedupeOffers:OfferEngine.dedupeOffers,
      mergeStationOffers:OfferEngine.mergeStationOffers
    };
  }

  return{createEngine,applyCoverage,filterSubscriptions,mergeSubscriptionRows,applySelectedSubscriptions};
});
