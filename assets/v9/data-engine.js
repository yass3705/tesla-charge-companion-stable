(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9DataEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const uniq=values=>[...new Set((values||[]).filter(Boolean))];
  const number=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};

  function operatorId(value){
    const raw=typeof value==='object'?(value?.id||value?.name):value;
    const n=norm(raw);
    if(!n)return 'unknown';
    if(n==='tesla'||n.startsWith('tesla-'))return'tesla';
    if(n.includes('ionity'))return'ionity';
    if(n.includes('fastned'))return'fastned';
    if(n.includes('powerdot'))return'powerdot';
    if(n.includes('atlante'))return'atlante';
    if(n.includes('lidl'))return'lidl';
    return n;
  }

  function distanceKm(origin,station){
    const a=number(origin?.lat??origin?.latitude),b=number(origin?.lon??origin?.longitude),c=number(station?.latitude),d=number(station?.longitude);
    if([a,b,c,d].some(v=>v==null))return Infinity;
    const r=Math.PI/180,R=6371,p1=a*r,p2=c*r,dp=(c-a)*r,dl=(d-b)*r;
    const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }

  function sourceApplies(source,query){
    if(source?.active===false)return false;
    const countries=Array.isArray(source?.countries)?source.countries:['*'];
    const country=text(query?.countryCode).toUpperCase();
    if(!country||countries.includes('*'))return true;
    return countries.map(x=>text(x).toUpperCase()).includes(country);
  }

  function priorityFor(source,family,fragment){
    const override=number(fragment?.fieldPriority?.[family]);
    if(override!=null)return override;
    const p=source?.priority;
    if(typeof p==='number')return p;
    return number(p?.[family])??number(p?.default)??50;
  }

  function rank(source,family,fragment){return{score:priorityFor(source,family,fragment),sourceId:text(source?.id)||'unknown'};}
  function rankWins(next,current){
    if(!current)return true;
    if(next.score!==current.score)return next.score>current.score;
    return next.sourceId.localeCompare(current.sourceId)<0;
  }

  const FAMILY_FIELDS={
    identity:['countryCode','name','address','latitude','longitude','physicalOperator','networkBrand'],
    connectors:['evses'],
    access:['access'],
    status:['status']
  };

  function fragmentKeys(fragment,source){
    const keys=[];
    if(fragment?.canonicalId)keys.push(`canonical:${text(fragment.canonicalId)}`);
    for(const a of fragment?.aliases||[])if(text(a))keys.push(`alias:${text(a)}`);
    const sourceStationId=text(fragment?.sourceStationId||fragment?.id);
    if(sourceStationId)keys.push(`source:${text(source?.id)}:${sourceStationId}`);
    return uniq(keys);
  }

  function deterministicFragmentKey(item){
    const f=item.fragment,s=item.source;
    return [
      String(9999-priorityFor(s,'identity',f)).padStart(4,'0'),
      text(s?.id),text(f?.canonicalId),text(f?.id),text(f?.name),String(f?.latitude??''),String(f?.longitude??'')
    ].join('|');
  }

  function newEntity(fragment,source){
    const baseId=text(fragment?.canonicalId)||`station:${text(source?.id)}:${text(fragment?.sourceStationId||fragment?.id||norm(fragment?.name)||'unknown')}`;
    return{
      id:baseId,
      aliases:[],countryCode:'',name:'',address:'',latitude:null,longitude:null,
      physicalOperator:{id:'unknown',name:'Unknown'},networkBrand:'',evses:[],access:null,status:null,
      offers:[],provenance:[],
      _fieldRanks:{},_offerRanks:{},_keys:new Set()
    };
  }

  function normalizeOperator(value){
    const name=text(typeof value==='object'?value?.name:value)||'Unknown';
    return{id:operatorId(typeof value==='object'?(value?.id||name):name),name};
  }

  function applyFamily(entity,fragment,source,family){
    const nextRank=rank(source,family,fragment);
    const current=entity._fieldRanks[family];
    if(!rankWins(nextRank,current))return;
    for(const field of FAMILY_FIELDS[family]||[]){
      if(fragment[field]===undefined||fragment[field]===null)continue;
      if(field==='physicalOperator')entity[field]=normalizeOperator(fragment[field]);
      else entity[field]=clone(fragment[field]);
    }
    entity._fieldRanks[family]=nextRank;
  }

  function offerSemanticKey(offer,countryCode){
    return [text(offer?.id)||text(offer?.offerId)||'offer',text(offer?.kind)||'unknown',text(offer?.subscriptionId),operatorId(offer?.provider),text(countryCode).toUpperCase()].join('|');
  }

  function materializeOffer(offer,countryCode){
    const out=clone(offer)||{};
    const country=text(countryCode).toUpperCase();
    const countries=(out.countries||[]).map(x=>text(x).toUpperCase());
    if(countries.length&&!countries.includes('*')&&!countries.includes(country))return null;
    if(out.ratesByCountry&&out.ratesByCountry[country])out.pricing={...(out.pricing||{}),...clone(out.ratesByCountry[country])};
    out.countryCode=country;
    return out;
  }

  function mergeOffers(entity,fragment,source){
    for(const raw of fragment?.offers||[]){
      const offer=materializeOffer(raw,entity.countryCode||fragment?.countryCode);
      if(!offer)continue;
      offer.sourceId=offer.sourceId||source.id;
      const key=offerSemanticKey(offer,entity.countryCode||fragment?.countryCode);
      const nextRank={score:number(offer.priority)??priorityFor(source,'tariff',fragment),sourceId:text(source.id)};
      const current=entity._offerRanks[key];
      if(current&&!rankWins(nextRank,current))continue;
      const index=entity.offers.findIndex(o=>offerSemanticKey(o,entity.countryCode)===key);
      if(index>=0)entity.offers[index]=offer;else entity.offers.push(offer);
      entity._offerRanks[key]=nextRank;
    }
  }

  function mergeFragment(entity,fragment,source){
    for(const family of Object.keys(FAMILY_FIELDS))applyFamily(entity,fragment,source,family);
    const aliases=fragmentKeys(fragment,source);
    entity.aliases=uniq([...entity.aliases,...aliases]);
    for(const k of aliases)entity._keys.add(k);
    entity.provenance.push({sourceId:source.id,sourceStationId:text(fragment?.sourceStationId||fragment?.id),updatedAt:fragment?.updatedAt||null});
    mergeOffers(entity,fragment,source);
    return entity;
  }

  function publicEntity(entity){
    const out={...entity};
    delete out._fieldRanks;delete out._offerRanks;delete out._keys;
    out.aliases=uniq(out.aliases).sort();
    out.provenance=out.provenance.slice().sort((a,b)=>`${a.sourceId}|${a.sourceStationId}`.localeCompare(`${b.sourceId}|${b.sourceStationId}`));
    out.offers=out.offers.slice().sort((a,b)=>offerSemanticKey(a,out.countryCode).localeCompare(offerSemanticKey(b,out.countryCode)));
    return out;
  }

  function resolveEntities(items){
    const ordered=items.slice().sort((a,b)=>deterministicFragmentKey(a).localeCompare(deterministicFragmentKey(b)));
    const entities=[],keyIndex=new Map();
    for(const item of ordered){
      const keys=fragmentKeys(item.fragment,item.source);
      let entity=null;
      for(const key of keys){if(keyIndex.has(key)){entity=keyIndex.get(key);break;}}
      if(!entity){entity=newEntity(item.fragment,item.source);entities.push(entity);}
      mergeFragment(entity,item.fragment,item.source);
      for(const key of entity._keys)keyIndex.set(key,entity);
    }
    return entities.map(publicEntity).sort((a,b)=>a.id.localeCompare(b.id));
  }

  function stationMatchesFilters(station,filters={}){
    if(filters.status&&filters.status!=='all'&&text(station?.status?.state)!==text(filters.status))return false;
    const selectedOperators=(filters.operatorIds||[]).map(operatorId);
    if(selectedOperators.length&&!selectedOperators.includes(operatorId(station?.physicalOperator)))return false;
    const minPower=number(filters.minPowerKw),maxPower=number(filters.maxPowerKw);
    if(minPower!=null||maxPower!=null){
      const powers=[];
      for(const evse of station?.evses||[])for(const c of evse?.connectors||[])if(number(c?.powerKw)!=null)powers.push(number(c.powerKw));
      if(!powers.length)return false;
      if(minPower!=null&&!powers.some(p=>p>=minPower))return false;
      if(maxPower!=null&&!powers.some(p=>p<=maxPower))return false;
    }
    return true;
  }

  function deriveOperators(stations){
    const map=new Map();
    for(const st of stations||[]){
      const op=normalizeOperator(st?.physicalOperator);
      const row=map.get(op.id)||{id:op.id,name:op.name,count:0};row.count++;if(row.name==='Unknown'&&op.name!=='Unknown')row.name=op.name;map.set(op.id,row);
    }
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }

  function eligibleOffers(station,selectedSubscriptions=[]){
    const selected=new Set((selectedSubscriptions||[]).map(text));
    return (station?.offers||[]).filter(o=>!o.subscriptionId||selected.has(text(o.subscriptionId)));
  }

  function selectRoutingCandidates(stations,{origin,budget=80,perOperatorFloor=2}={}){
    const sorted=(stations||[]).map(st=>({st,d:distanceKm(origin,st)})).sort((a,b)=>a.d-b.d||a.st.id.localeCompare(b.st.id));
    const byOperator=new Map();
    for(const row of sorted){const id=operatorId(row.st.physicalOperator);if(!byOperator.has(id))byOperator.set(id,[]);byOperator.get(id).push(row);}
    const chosen=new Map();
    for(const rows of byOperator.values())for(const row of rows.slice(0,Math.max(1,perOperatorFloor)))chosen.set(row.st.id,row.st);
    const target=Math.max(Number(budget)||0,chosen.size);
    for(const row of sorted){if(chosen.size>=target)break;chosen.set(row.st.id,row.st);}
    return [...chosen.values()].sort((a,b)=>distanceKm(origin,a)-distanceKm(origin,b)||a.id.localeCompare(b.id));
  }

  function createEngine({registry={sources:[]},loaders={}}={}){
    const sources=(registry.sources||[]).map(clone);
    const loaderMap=new Map(Object.entries(loaders||{}));
    function registerLoader(sourceId,loader){if(typeof loader!=='function')throw new Error('loader must be a function');loaderMap.set(sourceId,loader);return api;}
    async function queryArea(query={}){
      const applicable=sources.filter(s=>sourceApplies(s,query));
      const settled=await Promise.allSettled(applicable.map(async source=>{
        const loader=loaderMap.get(source.id);
        if(typeof loader!=='function')return{source,fragments:[],skipped:'loader_missing'};
        const result=await loader(query,clone(source));
        const fragments=Array.isArray(result)?result:Array.isArray(result?.stations)?result.stations:[];
        return{source,fragments};
      }));
      const items=[],diagnostics={sources:{},errors:[]};
      settled.forEach((entry,index)=>{
        const source=applicable[index];
        if(entry.status==='rejected'){diagnostics.errors.push({sourceId:source.id,message:text(entry.reason?.message||entry.reason)});diagnostics.sources[source.id]={loaded:false,count:0};return;}
        const {fragments,skipped}=entry.value;diagnostics.sources[source.id]={loaded:!skipped,count:fragments.length,skipped:skipped||null};
        for(const fragment of fragments)items.push({source,fragment});
      });
      const merged=resolveEntities(items);
      const inRadius=merged.filter(st=>!query.origin||!Number.isFinite(Number(query.radiusKm))||distanceKm(query.origin,st)<=Number(query.radiusKm)+1e-9);
      const filtered=inRadius.filter(st=>stationMatchesFilters(st,query.filters||{}));
      const operators=deriveOperators(filtered);
      const routingCandidates=selectRoutingCandidates(filtered,{origin:query.origin,budget:query.routingBudget??80,perOperatorFloor:query.perOperatorFloor??2});
      return{
        query:clone(query),stations:filtered,operators,routingCandidates,
        freshness:{generatedAt:new Date().toISOString()},
        diagnostics:{...diagnostics,fragmentCount:items.length,mergedStationCount:merged.length,inRadiusCount:inRadius.length,filteredCount:filtered.length,routingCandidateCount:routingCandidates.length}
      };
    }
    const api={queryArea,registerLoader,deriveOperators,eligibleOffers,selectRoutingCandidates,sources:()=>clone(sources)};
    return api;
  }

  return{createEngine,resolveEntities,deriveOperators,eligibleOffers,selectRoutingCandidates,materializeOffer,operatorId,distanceKm,sourceApplies};
});
