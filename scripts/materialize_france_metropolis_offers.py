#!/usr/bin/env python3
from __future__ import annotations
import argparse,datetime as dt,gzip,json,re,unicodedata
from collections import Counter,defaultdict
from pathlib import Path

def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v)); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
def truthy(v): return norm(v) in {'true','vrai','1','oui','yes'}
def number(v):
    try:return float(v)
    except (TypeError,ValueError):return None
def load_json(path):
    p=Path(path)
    if p.suffix=='.gz':
        with gzip.open(p,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(p.read_text(encoding='utf-8'))
def dump_json(path,value):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    if p.suffix=='.gz':
        with gzip.open(p,'wt',encoding='utf-8',compresslevel=9) as f:json.dump(value,f,ensure_ascii=False,separators=(',',':'))
    else:p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def validate_source(d):
    if d.get('dataset')!='metropolis-direct-tariffs-france' or d.get('networkId')!='metropolis' or d.get('country')!='FR':raise ValueError('unexpected Metropolis source')
    s=d.get('scope') or {}
    for k in ['directNetworkOnly','physicalInventoryFromIrveOnly','requiresExplicitTariffNetworkId','roamingSeparate','parkingExcludedFromChargingTariff','postChargeSeparatedFromParking','unknownPowerClassNeverRankable','legacyMetropolis100NeverUsed']:
        if s.get(k) is not True:raise ValueError(f'invalid Metropolis scope {k}')
    fam={x['id']:x for x in d.get('publicFamilies') or []}
    if set(fam)!={'metropolis-proximity-3_7','metropolis-city-22_25','metropolis-express-150_180'}:raise ValueError('incomplete Metropolis families')
    if (float(fam['metropolis-proximity-3_7']['pricePerKwh']),float(fam['metropolis-city-22_25']['pricePerKwh']),float(fam['metropolis-express-150_180']['pricePerKwh']))!=(0.44,0.53,0.63):raise ValueError('invalid public energy grid')
    subs={x['id']:x for x in d.get('subscriptions') or []}
    if set(subs)!={'metropolis-liberte','metropolis-mensuel'}:raise ValueError('incomplete Metropolis subscriptions')
    if float(subs['metropolis-liberte']['annualFeeEur'])!=10 or float(subs['metropolis-mensuel']['monthlyFeeEur'])!=9.90:raise ValueError('invalid subscription fee')
    if subs['metropolis-liberte']['rankableWhenSelected'] is not False or subs['metropolis-mensuel']['rankableWhenSelected'] is not False:raise ValueError('subscription quota state must block ranking')
    return fam,subs,d.get('classificationPolicy') or {}

def rule(price=0,occupancy=0,grace=0,start=None,end=None,notes=None):
    return {'scope':'timeWindow' if start else 'allDay','currency':'EUR','pricePerKwh':float(price),'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':0,'durationThresholdMinutes':0,'durationStart':None,'durationEnd':None,'durationCap':None,'connectionFee':0,'occupancyPerMinute':float(occupancy),'occupancyThresholdMinutes':int(grace),'occupancyStart':start,'occupancyEnd':end,'occupancyCap':None,'parkingPerMinute':0,'totalTransactionCap':None,'rounding':None,'days':None,'notes':notes}

def is_dc(p):
    c=p.get('connectors') or {}; return truthy(c.get('comboCcs')) or truthy(c.get('chademo'))

def is_neuilly(st,policy):
    text=norm(' '.join([clean(st.get('name')),clean(st.get('address'))])); return any(norm(t) in text for t in policy.get('neuillyNameTokens') or [])

def classify(p,st,station_max,fam,policy):
    power=number(p.get('powerKw')); sid=clean(p.get('stationId')); mx=station_max.get(sid,0); neuilly=is_neuilly(st,policy); express_site=mx>=float(policy.get('expressSitePowerThresholdKw',149))
    if power is None:return None,'missing_power',{}
    if power<=4.0:return fam['metropolis-proximity-3_7'],'proximity_power',{'neuilly':neuilly,'expressSite':express_site}
    if power<=25.5:
        if neuilly and express_site and power>=20:return None,'neuilly_express_city_postcharge_conflict',{'neuilly':True,'expressSite':True}
        return fam['metropolis-city-22_25'],'city_power',{'neuilly':neuilly,'expressSite':express_site and power>=20}
    if is_dc(p) and 149.0<=power<=181.0:return fam['metropolis-express-150_180'],'express_dc_power',{'neuilly':neuilly,'expressSite':True}
    return None,'unpublished_current_power_class',{'neuilly':neuilly,'expressSite':express_site}

def public_rules(family,flags):
    price=family['pricePerKwh'];grace=family['postChargeGraceMinutes']
    if family['id']=='metropolis-express-150_180':return [rule(price, family['postChargePerMinute'],grace,notes='Public Express tariff and post-charge fee.')]
    if flags.get('expressSite') and family['id']=='metropolis-city-22_25':return [rule(price,family['expressSitePostChargePerMinute'],grace,notes='22-25 kW connector on an Express station: city energy price with Express-site post-charge rate.')]
    if flags.get('neuilly'):
        return [rule(price,family['neuillyDayPostChargePerMinute'],grace,family['neuillyDayStart'],family['neuillyDayEnd'],'Neuilly-sur-Seine daytime post-charge rate.'),rule(price,family['neuillyNightPostChargePerMinute'],grace,family['neuillyNightStart'],family['neuillyNightEnd'],'Neuilly-sur-Seine night post-charge rate.')]
    return [rule(price,family['postChargePerMinute'],grace,notes='Public energy tariff with post-charge fee after 10 minutes without charging.')]

def subscription_rules(family,flags,sub_id):
    rows=public_rules(family,flags)
    if sub_id=='metropolis-mensuel' and family['id']=='metropolis-express-150_180':
        rows=[dict(x,pricePerKwh=0.53,notes='Mensuel Express energy discount; post-charge benefits remain stateful and therefore reference-only.') for x in rows]
    else:
        rows=[dict(x,notes='Subscription energy follows public pricing; post-charge benefits remain stateful and therefore reference-only.') for x in rows]
    return rows

def materialize(data,stations,pdcs,normalized_at=None):
    fam,subs,policy=validate_source(data); station_map={clean(s.get('stationId')):s for s in stations if s.get('stationId')}; eligible=[p for p in pdcs if p.get('tariffNetworkId')=='metropolis']; station_max=defaultdict(float)
    for p in eligible:
        pw=number(p.get('powerKw'));sid=clean(p.get('stationId'))
        if pw is not None:station_max[sid]=max(station_max[sid],pw)
    now=normalized_at or dt.datetime.now(dt.timezone.utc).isoformat();offers=[];unresolved=[];counts=Counter()
    for p in eligible:
        sid=clean(p.get('stationId'));pid=clean(p.get('pdcId'));st=station_map.get(sid) or {};family,method,flags=classify(p,st,station_max,fam,policy);counts[f'method_{method}']+=1
        if not family:
            if len(unresolved)<200:unresolved.append({'canonicalStationId':sid,'canonicalPdcId':pid,'powerKw':p.get('powerKw'),'stationMaxPowerKw':station_max.get(sid),'connectors':p.get('connectors'),'reason':method,'flags':flags})
            continue
        counts[f'family_{family["id"]}']+=1;base={'physicalOperatorId':p.get('physicalOperatorId') or st.get('physicalOperatorId'),'tariffNetworkId':'metropolis','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'network_scope','matchDistanceMeters':None,'selectors':{'tariffFamily':family['id'],'classProof':method,'powerKw':p.get('powerKw'),'stationMaxPowerKw':station_max.get(sid),'neuilly':flags.get('neuilly',False),'expressSite':flags.get('expressSite',False),'parkingExcluded':True},'kind':family.get('kind'),'minPowerKw':family.get('minPowerKw') or family.get('minPowerKwExclusive'),'maxPowerKw':family.get('maxPowerKw'),'validFrom':data.get('validFrom'),'validTo':None,'sourceUrl':data['sources']['officialHome'],'sourceUpdatedAt':data.get('verifiedAt'),'normalizedAt':now}
        offers.append({**base,'offerId':f"metropolis:public:{family['id']}:{pid}",'provider':'Métropolis direct','channel':'direct','sourceMode':'network_rule','pricingRules':public_rules(family,flags),'subscriptionId':None,'rankable':True,'blockedReasons':[]})
        for sub_id,sub in subs.items():
            fee={'annualFeeEur':sub.get('annualFeeEur'),'monthlyFeeEur':sub.get('monthlyFeeEur'),'postChargeFreeMinutesPerMonth':(sub.get('benefits') or {}).get('postChargeFreeMinutesPerMonth'),'nightPostChargeCapEur':(sub.get('benefits') or {}).get('nightPostChargeCapEur')}
            offers.append({**base,'offerId':f"metropolis:{sub_id}:{family['id']}:{pid}",'provider':sub['label'],'channel':'subscription','sourceMode':'reference_only','selectors':{**base['selectors'],**fee},'pricingRules':subscription_rules(family,flags,sub_id),'subscriptionId':sub_id,'rankable':False,'blockedReasons':list(sub.get('blockedReasons') or [])})
    covered={x['canonicalPdcId'] for x in offers};families={k.removeprefix('family_'):v for k,v in counts.items() if k.startswith('family_')};station_ids={clean(p.get('stationId')) for p in eligible}
    report={'schemaVersion':'1.0.0','dataset':'france-metropolis-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(eligible),'coveredPdcCount':len(covered),'publicRankableOfferCount':sum(1 for x in offers if x['subscriptionId'] is None and x['rankable']),'subscriptionReferenceOfferCount':sum(1 for x in offers if x['subscriptionId'] is not None and not x['rankable']),'unresolvedPdcCount':len(eligible)-len(covered),'physicalInventoryMutationCount':0},'familyPdcCounts':dict(sorted(families.items())),'counters':dict(sorted(counts.items())),'unresolved':unresolved}
    offers.sort(key=lambda x:(x['canonicalStationId'],x['canonicalPdcId'],x['offerId']));return offers,report

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',default='data/metropolis_direct_tariffs_v1.json');ap.add_argument('--canonical-dir',default='build/france_irve_identity');ap.add_argument('--out-dir',default='build/france_irve_offers');a=ap.parse_args();d=load_json(a.source);c=Path(a.canonical_dir);offers,report=materialize(d,load_json(c/'stations.json.gz'),load_json(c/'charge_points.json.gz'));out=Path(a.out_dir);dump_json(out/'metropolis_pdc_offers_contract_v1_1.json.gz',offers);dump_json(out/'metropolis_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
