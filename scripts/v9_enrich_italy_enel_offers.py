#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any


def load_gz(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--offers',default='data/v9/italy-offers.json')
    ap.add_argument('--report',default='data/v9/italy-build-report.json')
    args=ap.parse_args()

    src=load_gz(Path(args.input))
    offers_path=Path(args.offers)
    offers=json.loads(offers_path.read_text(encoding='utf-8'))
    report_path=Path(args.report)
    report=json.loads(report_path.read_text(encoding='utf-8'))

    enx_direct=0
    for offer in offers.get('directOffers',[]):
        if offer.get('provider')!='Enel X Way':
            continue
        pricing=offer.get('pricing') or {}
        if pricing.get('type')!='rules':
            raise RuntimeError('Enel direct offer is not rule-based')
        pricing['priceSelectionBasis']='session_start_local_time'
        offer.setdefault('metadata',{})['priceSelectionBasis']='session_start_local_time'
        offer['metadata']['timeZone']=offer['metadata'].get('timeZone') or 'Europe/Rome'
        enx_direct+=1

    existing_ids={str(x.get('id')) for x in offers.get('subscriptionOffers',[])}
    added=0
    by_plan={}
    for evse in src.get('evses',[]):
        eid=str(evse.get('evseId') or '').strip()
        if not eid:
            continue
        for sub in evse.get('tccV9SubscriptionTariffs') or []:
            selection=str(sub.get('subscriptionId') or '').strip()
            if selection not in {'enel_plug_and_go_super','enel_plug_and_go_explorer'}:
                continue
            # Ewiva is a separate physical CPO/commercial layer. It is enriched by
            # v9_enrich_italy_ewiva_offers.py so ENX counts and IDs stay deterministic.
            if str(sub.get('network') or '').strip()!='Enel X Way':
                continue
            if sub.get('rankableWhenSelected') is not True:
                continue
            rules=sub.get('pricingRules')
            if sub.get('pricingType')!='rules' or not isinstance(rules,list) or len(rules)!=2:
                raise RuntimeError(f'invalid Enel subscription pricing for {eid} {selection}')
            oid=f'it:subscription:{selection}:{eid}'
            if oid in existing_ids:
                continue
            offers.setdefault('subscriptionOffers',[]).append({
                'id':oid,
                'selectionId':selection,
                'provider':str(sub.get('provider') or 'Enel On Your Way'),
                'evseIds':[eid],
                'verifiedScope':'exact_evse',
                'countries':['IT'],
                'currency':'EUR',
                'priority':120,
                'source':'Enel live rendered tariff cards',
                'sourceId':'italy-verified-offers',
                'operatorIds':['Enel X Way'],
                'pricing':{
                    'type':'rules',
                    'rules':rules,
                    'priceSelectionBasis':'session_start_local_time',
                },
                'monthlyFeeEur':sub.get('monthlyFeeEur') or (src.get('subscriptions') or {}).get(selection,{}).get('monthlyFeeEur'),
                'metadata':{
                    'network':'Enel X Way',
                    'channel':'subscription',
                    'mustNotOverwriteDirectTariff':bool(sub.get('mustNotOverwriteDirectTariff',True)),
                    'timeZone':sub.get('timeZone') or 'Europe/Rome',
                    'priceSelectionBasis':'session_start_local_time',
                    'tariffClass':sub.get('tariffClass'),
                },
            })
            existing_ids.add(oid)
            added+=1
            by_plan[selection]=by_plan.get(selection,0)+1

    if enx_direct!=22783:
        raise RuntimeError(f'unexpected Enel direct count {enx_direct}')
    if by_plan.get('enel_plug_and_go_super')!=22783 or by_plan.get('enel_plug_and_go_explorer')!=22783:
        raise RuntimeError(f'unexpected Plug&Go ENX counts {by_plan}')

    offers.setdefault('policy',{})['sessionStartLockedTariffsSupported']=True
    offers_path.write_text(json.dumps(offers,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    report['directOffers']=len(offers.get('directOffers',[]))
    report['subscriptionOffers']=len(offers.get('subscriptionOffers',[]))
    report['emspOffers']=len(offers.get('emspOffers',[]))
    report['enelDirectOffers']=enx_direct
    report['enelSubscriptionOffers']=by_plan
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({
        'directOffers':report['directOffers'],
        'subscriptionOffers':report['subscriptionOffers'],
        'emspOffers':report['emspOffers'],
        'enelDirectOffers':enx_direct,
        'enelSubscriptionOffers':by_plan,
        'subscriptionsAdded':added,
    },ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
