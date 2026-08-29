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
  const number=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};

  function operatorId(value){
    const raw=typeof value==='object'?(value?.id||value?.name):value;
    const n=norm(raw);
    if(!n)return'unknown';
    if(n==='tesla'||n.startsWith('tesla-'))return'tesla';
    if(n.includes('ionity'))return'ionity';
    if(n.includes('fastned'))return'fastned';
    if(n.includes('powerdot'))return'powerdot';
    if(n.includes('atlante'))return'atlante';
    if(n.includes('lidl'))return'lidl';
    if(n.includes('electroverse'))return'electroverse';
    if(n==='electra'||n.startsWith('electra-'))return'electra';
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
    const countries=Array.isArray(source?.countries)?source.countries:['*'],country=text(query?.countryCode).toUpperCase();
    if(!country||countries.includes('*'))return true;
    return countries.map(x=>text(x).toUpperCase()).includes(country);
  }

  function priorityFor(source,family,fragment){
    const override=number(fragment?.fieldPriority?.[family]);if(override!=null)return override;
    const p=source?.priority;if(typeof p==='number')return p;
    return number(p?.[family])??number(p?.default)??50;
  }
  function rank(source,family,fragment){return{score:priorityFor(source,family,fragment),sourceId:text(source?.id)||'unknown'};}
  function rankWins(next,current){if(!current)return true;if(next.score!==current.score)return next.score>current.score;return next.sourceId.localeCompare(current.sourceId)<0;}

  const FAMILY_FIELDS={identity:['countryCode','name','address','latitude','longitude','physicalOperator','networkBrand'],connectors:['evses'],access:['access'],status:['status']};

  function fragmentKeys(fragment,source){
    const keys=[];
    if(fragment?.canonicalId)keys.push(`canonical:${text(fragment.canonicalId)}`);
    for(const a of fragment?.aliases||[])if(text(a))keys.push(`alias:${text(a)}`);
    const sourceStationId=text(fragment?.sourceStationId||fragment?.id);if(sourceStationId)keys.push(`source:${text(source?.id)}:${sourceStationId}`);
    return uniq(keys);
  }
  function deterministicFragmentKey(item){const f=item.fragment,s=item.source;return[String(9999-priorityFor(s,'identity',f)).padStart(4,'0'),text(s?.id),text(f?.canonicalId),text(f?.id),text(f?.name),String(f?.latitude??''),String(f?.longitude??'')].join('|');}
  function newEntity(fragment,source){
    const baseId=text(fragment?.canonicalId)||`station:${text(source?.id)}:${text(fragment?.sourceStationId||fragment?.id||norm(fragment?.name)||'unknown')}`;
    return{id:baseId,aliases:[],countryCode:'',name:'',address:'',latitude:null,longitude:null,physicalOperator:{id:'unknown',name:'Unknown'},networkBrand:'',evses:[],access:null,status:null,offers:[],provenance:[],_fieldRanks:{},_offerRanks:{},_keys:new Set()};
  }
  function normalizeOperator(value){const name=text(typeof value==='object'?value?.name:value)||'Unknown';return{id:operatorId(typeof value==='object'?(value?.id||name):name),name};}
  function applyFamily(entity,fragment,source,family){
    const fields=FAMILY_FIELDS[family]||[],provided=fields.filter(field=>fragment[field]!==undefined&&fragment[field]!==null);if(!provided.length)return;
    const nextRank=rank(source,family,fragment),current=entity._fieldRanks[family];if(!rankWins(nextRank,current))return;
    for(const field of provided)entity[field]=field==='physicalOperator'?normalizeOperator(fragment[field]):clone(fragment[field]);
    entity._fieldRanks[family]=nextRank;
  }

  function offerSemanticKey(offer,countryCode){return[text(offer?.id)||text(offer?.offerId)||'offer',text(offer?.kind)||'unknown',text(offer?.subscriptionId),operatorId(offer?.provider),text(countryCode).toUpperCase()].join('|');}
  function materializeOffer(offer,countryCode){
    const out=clone(offer)||{},country=text(countryCode).toUpperCase(),countries=(out.countries||[]).map(x=>text(x).toUpperCase());
    if(countries.length&&!countries.includes('*')&&!countries.includes(country))return null;
    if(out.ratesByCountry&&out.ratesByCountry[country])out.pricing={...(out.pricing||{}),...clone(out.ratesByCountry[country])};
    out.countryCode=country;return out;
  }
  function mergeOffers(entity,fragment,source){
    for(const raw of fragment?.offers||[]){
      const offer=materializeOffer(raw,entity.countryCode||fragment?.countryCode);if(!offer)continue;offer.sourceId=offer.sourceId||source.id;
      const key=offerSemanticKey(offer,entity.countryCode||fragment?.countryCode),nextRank={score:number(offer.priority)??priorityFor(source,'tariff',fragment),sourceId:text(source.id)},current=entity._offerRanks[key];
      if(current&&!rankWins(nextRank,current))continue;offer.priority=nextRank.score;
      const index=entity.offers.findIndex(o=>offerSemanticKey(o,entity.countryCode)===key);if(index>=0)entity.offers[index]=offer;else entity.offers.push(offer);entity._offerRanks[key]=nextRank;
    }
  }
  function mergeFragment(entity,fragment,source){
    for(const family of Object.keys(FAMILY_FIELDS))applyFamily(entity,fragment,source,family);
    const aliases=fragmentKeys(fragment,source);entity.aliases=uniq([...entity.aliases,...aliases]);for(const k of aliases)entity._keys.add(k);
    entity.provenance.push({sourceId:source.id,sourceStationId:text(fragment?.sourceStationId||fragment?.id),updatedAt:fragment?.updatedAt||null});mergeOffers(entity,fragment,source);return entity;
  }
  function publicEntity(entity){const out={...entity};delete out._fieldRanks;delete out._offerRanks;delete out._keys;out.aliases=uniq(out.aliases).sort();out.provenance=out.provenance.slice().sort((a,b)=>`${a.sourceId}|${a.sourceStationId}`.localeCompare(`${b.sourceId}|${b.sourceStationId}`));out.offers=out.offers.slice().sort((a,b)=>offerSemanticKey(a,out.countryCode).localeCompare(offerSemanticKey(b,out.countryCode)));return out;}
  function resolveEntities(items){
    const ordered=items.slice().sort((a,b)=>deterministicFragmentKey(a).localeCompare(deterministicFragmentKey(b))),entities=[],keyIndex=new Map();
    for(const item of ordered){const keys=fragmentKeys(item.fragment,item.source);let entity=null;for(const key of keys){if(keyIndex.has(key)){entity=keyIndex.get(key);break;}}if(!entity){entity=newEntity(item.fragment,item.source);entities.push(entity);}mergeFragment(entity,item.fragment,item.source);for(const key of entity._keys)keyIndex.set(key,entity);}
    return entities.map(publicEntity).sort((a,b)=>a.id.localeCompare(b.id));
  }

  function stationConnectorKinds(station){const out=new Set();for(const evse of station?.evses||[])for(const c of evse?.connectors||[])if(text(c?.kind))out.add(text(c.kind).toUpperCase());return out;}
  function stationPowers(station){const out=[];for(const evse of station?.evses||[])for(const c of evse?.connectors||[]){const p=number(c?.powerKw);if(p!=null)out.push(p);}return out;}
  function stationIdentityTokens(station){
    const out=new Set([text(station?.id)]);for(const a of station?.aliases||[])out.add(text(a));for(const p of station?.provenance||[])if(text(p?.sourceStationId))out.add(text(p.sourceStationId));
    for(const evse of station?.evses||[]){if(text(evse?.id))out.add(text(evse.id));for(const a of evse?.aliases||[])out.add(text(a));for(const p of evse?.pdcIds||[])out.add(text(p));}
    return out;
  }
  function anyExact(wanted,have){return(wanted||[]).some(v=>have.has(text(v)));}
  function identityScopeMatches(rule,station){
    const operatorAliases=[...(rule?.operatorIds||[]),...(rule?.operatorAliases||[])].map(operatorId).filter(v=>v&&v!=='unknown');
    const networkAliases=[...(rule?.networkIds||[]),...(rule?.networkAliases||[])].map(operatorId).filter(v=>v&&v!=='unknown');
    if(!operatorAliases.length&&!networkAliases.length)return true;
    const op=operatorId(station?.physicalOperator),network=operatorId(station?.networkBrand);
    return(operatorAliases.length&&operatorAliases.includes(op))||(networkAliases.length&&networkAliases.includes(network));
  }
  function ruleMatchesStation(rule,station){
    const country=text(station?.countryCode).toUpperCase(),countries=(rule?.countries||[]).map(x=>text(x).toUpperCase());if(countries.length&&!countries.includes('*')&&!countries.includes(country))return false;
    if(!identityScopeMatches(rule,station))return false;
    const ids=stationIdentityTokens(station);
    if((rule?.stationIds||[]).length&&!anyExact(rule.stationIds,ids))return false;
    if((rule?.evseIds||[]).length&&!anyExact(rule.evseIds,ids))return false;
    const kinds=(rule?.connectorKinds||[]).map(x=>text(x).toUpperCase());if(kinds.length){const have=stationConnectorKinds(station);if(!kinds.some(k=>have.has(k)))return false;}
    const min=number(rule?.minPowerKw),max=number(rule?.maxPowerKw);if(min!=null||max!=null){const powers=stationPowers(station);if(!powers.length)return false;if(!powers.some(p=>(min==null||p>=min)&&(max==null||p<=max)))return false;}
    return true;
  }
  function ruleToOffer(rule,station,source){
    const offer=materializeOffer({
      id:rule.id,provider:rule.provider,kind:rule.offerKind||'direct',subscriptionId:rule.subscriptionId||null,countries:rule.countries||[station.countryCode],currency:rule.currency||'EUR',
      connectorKinds:clone(rule.connectorKinds)||[],operatorIds:clone(rule.operatorIds)||[],networkIds:clone(rule.networkIds)||[],networkAliases:clone(rule.networkAliases)||[],stationIds:clone(rule.stationIds)||[],evseIds:clone(rule.evseIds)||[],minPowerKw:rule.minPowerKw??null,maxPowerKw:rule.maxPowerKw??null,
      pricing:clone(rule.pricing)||{},ratesByCountry:clone(rule.ratesByCountry)||null,priority:number(rule.priority)??priorityFor(source,'tariff',rule),metadata:clone(rule.metadata)||null
    },station.countryCode);
    if(offer){offer.sourceId=source.id;offer.priority=number(offer.priority)??priorityFor(source,'tariff',rule);}return offer;
  }
  function applyOfferRules(stations,ruleItems){
    return(stations||[]).map(station=>{
      const out={...station,offers:(station.offers||[]).map(clone)},ranks=new Map(out.offers.map(o=>[offerSemanticKey(o,out.countryCode),{score:number(o.priority)??0,sourceId:text(o.sourceId)}]));
      for(const{rule,source}of ruleItems||[]){if(!ruleMatchesStation(rule,out))continue;const offer=ruleToOffer(rule,out,source);if(!offer)continue;const key=offerSemanticKey(offer,out.countryCode),next={score:number(offer.priority)??priorityFor(source,'tariff',rule),sourceId:text(source.id)},current=ranks.get(key);if(current&&!rankWins(next,current))continue;const i=out.offers.findIndex(o=>offerSemanticKey(o,out.countryCode)===key);if(i>=0)out.offers[i]=offer;else out.offers.push(offer);ranks.set(key,next);}
      out.offers.sort((a,b)=>offerSemanticKey(a,out.countryCode).localeCompare(offerSemanticKey(b,out.countryCode)));return out;
    });
  }

  function stationMatchesFilters(station,filters={}){
    if(filters.status&&filters.status!=='all'&&text(station?.status?.state)!==text(filters.status))return false;
    const selectedOperators=(filters.operatorIds||[]).map(operatorId);if(selectedOperators.length&&!selectedOperators.includes(operatorId(station?.physicalOperator)))return false;
    const minPower=number(filters.minPowerKw),maxPower=number(filters.maxPowerKw);if(minPower!=null||maxPower!=null){const powers=stationPowers(station);if(!powers.length)return false;if(minPower!=null&&!powers.some(p=>p>=minPower))return false;if(maxPower!=null&&!powers.some(p=>p<=maxPower))return false;}return true;
  }
  function deriveOperators(stations){const map=new Map();for(const st of stations||[]){const op=normalizeOperator(st?.physicalOperator),row=map.get(op.id)||{id:op.id,name:op.name,count:0};row.count++;if(row.name==='Unknown'&&op.name!=='Unknown')row.name=op.name;map.set(op.id,row);}return[...map.values()].sort((a,b)=>a.name.localeCompare(b.name));}
  function eligibleOffers(station,selectedSubscriptions=[]){const selected=new Set((selectedSubscriptions||[]).map(text));return(station?.offers||[]).filter(o=>!o.subscriptionId||selected.has(text(o.subscriptionId)));}
  function selectRoutingCandidates(stations,{origin,budget=80,perOperatorFloor=2}={}){
    const sorted=(stations||[]).map(st=>({st,d:distanceKm(origin,st)})).sort((a,b)=>a.d-b.d||a.st.id.localeCompare(b.st.id)),byOperator=new Map();for(const row of sorted){const id=operatorId(row.st.physicalOperator);if(!byOperator.has(id))byOperator.set(id,[]);byOperator.get(id).push(row);}const chosen=new Map();for(const rows of byOperator.values())for(const row of rows.slice(0,Math.max(1,perOperatorFloor)))chosen.set(row.st.id,row.st);const target=Math.max(Number(budget)||0,chosen.size);for(const row of sorted){if(chosen.size>=target)break;chosen.set(row.st.id,row.st);}return[...chosen.values()].sort((a,b)=>distanceKm(origin,a)-distanceKm(origin,b)||a.id.localeCompare(b.id));
  }

  function createEngine({registry={sources:[]},loaders={}}={}){
    const sources=(registry.sources||[]).map(clone),loaderMap=new Map(Object.entries(loaders||{}));let api;
    function registerLoader(sourceId,loader){if(typeof loader!=='function')throw new Error('loader must be a function');loaderMap.set(sourceId,loader);return api;}
    async function queryArea(query={}){
      const applicable=sources.filter(s=>sourceApplies(s,query));
      const settled=await Promise.allSettled(applicable.map(async source=>{
        const loader=loaderMap.get(source.id);if(typeof loader!=='function')return{source,fragments:[],offerRules:[],skipped:'loader_missing'};
        const result=await loader(query,clone(source));if(Array.isArray(result))return{source,fragments:result,offerRules:[]};
        return{source,fragments:Array.isArray(result?.stations)?result.stations:Array.isArray(result?.stationFragments)?result.stationFragments:[],offerRules:Array.isArray(result?.offerRules)?result.offerRules:[]};
      }));
      const items=[],ruleItems=[],diagnostics={sources:{},errors:[]},requiredFailures=[];
      settled.forEach((entry,index)=>{
        const source=applicable[index];if(entry.status==='rejected'){
          const failure={sourceId:source.id,message:text(entry.reason?.message||entry.reason)};
          diagnostics.errors.push(failure);diagnostics.sources[source.id]={loaded:false,stationCount:0,offerRuleCount:0};if(source.optional!==true)requiredFailures.push(failure);return;
        }
        const{fragments,offerRules,skipped}=entry.value;diagnostics.sources[source.id]={loaded:!skipped,stationCount:fragments.length,offerRuleCount:offerRules.length,skipped:skipped||null};for(const fragment of fragments)items.push({source,fragment});for(const rule of offerRules)ruleItems.push({source,rule});
      });
      if(requiredFailures.length){
        const error=new Error(`required data source failed: ${requiredFailures.map(f=>f.sourceId).join(', ')}`);
        error.code='TCC_V9_REQUIRED_SOURCE_FAILED';error.failures=requiredFailures;error.diagnostics=diagnostics;throw error;
      }
      const merged=applyOfferRules(resolveEntities(items),ruleItems),inRadius=merged.filter(st=>!query.origin||!Number.isFinite(Number(query.radiusKm))||distanceKm(query.origin,st)<=Number(query.radiusKm)+1e-9),filtered=inRadius.filter(st=>stationMatchesFilters(st,query.filters||{})),operators=deriveOperators(filtered),routingCandidates=selectRoutingCandidates(filtered,{origin:query.origin,budget:query.routingBudget??80,perOperatorFloor:query.perOperatorFloor??2});
      return{query:clone(query),stations:filtered,operators,routingCandidates,freshness:{generatedAt:new Date().toISOString()},diagnostics:{...diagnostics,fragmentCount:items.length,offerRuleCount:ruleItems.length,mergedStationCount:merged.length,inRadiusCount:inRadius.length,filteredCount:filtered.length,routingCandidateCount:routingCandidates.length}};
    }
    api={queryArea,registerLoader,deriveOperators,eligibleOffers,selectRoutingCandidates,sources:()=>clone(sources)};return api;
  }

  return{createEngine,resolveEntities,applyOfferRules,deriveOperators,eligibleOffers,selectRoutingCandidates,materializeOffer,operatorId,distanceKm,sourceApplies,ruleMatchesStation,stationIdentityTokens,identityScopeMatches};
});