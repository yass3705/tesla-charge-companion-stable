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
                if len(samples)<30 and v not in (None,'',[],{}):
                    text=str(v)
                    samples.append({'path':f'{path}.{k}' if path else str(k),'value':text[:240]})
    return {
      'topKeys':dict(key_counts.most_common(80)),
      'identifierLikeKeys':dict(id_key_counts.most_common(80)),
      'pricingLikeKeys':dict(pricing_key_counts.most_common(80)),
      'pricingSamples':samples,
    }


def walk_tariff_points(obj):
    if isinstance(obj,dict):
        if isinstance(obj.get('idPdcItinerance'),str) and ('rankable' in obj or 'components' in obj or 'rules' in obj):
            yield obj
        for v in obj.values():
            if isinstance(v,(dict,list)):yield from walk_tariff_points(v)
    elif isinstance(obj,list):
        for v in obj:
            if isinstance(v,(dict,list)):yield from walk_tariff_points(v)


def shape(value):
    if isinstance(value,dict):return {k:shape(v) for k,v in sorted(value.items())}
    if isinstance(value,list):return [shape(value[0])] if value else []
    return type(value).__name__


def sanitize(value,depth=0):
    if depth>5:return '…'
    if isinstance(value,dict):
        out={}
        for k,v in list(value.items())[:30]:
            out[str(k)]=sanitize(v,depth+1)
        return out
    if isinstance(value,list):return [sanitize(v,depth+1) for v in value[:8]]
    if isinstance(value,str):return value[:160]
    return value


