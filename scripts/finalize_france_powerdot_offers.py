#!/usr/bin/env python3
"""Convert materialized Powerdot PDC offers to France canonical offer contract 1.1.1."""
from __future__ import annotations
import argparse,datetime as dt,gzip,json
from pathlib import Path

def load(path):
    p=Path(path);op=gzip.open if p.suffix=='.gz' else open
    with op(p,'rt',encoding='utf-8') as f:return json.load(f)
def dump(path,value,pretty=False):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    if p.suffix=='.gz':
        with gzip.open(p,'wt',encoding='utf-8',compresslevel=9) as f:json.dump(value,f,ensure_ascii=False,separators=(',',':'))
    else:p.write_text(json.dumps(value,ensure_ascii=False,indent=2 if pretty else None)+'\n',encoding='utf-8')
def n(v,default=0.0):
    try:return float(v)
    except (TypeError,ValueError):return default

def pricing_rule(row):
    c=row.get('pricingComponents') or {}
    return {'scope':'allDay','start':'00:00','end':'24:00','days':None,'currency':row.get('currency') or 'EUR','pricePerKwh':n(c.get('pricePerKwh')),'chargePerMinute':n(c.get('chargePerMinute')),'durationPerMinute':n(c.get('durationPerMinute')),'durationThresholdMinutes':n(c.get('durationThresholdMinutes')),'durationStart':None,'durationEnd':None,'durationCap':n(c.get('durationCap')),'connectionFee':n(c.get('connectionFee')),'occupancyPerMinute':n(c.get('occupancyPerMinute')),'occupancyThresholdMinutes':n(c.get('occupancyGraceMinutes')),'occupancyStart':None,'occupancyEnd':None,'occupancyCap':n(c.get('occupancyCap')),'parkingPerMinute':n(c.get('parkingPerMinute')),'totalTransactionCap':None,'rounding':None,'notes':None}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',required=True);ap.add_argument('--out-dir',default='build/france_irve_offers');ap.add_argument('--source-url',default='https://api.pwrdt.com/powerdot.adhoc.v1.AdhocAPI/GetChargerInfo');a=ap.parse_args()
    rows=load(a.input);now=dt.datetime.now(dt.timezone.utc).isoformat();out=[];blocked=0
    for r in rows:
        prov=r.get('provenance') or {};assignment=prov.get('assignment') or {};rankable=bool(r.get('rankable'))
        reasons=list(r.get('blockedReasons') or [])
        if not r.get('pdcId'):
            rankable=False
            if 'missing_canonical_pdc' not in reasons:reasons.append('missing_canonical_pdc')
        rule=pricing_rule(r)
        if not (rule['pricePerKwh']>0):
            rankable=False
            if 'positive_energy_price_required' not in reasons:reasons.append('positive_energy_price_required')
        if not rankable:blocked+=1
        power=r.get('powerKw')
        out.append({'schemaVersion':'1.1.1','offerId':r.get('offerId') or f"powerdot-direct:{r.get('pdcId')}",'physicalOperatorId':'powerdot','tariffNetworkId':'powerdot','provider':'Powerdot direct','channel':'direct','sourceMode':'station_evse','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':r.get('stationId'),'canonicalPdcId':r.get('pdcId'),'matchMethod':'exact_pdc_itinerance','matchDistanceMeters':None,'selectors':{'safeAssignmentStrategy':prov.get('safeAssignmentStrategy'),'sourceKind':assignment.get('sourceKind'),'sourcePowerKw':assignment.get('sourcePowerKw'),'canonicalKind':assignment.get('canonicalKind'),'canonicalPowerKw':assignment.get('canonicalPowerKw')},'kind':r.get('kind'),'minPowerKw':power,'maxPowerKw':power,'pricingRules':[rule] if rankable else [],'subscriptionId':None,'validFrom':None,'validTo':None,'rankable':rankable,'blockedReasons':reasons,'sourceUrl':a.source_url,'sourceUpdatedAt':prov.get('tariffSourceGeneratedAt') or None,'normalizedAt':now,'provenance':{'physicalInventory':'PAN IRVE static','tariffSource':prov.get('tariffSource'),'safeAssignmentStrategy':prov.get('safeAssignmentStrategy'),'assignment':assignment}})
    out.sort(key=lambda x:(x.get('canonicalPdcId') or '',x.get('offerId') or ''))
    report={'schemaVersion':'1.1.1','dataset':'france-powerdot-direct-canonical-offers','productionReady':False,'offerCount':len(out),'rankableOfferCount':sum(1 for x in out if x['rankable']),'blockedOfferCount':blocked,'canonicalPdcCount':len({x['canonicalPdcId'] for x in out if x.get('canonicalPdcId')}),'physicalInventoryMutationCount':0,'matchMethods':{'exact_pdc_itinerance':len(out)}}
    d=Path(a.out_dir);dump(d/'powerdot_pdc_offers_contract_v1_1.json.gz',out);dump(d/'powerdot_contract_report.json',report,pretty=True);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
