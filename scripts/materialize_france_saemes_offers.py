#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, gzip, json
from pathlib import Path

def clean(v): return str(v or '').strip()
def load_json(path):
    path=Path(path)
    if path.suffix=='.gz':
        with gzip.open(path,'rt',encoding='utf-8') as f: return json.load(f)
    return json.loads(path.read_text(encoding='utf-8'))
def dump_json(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    if path.suffix=='.gz':
        with gzip.open(path,'wt',encoding='utf-8',compresslevel=9) as f: json.dump(value,f,ensure_ascii=False,separators=(',',':'))
    else: path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def validate_source(data):
    if data.get('dataset')!='saemes-direct-tariffs-france' or data.get('networkId')!='saemes' or data.get('country')!='FR':
        raise ValueError('unexpected SAEMES source')
    scope=data.get('scope') or {}
    expected={'directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'parkingExcludedFromChargingTariff':True,'roamingMspTariffsRemainSeparate':True,'electraRapidStationsRemainSeparateNetwork':True}
    for k,v in expected.items():
        if scope.get(k)!=v: raise ValueError(f'invalid SAEMES scope {k}')
    offers=data.get('offers') or []
    if len(offers)!=1: raise ValueError('expected one SAEMES direct offer')
    offer=offers[0]
    if offer.get('id')!='saemes-public-qr-standard' or offer.get('channel')!='direct' or offer.get('rankable') is not True:
        raise ValueError('invalid SAEMES direct offer')
    rules=offer.get('pricingRules') or []
    if len(rules)!=1: raise ValueError('expected one SAEMES pricing rule')
    r=rules[0]
    checks=[float(r.get('pricePerKwh',-1))==0.50,float(r.get('connectionFee',-1))==0.50,abs(float(r.get('durationPerMinute',-1))-10/60)<1e-8,float(r.get('durationThresholdMinutes',-1))==900,float(r.get('parkingPerMinute',-1))==0]
    if not all(checks): raise ValueError('unexpected SAEMES tariff semantics')
    return offer

def normalize_rule(rule):
    out=dict(rule)
    out.setdefault('days',None); out.setdefault('chargeThresholdMinutes',0)
    out.setdefault('durationStart',None); out.setdefault('durationEnd',None); out.setdefault('durationCap',None)
    out.setdefault('occupancyThresholdMinutes',0); out.setdefault('occupancyStart',None); out.setdefault('occupancyEnd',None); out.setdefault('occupancyCap',None)
    out.setdefault('totalTransactionCap',None); out.setdefault('rounding',None)
    return out

def main():
    p=argparse.ArgumentParser(); p.add_argument('--source',required=True); p.add_argument('--canonical-dir',default='build/france_irve_identity'); p.add_argument('--out-dir',default='build/france_irve_offers'); a=p.parse_args()
    source=load_json(a.source); src_offer=validate_source(source)
    canonical=Path(a.canonical_dir); stations=load_json(canonical/'stations.json.gz'); pdcs=load_json(canonical/'charge_points.json.gz')
    stations_by_id={clean(r.get('stationId')):r for r in stations if r.get('stationId')}
    saemes_pdcs=[r for r in pdcs if r.get('tariffNetworkId')=='saemes']
    saemes_station_ids={clean(r.get('stationId')) for r in stations if r.get('tariffNetworkId')=='saemes'}
    now=dt.datetime.now(dt.timezone.utc).isoformat(); offers=[]
    for pdc in saemes_pdcs:
        pid=clean(pdc.get('pdcId')); sid=clean(pdc.get('stationId')); st=stations_by_id.get(sid)
        if not st or st.get('tariffNetworkId')!='saemes': raise AssertionError(f'SAEMES PDC escaped SAEMES station scope: {pid}')
        offers.append({
            'offerId':f'saemes-public-qr:{pid}','physicalOperatorId':pdc.get('physicalOperatorId') or st.get('physicalOperatorId'),'tariffNetworkId':'saemes','provider':'SAEMES direct QR/CB','channel':'direct','sourceMode':'network_rule','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'network_scope','matchDistanceMeters':None,'selectors':{'paymentMethod':'QR/CB','parkingExcluded':True,'roamingSeparate':True,'electraSeparate':True},'kind':None,'minPowerKw':None,'maxPowerKw':None,'pricingRules':[normalize_rule(r) for r in src_offer.get('pricingRules') or []],'subscriptionId':None,'validFrom':None,'validTo':None,'rankable':True,'blockedReasons':[],'sourceUrl':source.get('source'),'sourceUpdatedAt':source.get('verifiedAt'),'normalizedAt':now
        })
    offers.sort(key=lambda r:(r['canonicalStationId'],r['canonicalPdcId']))
    if len({r['offerId'] for r in offers})!=len(offers): raise AssertionError('duplicate SAEMES offerId')
    if any(r['canonicalStationId'] not in saemes_station_ids or r.get('tariffNetworkId')!='saemes' for r in offers): raise AssertionError('SAEMES offer escaped canonical scope')
    covered={r['canonicalPdcId'] for r in offers}
    report={'schemaVersion':'1.0.0','dataset':'france-saemes-canonical-direct-audit','productionReady':False,'summary':{'canonicalSaemesStationCount':len(saemes_station_ids),'canonicalSaemesPdcCount':len(saemes_pdcs),'materializedOfferCount':len(offers),'rankableOfferCount':len(offers),'rankableCoveredPdcCount':len(covered),'unresolvedPdcCount':len(saemes_pdcs)-len(covered),'physicalInventoryMutationCount':0,'pricePerKwhEur':0.50,'connectionFeeEur':0.50,'durationFeeEurPerHourAfter15h':10.0}}
    out=Path(a.out_dir); dump_json(out/'saemes_pdc_offers_contract_v1_1.json.gz',offers); dump_json(out/'saemes_materialization_report.json',report); print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
