#!/usr/bin/env python3
"""Materialize strict Freshmile direct tariffs onto canonical France IRVE.

Safety: tariff data never creates stations/PDCs; technical Freshmile CPO identity
alone is insufficient. Rankable offers target only tariffNetworkId=freshmile.
"""
from __future__ import annotations
import argparse, datetime as dt, gzip, json, math, re
from collections import Counter, defaultdict
from pathlib import Path

def clean(v): return str(v or "").strip()
def compact_id(v): return re.sub(r"[^A-Z0-9]","",clean(v).upper())
def number(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except (TypeError,ValueError): return None

def load_json(path):
    path=Path(path)
    if path.suffix=='.gz':
        with gzip.open(path,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(path.read_text(encoding='utf-8'))

def dump_json(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    if path.suffix=='.gz':
        with gzip.open(path,'wt',encoding='utf-8',compresslevel=9) as f:json.dump(value,f,ensure_ascii=False,separators=(',',':'))
    else:path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def haversine_m(a,b,c,d):
    r=6371000.;p1,p2=math.radians(a),math.radians(c);dp=math.radians(c-a);dl=math.radians(d-b)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(math.sqrt(h))

def validate_source(data):
    if data.get('dataset')!='freshmile-direct-tcc-v8-france' or data.get('schemaVersion')!='1.0.0':raise ValueError('unexpected Freshmile strict dataset contract')
    scope=data.get('scope') or {}
    expected={'countryCode':'FR','onlyDirectCpo':True,'onlyStrictTccExact':True,'roamingIncluded':False,'configuredRegionalNetworksIncluded':False,'preferentialTariffsIncluded':False}
    for k,v in expected.items():
        if scope.get(k)!=v:raise ValueError(f'invalid Freshmile scope {k}={scope.get(k)!r}')
    rows=data.get('stations') or []; counts=data.get('counts') or {}
    if not isinstance(rows,list) or not rows:raise ValueError('Freshmile source has no stations')
    if counts.get('strictPublishedStations') is not None and len(rows)!=int(counts['strictPublishedStations']):raise ValueError('Freshmile station count mismatch')
    return rows

def validate_exact(exact):
    if not isinstance(exact,dict) or exact.get('currency')!='EUR':return False,'invalid_exact_formula'
    e,t=exact.get('energy'),exact.get('time'); session=number(exact.get('sessionFeeEur'))
    if exact.get('free') is True:return (session in (None,0) and not e and not t, None if session in (None,0) and not e and not t else 'inconsistent_free_formula')
    if session is not None and session<0:return False,'invalid_session_fee'
    if e and (number(e.get('amount')) is None or number(e.get('amount'))<0 or e.get('billing') not in {'started_kwh','linear_kwh'}):return False,'invalid_energy_component'
    if t:
        th=number(t.get('startAfterMinutes'))
        if number(t.get('amount')) is None or number(t.get('amount'))<0 or t.get('billing')!='started_minute' or t.get('appliesTo') not in {'charge','occupied'}:return False,'invalid_time_component'
        if th is not None and th<0:return False,'invalid_time_threshold'
    if not e and not t and not (session is not None and session>0):return False,'empty_formula'
    return True,None

def strict_config(cfg):
    if not isinstance(cfg,dict):return False,'invalid_config'
    checks=[('freshmileDirect',True,'not_direct'),('freshmileVerified',True,'not_verified'),('freshmileStrictExact',True,'not_strict_exact'),('offerType','operator_direct','not_operator_direct')]
    for k,v,r in checks:
        if cfg.get(k)!=v:return False,r
    if clean(cfg.get('kind')).upper() not in {'AC','DC'}:return False,'invalid_kind'
    if not (number(cfg.get('powerKw')) or 0)>0:return False,'invalid_power'
    if not (number(cfg.get('stalls')) or 0)>0:return False,'invalid_stalls'
    if not [x for x in cfg.get('freshmileEvseIds') or [] if clean(x)]:return False,'missing_evse_ids'
    return validate_exact(((cfg.get('pricing') or {}).get('freshmileExact')))

def indexes(stations,pdcs):
    byid={}; raw=defaultdict(set); comp=defaultdict(set); geo=[]; pby={}; pcomp=defaultdict(set)
    for s in stations:
        sid=clean(s.get('stationId'))
        if not sid:continue
        byid[sid]=s
        for v in (sid,s.get('idStationItinerance'),s.get('idStationLocal')):
            if clean(v):raw[clean(v)].add(sid); comp[compact_id(v)].add(sid)
        if s.get('tariffNetworkId')=='freshmile':
            lat,lon=number(s.get('latitude')),number(s.get('longitude'))
            if lat is not None and lon is not None:geo.append((sid,lat,lon))
    for p in pdcs:
        pid=clean(p.get('pdcId'))
        if not pid:continue
        pby[pid]=p
        for v in (pid,p.get('idPdcItinerance'),p.get('idPdcLocal')):
            if compact_id(v):pcomp[compact_id(v)].add(pid)
    return byid,raw,comp,geo,pby,pcomp

def unique(idx,key):
    v=idx.get(key) or set(); return next(iter(v)) if len(v)==1 else None

def match(source_station,cfg,ix):
    byid,raw,comp,geo,pby,pcomp=ix; hits=[]; nonfresh=0
    for evse in [clean(v) for v in cfg.get('freshmileEvseIds') or [] if clean(v)]:
        pid=unique(pcomp,compact_id(evse))
        if not pid:continue
        p=pby[pid]
        if p.get('tariffNetworkId')!='freshmile':nonfresh+=1;continue
        hits.append((evse,pid,p))
    if hits:
        sids={clean(x[2].get('stationId')) for x in hits}
        if len(sids)==1:
            sid=next(iter(sids)); s=byid.get(sid) or {}
            if s.get('tariffNetworkId')=='freshmile':return {'stationId':sid,'pdcMatches':hits,'method':'exact_source_evse','distanceMeters':None,'nonFreshmilePdcHits':nonfresh}
        return {'stationId':None,'pdcMatches':[],'method':'ambiguous','distanceMeters':None,'nonFreshmilePdcHits':nonfresh}
    ssid=clean(source_station.get('stationId')); sid=unique(raw,ssid) if ssid else None
    if not sid and ssid:sid=unique(comp,compact_id(ssid))
    if sid:
        if (byid.get(sid) or {}).get('tariffNetworkId')=='freshmile':return {'stationId':sid,'pdcMatches':[],'method':'exact_source_station','distanceMeters':None,'nonFreshmilePdcHits':nonfresh}
        return {'stationId':None,'pdcMatches':[],'method':'non_freshmile_network','distanceMeters':None,'nonFreshmilePdcHits':nonfresh}
    lat,lon=number(source_station.get('latitude')),number(source_station.get('longitude'))
    if lat is not None and lon is not None:
        cand=sorted((haversine_m(lat,lon,a,b),sid) for sid,a,b in geo if haversine_m(lat,lon,a,b)<=100.)
        if len(cand)==1:return {'stationId':cand[0][1],'pdcMatches':[],'method':'unique_geo_operator_100m','distanceMeters':round(cand[0][0],1),'nonFreshmilePdcHits':nonfresh}
        if len(cand)>1:return {'stationId':None,'pdcMatches':[],'method':'ambiguous','distanceMeters':None,'nonFreshmilePdcHits':nonfresh}
    return {'stationId':None,'pdcMatches':[],'method':'unmatched','distanceMeters':None,'nonFreshmilePdcHits':nonfresh}

def rule(exact):
    r={'scope':'allDay','start':'00:00','end':'24:00','days':None,'currency':'EUR','pricePerKwh':0,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':0,'durationThresholdMinutes':0,'connectionFee':0,'occupancyPerMinute':0,'occupancyThresholdMinutes':0,'occupancyCap':0,'parkingPerMinute':0,'rounding':None,'notes':'Freshmile strict direct exact formula'}
    if exact.get('free') is True:r['notes']='Freshmile strict direct free formula';return r
    if number(exact.get('sessionFeeEur')) is not None:r['connectionFee']=number(exact.get('sessionFeeEur'))
    rounding=[]; e=exact.get('energy') or None; t=exact.get('time') or None
    if e:r['pricePerKwh']=number(e.get('amount')) or 0; rounding+=['started_kwh'] if e.get('billing')=='started_kwh' else []
    if t:
        amount=number(t.get('amount')) or 0; threshold=number(t.get('startAfterMinutes')) or 0
        if t.get('appliesTo')=='charge':r['chargePerMinute']=amount;r['chargeThresholdMinutes']=threshold
        else:r['durationPerMinute']=amount;r['durationThresholdMinutes']=threshold
        rounding.append('started_minute')
    if rounding:r['rounding']='_and_'.join(rounding)
    return r

def make_offer(st,cfg,m,pid,source_evse,updated,now):
    sid=m['stationId']; power=number(cfg.get('powerKw')); kind=clean(cfg.get('kind')).upper(); exact=(cfg.get('pricing') or {}).get('freshmileExact') or {}
    return {'offerId':f"freshmile-direct:{compact_id(pid or sid)}:{compact_id(f'{kind}{power or 'any'}')}",'physicalOperatorId':'freshmile','tariffNetworkId':'freshmile','provider':'Freshmile','channel':'direct','sourceMode':'station_evse' if pid else 'station_power','sourceStationId':clean(st.get('stationId')) or None,'sourceEvseId':source_evse,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':m['method'],'matchDistanceMeters':m.get('distanceMeters'),'selectors':{'freshmileStrictExact':True},'kind':kind,'minPowerKw':power,'maxPowerKw':power,'pricingRules':[rule(exact)],'subscriptionId':None,'validFrom':None,'validTo':None,'rankable':True,'blockedReasons':[],'sourceUrl':'https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/national/freshmile_direct_tcc_v8.json.gz','sourceUpdatedAt':updated,'normalizedAt':now}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--freshmile-gzip',required=True);ap.add_argument('--canonical-dir',default='build/france_irve_identity');ap.add_argument('--out-dir',default='build/france_irve_offers');a=ap.parse_args()
    source=load_json(a.freshmile_gzip); src=validate_source(source); c=Path(a.canonical_dir); stations=load_json(c/'stations.json.gz'); pdcs=load_json(c/'charge_points.json.gz'); ix=indexes(stations,pdcs)
    station_ids={clean(x.get('stationId')) for x in stations if x.get('stationId')}; pdc_ids={clean(x.get('pdcId')) for x in pdcs if x.get('pdcId')}; fm_stations={clean(x.get('stationId')) for x in stations if x.get('tariffNetworkId')=='freshmile'}; fm_pdcs={clean(x.get('pdcId')) for x in pdcs if x.get('tariffNetworkId')=='freshmile'}
    offers=[];cnt=Counter(); outcomes=Counter(); unresolved=[]; seen=set(); configs=strict=0; now=dt.datetime.now(dt.timezone.utc).isoformat(); updated=clean(source.get('generatedAt')) or None
    for st in src:
        had=False
        for i,cfg in enumerate(st.get('configurations') or []):
            configs+=1; ok,reason=strict_config(cfg)
            if not ok:cnt['rejected_'+reason]+=1;continue
            strict+=1;m=match(st,cfg,ix);cnt['match_'+m['method']]+=1;cnt['non_freshmile_pdc_hits']+=int(m.get('nonFreshmilePdcHits') or 0);sid=m.get('stationId')
            if not sid:
                if len(unresolved)<100:unresolved.append({'sourceStationId':st.get('stationId'),'name':st.get('name'),'matchMethod':m.get('method'),'configIndex':i})
                continue
            if sid not in fm_stations:cnt['blocked_non_freshmile_tariff_network']+=1;continue
            hits=m.get('pdcMatches') or []
            targets=[(ev,pid) for ev,pid,_ in hits] if hits else [(None,None)]
            for ev,pid in targets:
                if pid and pid not in fm_pdcs:cnt['blocked_non_freshmile_pdc_network']+=1;continue
                sig=(sid,pid,clean(cfg.get('kind')).upper(),number(cfg.get('powerKw')),json.dumps((cfg.get('pricing') or {}).get('freshmileExact') or {},sort_keys=True))
                if sig in seen:cnt['deduplicated_offer']+=1;continue
                seen.add(sig);offers.append(make_offer(st,cfg,m,pid,ev,updated,now));had=True;cnt['materialized_pdc_offer' if pid else 'materialized_station_offer']+=1
        outcomes['with_offer' if had else 'without_offer']+=1
    if any(x.get('canonicalStationId') not in station_ids or (x.get('canonicalPdcId') and x.get('canonicalPdcId') not in pdc_ids) or x.get('canonicalStationId') not in fm_stations or x.get('tariffNetworkId')!='freshmile' for x in offers):raise AssertionError('Freshmile materializer escaped canonical inventory/network scope')
    offers.sort(key=lambda x:(x['canonicalStationId'],x.get('canonicalPdcId') or '',x['offerId'])); out=Path(a.out_dir);dump_json(out/'freshmile_station_offers_contract_v1_1.json.gz',offers)
    report={'schemaVersion':'1.1.1','dataset':'france-freshmile-canonical-direct-audit','productionReady':False,'summary':{'sourceStationCount':len(src),'sourceConfigCount':configs,'strictConfigCount':strict,'canonicalFreshmileTariffNetworkStationCount':len(fm_stations),'canonicalFreshmileTariffNetworkPdcCount':len(fm_pdcs),'materializedOfferCount':len(offers),'rankableOfferCount':sum(1 for x in offers if x.get('rankable')),'coveredCanonicalStationCount':len({x['canonicalStationId'] for x in offers}),'coveredCanonicalPdcCount':len({x['canonicalPdcId'] for x in offers if x.get('canonicalPdcId')}),'physicalInventoryMutationCount':0,'stationOutcomes':dict(outcomes),'counters':dict(cnt)},'unresolvedExamples':unresolved};dump_json(out/'freshmile_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
