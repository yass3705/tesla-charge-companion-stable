#!/usr/bin/env python3
from __future__ import annotations
import argparse,datetime as dt,gzip,json
from collections import defaultdict,Counter
from pathlib import Path

def clean(v): return str(v or '').strip()
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
    if d.get('dataset')!='sigeif-direct-tariffs-france' or d.get('networkId')!='sigeif' or d.get('country')!='FR':raise ValueError('unexpected SIGEIF source')
    s=d.get('scope') or {}
    for k,v in {'tariffNetworkId':'sigeif','directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'roamingMspTariffsRemainSeparate':True,'externalParkingExcluded':True,'networkConnectedDurationFeesAreNotParking':True}.items():
        if s.get(k)!=v:raise ValueError(f'invalid SIGEIF scope {k}')
    fam={x['id']:x for x in d.get('tariffFamilies') or []}
    if set(fam)!={'sigeif-douce-22','sigeif-semi-rapid-24','sigeif-rapid-100'}:raise ValueError('incomplete SIGEIF tariff grid')
    exp={'sigeif-douce-22':(0.39,0.05,180),'sigeif-semi-rapid-24':(0.45,0.20,120),'sigeif-rapid-100':(0.49,0.30,60)}
    for k,e in exp.items():
        f=fam[k]
        if (float(f['pricePerKwh']),float(f['durationPerMinute']),int(f['durationThresholdMinutes']))!=e:raise ValueError(f'bad SIGEIF family {k}')
    if float(fam['sigeif-douce-22']['nightDurationFeeCapEur'])!=4:raise ValueError('bad SIGEIF night cap')
    a=d.get('access') or {}
    if a.get('subscriptionRequired') is not False or a.get('specificAccessCardRequired') is not False or a.get('paynowBankCardAvailable') is not True:raise ValueError('bad SIGEIF access')
    return fam

def base_rule(**kwargs):
    r={'scope':'allDay','currency':'EUR','pricePerKwh':0,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':0,'durationThresholdMinutes':0,'durationStart':None,'durationEnd':None,'connectionFee':0,'parkingPerMinute':0,'days':None,'durationCap':None,'occupancyPerMinute':0,'occupancyThresholdMinutes':0,'occupancyStart':None,'occupancyEnd':None,'occupancyCap':None,'totalTransactionCap':None,'rounding':None,'notes':None}
    r.update(kwargs);return r

def pricing_rules(f):
    rows=[base_rule(pricePerKwh=f['pricePerKwh'],notes='SIGEIF energy component; external parking excluded.')]
    if f['id']=='sigeif-douce-22':
        rows.append(base_rule(scope='timeWindow',durationPerMinute=f['durationPerMinute'],durationThresholdMinutes=f['durationThresholdMinutes'],durationStart='08:00',durationEnd='20:00',notes='Connected-duration surcharge during daytime.'))
        rows.append(base_rule(scope='timeWindow',durationPerMinute=f['durationPerMinute'],durationThresholdMinutes=f['durationThresholdMinutes'],durationStart='20:00',durationEnd='08:00',durationCap=4.0,notes='Connected-duration surcharge at night, capped at 4 EUR for the 20:00-08:00 night period.'))
    else:
        rows.append(base_rule(durationPerMinute=f['durationPerMinute'],durationThresholdMinutes=f['durationThresholdMinutes'],notes='Connected-duration surcharge; no night cap for this station class.'))
    return rows

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--canonical-dir',required=True);ap.add_argument('--out-dir',required=True);a=ap.parse_args()
    src=load_json(a.source);fam=validate_source(src);stations=load_json(Path(a.canonical_dir)/'stations.json.gz');pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz');station_by={clean(s.get('stationId')):s for s in stations}
    candidate=[p for p in pdcs if p.get('tariffNetworkId')=='sigeif']
    station_max=defaultdict(float)
    for p in candidate:
        try:station_max[clean(p.get('stationId'))]=max(station_max[clean(p.get('stationId'))],float(p.get('powerKw') or 0))
        except (TypeError,ValueError):pass
    offers=[];unresolved=[];counts=Counter();physical=Counter();now=dt.datetime.now(dt.timezone.utc).isoformat()
    for p in candidate:
        sid=clean(p.get('stationId'));pid=clean(p.get('pdcId'));mx=station_max[sid];family=None
        if 0<mx<=22.5:family=fam['sigeif-douce-22']
        elif 22.5<mx<=24.5:family=fam['sigeif-semi-rapid-24']
        elif 24.5<mx<=100.5:family=fam['sigeif-rapid-100']
        if family is None:
            unresolved.append({'canonicalStationId':sid,'canonicalPdcId':pid,'powerKw':p.get('powerKw'),'stationMaxPowerKw':mx,'physicalOperatorId':p.get('physicalOperatorId'),'reason':'unproved_sigeif_station_power_class'});continue
        counts[family['id']]+=1;physical[clean(p.get('physicalOperatorId')) or 'unknown']+=1
        offers.append({'offerId':f"sigeif:direct:{family['id']}:{pid}",'provider':'SIGEIF direct','channel':'direct','sourceMode':'network_rule','physicalOperatorId':p.get('physicalOperatorId'),'tariffNetworkId':'sigeif','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'tariff_network_exact_station_class','matchDistanceMeters':None,'selectors':{'paymentProfile':'sigeif_direct','stationClass':family['id'],'externalParkingExcluded':True,'connectedDurationFee':True,'thirdPartyMspSeparate':True},'kind':'MIXED','minPowerKw':family.get('stationMinPowerKwExclusive'),'maxPowerKw':family.get('stationMaxPowerKw'),'pricingRules':pricing_rules(family),'subscriptionId':None,'rankable':True,'blockedReasons':[],'validFrom':src.get('effectiveFrom'),'validTo':None,'sourceUrl':src['sources']['officialNetworkPage'],'sourceUpdatedAt':src['verifiedAt'],'normalizedAt':now})
    station_ids={clean(p.get('stationId')) for p in candidate};covered={x['canonicalPdcId'] for x in offers};report={'schemaVersion':'1.0.0','dataset':'france-sigeif-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(candidate),'coveredPdcCount':len(covered),'rankableOfferCount':len(offers),'unresolvedPdcCount':len(unresolved),'physicalInventoryMutationCount':0},'familyPdcCounts':dict(sorted(counts.items())),'physicalOperatorPdcCounts':dict(sorted(physical.items())),'unresolved':unresolved[:200]}
    out=Path(a.out_dir);dump_json(out/'sigeif_pdc_offers_contract_v1_1.json.gz',offers);dump_json(out/'sigeif_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
