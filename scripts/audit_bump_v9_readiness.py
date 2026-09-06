#!/usr/bin/env python3
import argparse
import gzip
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def load(path):
    path=Path(path)
    if path.suffix=='.gz':
        with gzip.open(path,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(path.read_text(encoding='utf-8'))


def walk(obj,path=''):
    if isinstance(obj,dict):
        yield path,obj
        for k,v in obj.items():
            child=f'{path}.{k}' if path else str(k)
            yield from walk(v,child)
    elif isinstance(obj,list):
        for i,v in enumerate(obj):yield from walk(v,f'{path}[{i}]')


def scalars(obj):
    if isinstance(obj,dict):
        for k,v in obj.items():
            if isinstance(v,(str,int,float)) and str(v).strip():yield str(k),str(v).strip()
            elif isinstance(v,(dict,list)):yield from scalars(v)
    elif isinstance(obj,list):
        for v in obj:
            if isinstance(v,(dict,list)):yield from scalars(v)


def profile(obj):
    key_counts=Counter(); id_key_counts=Counter(); pricing_key_counts=Counter(); samples=[]
    id_tokens=('id','station','evse','pdc','location','chargepoint','charger','connector','uid')
    price_tokens=('tariff','price','pricing','cost','rate','fee','amount','currency')
    for path,record in walk(obj):
        if not isinstance(record,dict):continue
        for k,v in record.items():
            key_counts[str(k)]+=1
            nk=''.join(ch for ch in str(k).lower() if ch.isalnum())
            if any(t in nk for t in id_tokens):id_key_counts[str(k)]+=1
            if any(t in nk for t in price_tokens):
                pricing_key_counts[str(k)]+=1
                if len(samples)<30 and v not in (None,'',[],{}):samples.append({'path':f'{path}.{k}' if path else str(k),'value':str(v)[:240]})
    return {'topKeys':dict(key_counts.most_common(80)),'identifierLikeKeys':dict(id_key_counts.most_common(80)),'pricingLikeKeys':dict(pricing_key_counts.most_common(80)),'pricingSamples':samples}


def walk_tariff_points(obj):
    if isinstance(obj,dict):
        if isinstance(obj.get('idPdcItinerance'),str) and ('rankable' in obj or 'components' in obj or 'rules' in obj):yield obj
        for v in obj.values():
            if isinstance(v,(dict,list)):yield from walk_tariff_points(v)
    elif isinstance(obj,list):
        for v in obj:
            if isinstance(v,(dict,list)):yield from walk_tariff_points(v)


def sanitize(value,depth=0):
    if depth>6:return '…'
    if isinstance(value,dict):return {str(k):sanitize(v,depth+1) for k,v in list(value.items())[:40]}
    if isinstance(value,list):return [sanitize(v,depth+1) for v in value[:20]]
    if isinstance(value,str):return value[:300]
    return value


def rule_signature(rules):
    parts=[]
    for rule in rules if isinstance(rules,list) else []:
        if not isinstance(rule,dict):continue
        kind=str(rule.get('kind') or 'unknown');keys=','.join(sorted(str(k) for k in rule if k!='kind'));nested=[]
        for k,v in rule.items():
            if isinstance(v,list) and v and all(isinstance(x,dict) for x in v):nested.append(f"{k}[{';'.join(','.join(sorted(str(z) for z in x)) for x in v[:4])}]")
            elif isinstance(v,dict):nested.append(f"{k}{{{','.join(sorted(str(z) for z in v))}}}")
        parts.append(f"{kind}({keys})"+(':'+':'.join(nested) if nested else ''))
    return '|'.join(parts)


def time_changing_semantics(obj):
    points=[];seen=set()
    for point in walk_tariff_points(obj):
        pid=str(point.get('idPdcItinerance') or '').strip()
        if not pid or pid in seen:continue
        seen.add(pid);comp=point.get('components') or {}
        if comp.get('isTariffChangingInTime') is True:points.append(point)
    rule_keys=Counter();component_keys=Counter();nested_keys=Counter();signatures=Counter();examples={};kinds=Counter();banded=[]
    exact_simple_occupancy=0;complex_conditional=0
    for point in points:
        comp=point.get('components') or {};rules=point.get('rules') or []
        for k in comp:component_keys[str(k)]+=1
        for rule in rules if isinstance(rules,list) else []:
            if not isinstance(rule,dict):continue
            kinds[str(rule.get('kind') or 'unknown')]+=1
            for k in rule:rule_keys[str(k)]+=1
            for _,record in walk(rule):
                if isinstance(record,dict):
                    for k in record:nested_keys[str(k)]+=1
        sig=rule_signature(rules);signatures[sig]+=1
        if sig not in examples and len(examples)<30:examples[sig]={'idPdcItinerance':point.get('idPdcItinerance'),'tariffName':point.get('tariffName'),'components':sanitize(comp),'rules':sanitize(rules),'sourceText':sanitize(point.get('sourceText'))}
        if any(isinstance(r,dict) and 'bands' in r for r in rules) and len(banded)<20:
            banded.append({'idPdcItinerance':point.get('idPdcItinerance'),'tariffId':point.get('tariffId'),'tariffName':point.get('tariffName'),'components':sanitize(comp),'rules':sanitize(rules),'sourceText':sanitize(point.get('sourceText'))})
        kinds_set={str(r.get('kind')) for r in rules if isinstance(r,dict)};has_complex=any(isinstance(r,dict) and any(k in r for k in ('conditions','bands','afterMinutes')) for r in rules)
        if kinds_set.issubset({'minimum_total','energy','post_charge_occupancy','connected_time','flat_fee'}) and not has_complex:exact_simple_occupancy+=1
        else:complex_conditional+=1
    families=[{'count':count,'signature':sig,'example':examples.get(sig)} for sig,count in signatures.most_common(30)]
    return {'count':len(points),'componentKeys':dict(component_keys.most_common(50)),'ruleKinds':dict(kinds.most_common(30)),'ruleKeys':dict(rule_keys.most_common(50)),'nestedRuleKeys':dict(nested_keys.most_common(80)),'ruleFamilyCount':len(signatures),'simpleExactCandidateCount':exact_simple_occupancy,'complexConditionalCount':complex_conditional,'bandedPointCount':sum(1 for p in points if any(isinstance(r,dict) and 'bands' in r for r in (p.get('rules') or []))),'bandedPoints':banded,'ruleFamilies':families}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--crosswalk',default='data/v9/france-crosswalk.json');ap.add_argument('--provider-overlay',default='data/v9/france-provider-crosswalk.json');ap.add_argument('--inventory',default='data-lab/data/national/bump_direct_inventory_france.json.gz');ap.add_argument('--stations',default='data-lab/data/national/bump_direct_stations_france.json.gz');ap.add_argument('--tariffs-graphql',default='data-lab/data/national/bump_direct_tariffs_graphql_france.json.gz');ap.add_argument('--tariffs-tcc',default='data-lab/data/national/bump_direct_tariffs_tcc_france.json.gz');ap.add_argument('--output',default='data/v9/france-bump-readiness-report.json');args=ap.parse_args()
    base=load(args.crosswalk);overlay=load(args.provider_overlay);station_ids=set();pdc_ids=set()
    for e in base.get('entries',[]):
        for key in ('idStationItinerance','id_station_itinerance'):
            value=e.get(key)
            if value:station_ids.add(str(value).strip())
        for value in e.get('pdcIds',[]) or []:
            if value:pdc_ids.add(str(value).strip())
    exact_aliases=[]
    for e in overlay.get('entries',[]):
        for source in e.get('sourceIds',[]) or []:
            if source.get('source')=='bump':exact_aliases.append({'canonicalId':e.get('canonicalId'),'id':source.get('id')})
    source_paths={'inventory':args.inventory,'stations':args.stations,'tariffsGraphql':args.tariffs_graphql,'tariffsTcc':args.tariffs_tcc};reports={};exact_fields=Counter();tcc_obj=None;all_exact=set()
    for name,path in source_paths.items():
        p=Path(path)
        if not p.exists():reports[name]={'source':path,'exists':False};continue
        obj=load(p)
        if name=='tariffsTcc':tcc_obj=obj
        pr=profile(obj);matches=[];seen=set()
        for key,value in scalars(obj):
            kind='station' if value in station_ids else ('pdc' if value in pdc_ids else None)
            if not kind:continue
            token=(kind,value,key)
            if token in seen:continue
            seen.add(token);all_exact.add((kind,value));exact_fields[key]+=1
            if len(matches)<100:matches.append({'kind':kind,'value':value,'field':key})
        reports[name]={'source':path,'exists':True,'profile':pr,'exactIrveValueCount':len({(m['kind'],m['value']) for m in matches}),'exactIrveMatchesSample':matches}
    tariff_sources_present=all(reports.get(k,{}).get('exists') for k in ('tariffsGraphql','tariffsTcc'));pricing_signals={k:len((reports.get(k,{}).get('profile') or {}).get('pricingSamples',[])) for k in ('tariffsGraphql','tariffsTcc')};temporal=time_changing_semantics(tcc_obj) if tcc_obj is not None else {'count':0,'ruleFamilyCount':0,'ruleFamilies':[]}
    output={'schemaVersion':4,'country':'FR','provider':'bump','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'policy':{'runtimeExactOnly':True,'geographicFallbackAllowed':False,'tariffDataCannotCreatePhysicalStations':True,'tariffActivationRequiresExactCanonicalIdentity':True,'timeChangingTariffsRequireExactSemanticCompilation':True,'bandedTariffsFailClosedUntilCompiled':True},'summary':{'currentExactCrosswalkAliasCount':len(exact_aliases),'exactIrveValuesFoundAcrossDirectSources':len(all_exact),'exactMatchFields':dict(exact_fields.most_common(50)),'directTariffSourcesPresent':tariff_sources_present,'pricingSignalSamples':pricing_signals,'identityGapLikelyParserRelated':len(exact_aliases)==0 and len(all_exact)>0,'runtimeTariffEligible':len(exact_aliases)>0 and tariff_sources_present and all(v>0 for v in pricing_signals.values()),'timeChangingTariffPointCount':temporal.get('count',0),'timeChangingRuleFamilyCount':temporal.get('ruleFamilyCount',0),'simpleExactTemporalCandidateCount':temporal.get('simpleExactCandidateCount',0),'complexTemporalDeferredCandidateCount':temporal.get('complexConditionalCount',0),'bandedTariffPointCount':temporal.get('bandedPointCount',0)},'currentExactAliasesSample':exact_aliases[:100],'timeChangingSemantics':temporal,'sources':reports}
    if output['summary']['identityGapLikelyParserRelated']:output['next']='Extend provider crosswalk only for deterministic Bump identifiers.'
    elif len(exact_aliases)==0:output['next']='Keep Bump tariffs blocked from runtime; no deterministic PAN identifier.'
    elif temporal.get('bandedPointCount',0):output['next']='Compile the published exact Bump banded tariff semantics; keep any unrecognized band shape fail-closed.'
    elif temporal.get('count',0):output['next']='Compile simple exact Bump temporal families that map one-to-one to V9 pricing semantics; keep conditional/banded families fail-closed.'
    else:output['next']='Bump exact tariff semantics are ready for runtime compilation.'
    op=Path(args.output);op.parent.mkdir(parents=True,exist_ok=True);op.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'summary':output['summary'],'bandedPoints':temporal.get('bandedPoints',[]),'next':output['next']},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
