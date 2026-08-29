(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9OfferEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const uniq=values=>[...new Set((values||[]).filter(Boolean))];
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const country=v=>text(v).toUpperCase();

  function stable(value){
    if(Array.isArray(value))return value.map(stable);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
    return value;
  }
  function stableStringify(value){return JSON.stringify(stable(value));}

  function providerId(value){
    const raw=typeof value==='object'?(value?.id||value?.name):value;
    const n=norm(raw);
    if(!n)return'unknown';
    if(n.includes('electroverse'))return'electroverse';
    if(n==='electra'||n.startsWith('electra-'))return'electra';
    if(n.includes('ionity'))return'ionity';
    if(n.includes('fastned'))return'fastned';
    if(n.includes('powerdot'))return'powerdot';
    if(n.includes('atlante'))return'atlante';
    if(n.includes('tesla'))return'tesla';
    return n;
  }

  function normalizedCountries(offer){
    const values=[];
    for(const c of offer?.countries||[])values.push(country(c));
    for(const c of Object.keys(offer?.ratesByCountry||{}))values.push(country(c));
    return uniq(values.filter(Boolean));
  }

  function materializeOffer(raw,countryCode){
    const offer=clone(raw)||{},cc=country(countryCode||offer.countryCode),countries=normalizedCountries(offer);
    if(cc&&countries.length&&!countries.includes('*')&&!countries.includes(cc))return null;
    if(cc&&offer.ratesByCountry&&offer.ratesByCountry[cc])offer.pricing={...(offer.pricing||{}),...clone(offer.ratesByCountry[cc])};
    if(cc)offer.countryCode=cc;
    return offer;
  }

  function semanticKey(raw,countryCode){
    const offer=materializeOffer(raw,countryCode)||clone(raw)||{};
    const cc=country(countryCode||offer.countryCode);
    if(text(offer.equivalenceKey))return `explicit|${text(offer.equivalenceKey)}|${cc}`;
    const subscriptionId=text(offer.subscriptionId);
    const connectorKinds=uniq((offer.connectorKinds||[]).map(v=>text(v).toUpperCase())).sort();
    const operatorIds=uniq((offer.operatorIds||[]).map(providerId)).sort();
    if(subscriptionId)return ['subscription',providerId(offer.provider),subscriptionId,connectorKinds.join(','),cc].join('|');
    const discriminator=text(offer.tariffId||offer.planId||offer.pricingModelId);
    return [
      'offer',text(offer.kind)||'unknown',providerId(offer.provider),operatorIds.join(','),connectorKinds.join(','),
      discriminator,stableStringify(offer.pricing||{}),cc
    ].join('|');
  }

  function provenanceEntry(offer){
    return {
      sourceId:text(offer?.sourceId)||'unknown',
      offerId:text(offer?.id||offer?.offerId)||null,
      priority:number(offer?.priority)??0
    };
  }

  function rankOf(offer){return{score:number(offer?.priority)??0,sourceId:text(offer?.sourceId)||'unknown'};}
  function rankWins(next,current){if(!current)return true;if(next.score!==current.score)return next.score>current.score;return next.sourceId.localeCompare(current.sourceId)<0;}

  function mergeEquivalentOffers(current,next){
    const currentRank=rankOf(current),nextRank=rankOf(next),winner=rankWins(nextRank,currentRank)?clone(next):clone(current),loser=winner===next?current:next;
    const provenance=[...(current?.provenance||[]),provenanceEntry(current),...(next?.provenance||[]),provenanceEntry(next)];
    const uniqueProv=new Map();
    for(const p of provenance){const key=`${text(p.sourceId)}|${text(p.offerId)}|${number(p.priority)??0}`;uniqueProv.set(key,{sourceId:text(p.sourceId)||'unknown',offerId:text(p.offerId)||null,priority:number(p.priority)??0});}
    winner.provenance=[...uniqueProv.values()].sort((a,b)=>`${a.sourceId}|${a.offerId}`.localeCompare(`${b.sourceId}|${b.offerId}`));
    winner.aliases=uniq([...(current?.aliases||[]),text(current?.id||current?.offerId),...(next?.aliases||[]),text(next?.id||next?.offerId)]).sort();
    winner.countries=uniq([...normalizedCountries(current),...normalizedCountries(next)]).sort();
    winner.operatorIds=uniq([...(current?.operatorIds||[]),...(next?.operatorIds||[])].map(providerId)).sort();
    winner.connectorKinds=uniq([...(current?.connectorKinds||[]),...(next?.connectorKinds||[])].map(v=>text(v).toUpperCase())).sort();
    if(loser?.metadata||winner?.metadata)winner.metadata={...(clone(loser?.metadata)||{}),...(clone(winner?.metadata)||{})};
    return winner;
  }

  function dedupeOffers(offers,{countryCode}={}){
    const groups=new Map();
    for(const raw of offers||[]){
      const offer=materializeOffer(raw,countryCode);if(!offer)continue;
      const key=semanticKey(offer,countryCode);
      const current=groups.get(key);
      if(!current){const first=clone(offer);first.provenance=uniq([...(first.provenance||[]).map(p=>stableStringify(p)),stableStringify(provenanceEntry(first))]).map(s=>JSON.parse(s));first.aliases=uniq([...(first.aliases||[]),text(first.id||first.offerId)]).sort();groups.set(key,first);}
      else groups.set(key,mergeEquivalentOffers(current,offer));
    }
    return [...groups.values()].sort((a,b)=>semanticKey(a,countryCode).localeCompare(semanticKey(b,countryCode)));
  }

  function mergeStationOffers(station,incomingOffers,{countryCode}={}){
    const out=clone(station)||{};
    out.offers=dedupeOffers([...(out.offers||[]),...(incomingOffers||[])],{countryCode:countryCode||out.countryCode});
    return out;
  }

  function deriveSubscriptionOptions(stations,filters={}){
    const map=new Map();
    for(const station of stations||[]){
      const stationCountry=country(station?.countryCode);
      for(const offer of station?.offers||[]){
        if(!text(offer?.subscriptionId))continue;
        const id=text(offer.subscriptionId),provider=providerId(offer.provider),key=`${provider}|${id}`;
        const row=map.get(key)||{
          id,providerId:provider,provider:text(offer.provider)||provider,label:text(offer.label||offer.name||offer.subscriptionName)||id,
          countries:[],globalCoverage:false,countryCount:0,operatorIds:[],sourceIds:[],stationCount:0,stationIds:[]
        };
        const countries=normalizedCountries(offer);
        if(countries.includes('*'))row.globalCoverage=true;
        row.countries=uniq([...row.countries,...countries.filter(c=>c!=='*'),...(stationCountry?[stationCountry]:[])]).sort();
        const coveredOperators=(offer.operatorIds||[]).length?(offer.operatorIds||[]).map(providerId):[providerId(station?.physicalOperator)];
        row.operatorIds=uniq([...row.operatorIds,...coveredOperators]).filter(v=>v&&v!=='unknown').sort();
        row.sourceIds=uniq([...row.sourceIds,text(offer.sourceId)]).filter(Boolean).sort();
        if(station?.id&&!row.stationIds.includes(station.id)){row.stationIds.push(station.id);row.stationCount++;}
        row.countryCount=row.globalCoverage?null:row.countries.length;
        map.set(key,row);
      }
    }
    let rows=[...map.values()];
    const min=number(filters.minCountries),max=number(filters.maxCountries),wanted=(filters.countryCodes||[]).map(country).filter(Boolean),mode=filters.coverageMode==='all'?'all':'any';
    const providers=(filters.providerIds||[]).map(providerId),operators=(filters.operatorIds||[]).map(providerId);
    rows=rows.filter(row=>{
      const score=row.globalCoverage?Infinity:row.countries.length;
      if(min!=null&&score<min)return false;
      if(max!=null&&score>max)return false;
      if(providers.length&&!providers.includes(row.providerId))return false;
      if(operators.length&&!operators.some(id=>row.operatorIds.includes(id)))return false;
      if(wanted.length&&!row.globalCoverage){const matches=wanted.map(c=>row.countries.includes(c));if(mode==='all'&&!matches.every(Boolean))return false;if(mode==='any'&&!matches.some(Boolean))return false;}
      return true;
    });
    return rows.sort((a,b)=>{
      if(a.globalCoverage!==b.globalCoverage)return a.globalCoverage?-1:1;
      const ca=a.countryCount??Infinity,cb=b.countryCount??Infinity;if(ca!==cb)return cb-ca;
      return `${a.providerId}|${a.label}|${a.id}`.localeCompare(`${b.providerId}|${b.label}|${b.id}`);
    });
  }

  function eligibleOffers(station,selectedSubscriptions=[],options={}){
    const selected=new Set((selectedSubscriptions||[]).map(text));
    return dedupeOffers(station?.offers||[],{countryCode:options.countryCode||station?.countryCode}).filter(o=>!o.subscriptionId||selected.has(text(o.subscriptionId)));
  }

  return{dedupeOffers,mergeStationOffers,deriveSubscriptionOptions,eligibleOffers,materializeOffer,semanticKey,normalizedCountries,providerId};
});