def time_changing_semantics(obj):
    points=[];seen=set()
    for point in walk_tariff_points(obj):
        pid=str(point.get('idPdcItinerance') or '').strip()
        if not pid or pid in seen:continue
        seen.add(pid)
        comp=point.get('components') or {}
        if comp.get('isTariffChangingInTime') is True:points.append(point)
    rule_keys=Counter(); component_keys=Counter(); nested_keys=Counter(); shape_counts=Counter(); examples={}
    for point in points:
        comp=point.get('components') or {}
        rules=point.get('rules') or []
        for k in comp:component_keys[str(k)]+=1
        if isinstance(rules,list):
            for rule in rules:
                if isinstance(rule,dict):
                    for k in rule:rule_keys[str(k)]+=1
                    for path,record in walk(rule):
                        if isinstance(record,dict):
                            for k in record:nested_keys[str(k)]+=1
        signature=json.dumps(shape(rules),sort_keys=True,separators=(',',':'))
        shape_counts[signature]+=1
        if signature not in examples and len(examples)<12:
            examples[signature]={
              'idPdcItinerance':point.get('idPdcItinerance'),
              'tariffName':point.get('tariffName'),
              'components':sanitize(comp),
              'rules':sanitize(rules),
              'sourceText':sanitize(point.get('sourceText')),
            }
    return {
      'count':len(points),
      'componentKeys':dict(component_keys.most_common(50)),
      'ruleKeys':dict(rule_keys.most_common(50)),
      'nestedRuleKeys':dict(nested_keys.most_common(80)),
      'ruleShapeCount':len(shape_counts),
      'topRuleShapes':[{'count':count,'shape':json.loads(sig),'example':examples.get(sig)} for sig,count in shape_counts.most_common(12)],
    }


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--crosswalk',default='data/v9/france-crosswalk.json')
    ap.add_argument('--provider-overlay',default='data/v9/france-provider-crosswalk.json')
    ap.add_argument('--inventory',default='data-lab/data/national/bump_direct_inventory_france.json.gz')
    ap.add_argument('--stations',default='data-lab/data/national/bump_direct_stations_france.json.gz')
    ap.add_argument('--tariffs-graphql',default='data-lab/data/national/bump_direct_tariffs_graphql_france.json.gz')
    ap.add_argument('--tariffs-tcc',default='data-lab/data/national/bump_direct_tariffs_tcc_france.json.gz')
    ap.add_argument('--output',default='data/v9/france-bump-readiness-report.json')
    args=ap.parse_args()

    base=load(args.crosswalk)
    overlay=load(args.provider_overlay)
    station_ids=set();pdc_ids=set()
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

    source_paths={
      'inventory':args.inventory,
      'stations':args.stations,
      'tariffsGraphql':args.tariffs_graphql,
      'tariffsTcc':args.tariffs_tcc,
    }
    reports={}; exact_values={}; exact_fields=Counter();tcc_obj=None
    all_exact=set()
    for name,path in source_paths.items():
        p=Path(path)
        if not p.exists():
            reports[name]={'source':path,'exists':False};continue
        obj=load(p)
        if name=='tariffsTcc':tcc_obj=obj
        pr=profile(obj); matches=[];seen=set()
        for key,value in scalars(obj):
            kind=None
            if value in station_ids:kind='station'
            elif value in pdc_ids:kind='pdc'
            if not kind:continue
            token=(kind,value,key)
            if token in seen:continue
            seen.add(token);all_exact.add((kind,value));exact_fields[key]+=1
            if len(matches)<100:matches.append({'kind':kind,'value':value,'field':key})
        reports[name]={
          'source':path,'exists':True,'profile':pr,
          'exactIrveValueCount':len({(m['kind'],m['value']) for m in matches}),
          'exactIrveMatchesSample':matches,
        }
        exact_values[name]=len({(m['kind'],m['value']) for m in matches})

    tariff_sources_present=all(reports.get(k,{}).get('exists') for k in ('tariffsGraphql','tariffsTcc'))
    pricing_signals={k:len((reports.get(k,{}).get('profile') or {}).get('pricingSamples',[])) for k in ('tariffsGraphql','tariffsTcc')}
    temporal=time_changing_semantics(tcc_obj) if tcc_obj is not None else {'count':0,'ruleShapeCount':0,'topRuleShapes':[]}
    output={
      'schemaVersion':2,'country':'FR','provider':'bump',
      'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
      'policy':{
        'runtimeExactOnly':True,'geographicFallbackAllowed':False,
        'tariffDataCannotCreatePhysicalStations':True,
        'tariffActivationRequiresExactCanonicalIdentity':True,
        'timeChangingTariffsRequireExactSemanticCompilation':True,
      },
      'summary':{
        'currentExactCrosswalkAliasCount':len(exact_aliases),
        'exactIrveValuesFoundAcrossDirectSources':len(all_exact),
        'exactMatchFields':dict(exact_fields.most_common(50)),
        'directTariffSourcesPresent':tariff_sources_present,
        'pricingSignalSamples':pricing_signals,
        'identityGapLikelyParserRelated':len(exact_aliases)==0 and len(all_exact)>0,
        'runtimeTariffEligible':len(exact_aliases)>0 and tariff_sources_present and all(v>0 for v in pricing_signals.values()),
        'timeChangingTariffPointCount':temporal.get('count',0),
        'timeChangingRuleShapeCount':temporal.get('ruleShapeCount',0),
      },
      'currentExactAliasesSample':exact_aliases[:100],
      'timeChangingSemantics':temporal,
      'sources':reports,
    }
    if output['summary']['identityGapLikelyParserRelated']:
        output['next']='Extend the provider crosswalk parser only for deterministic Bump fields proven to equal PAN station/PDC identifiers, then rebuild and re-audit.'
    elif len(exact_aliases)==0:
        output['next']='Keep Bump tariffs blocked from runtime; direct datasets expose no deterministic PAN identifier under current evidence.'
    elif temporal.get('count',0):
        output['next']='Compile only time-changing Bump rule shapes that map exactly to supported V9 temporal pricing semantics; keep all other shapes fail-closed.'
    else:
        output['next']='Bump exact tariff semantics are ready for runtime compilation.'
    op=Path(args.output);op.parent.mkdir(parents=True,exist_ok=True);op.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'summary':output['summary'],'next':output['next']},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
