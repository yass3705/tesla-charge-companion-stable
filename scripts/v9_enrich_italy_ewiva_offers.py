#!/usr/bin/env python3
from __future__ import annotations

import argparse,gzip,json
from pathlib import Path


def load_gz(path):
    with gzip.open(path,'rt',encoding='utf-8') as fh:return json.load(fh)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--offers',default='data/v9/italy-offers.json')
    ap.add_argument('--report',default='data/v9/italy-build-report.json')
    args=ap.parse_args()
    src=load_gz(Path(args.input))
    offers_path=Path(args.offers); report_path=Path(args.report)
    offers=json.loads(offers_path.read_text()); report=json.loads(report_path.read_text())
    emsp_ids={str(x.get('id')) for x in offers.get('emspOffers',[])}
    sub_ids={str(x.get('id')) for x in offers.get('subscriptionOffers',[])}
    counts={'basic':0,'super':0,'explorer':0}; classes={}

    for evse in src.get('evses',[]):
        if str(evse.get('partyId') or '').upper()!='EWI': continue
        eid=str(evse.get('evseId') or '').strip()
        if not eid: continue
        for raw in evse.get('tccV9EmspTariffs') or []:
            if raw.get('provider')!='Enel On Your Way' or raw.get('network')!='Ewiva' or raw.get('rankable') is not True: continue
            rules=raw.get('pricingRules') or []
            if raw.get('pricingType')!='rules' or len(rules)!=2: raise RuntimeError(f'invalid Ewiva Basic rules {eid}')
            cls=str(raw.get('tariffClass') or '')
            classes[cls]=classes.get(cls,0)+1
            oid=f'it:emsp:enel-on-your-way-ewiva:{eid}'
            if oid not in emsp_ids:
                offers.setdefault('emspOffers',[]).append({'id':oid,'provider':'Enel On Your Way','evseIds':[eid],'verifiedScope':'exact_evse','countries':['IT'],'currency':'EUR','priority':100,'source':raw.get('source'),'sourceId':'italy-verified-offers','pricing':{'type':'rules','rules':rules,'priceSelectionBasis':'session_start_local_time','postChargeFeeUnknown':True},'metadata':{'channel':'emsp','network':'Ewiva','operator':'Ewiva','rankableAsCpoDirect':False,'timeZone':raw.get('timeZone') or 'Europe/Rome','priceSelectionBasis':'session_start_local_time','tariffClass':cls}})
                emsp_ids.add(oid); counts['basic']+=1
        for raw in evse.get('tccV9SubscriptionTariffs') or []:
            sid=str(raw.get('subscriptionId') or '')
            if sid not in {'enel_plug_and_go_super','enel_plug_and_go_explorer'} or raw.get('network')!='Ewiva' or raw.get('rankableWhenSelected') is not True: continue
            rules=raw.get('pricingRules') or []
            if raw.get('pricingType')!='rules' or len(rules)!=2: raise RuntimeError(f'invalid Ewiva subscription rules {eid} {sid}')
            oid=f'it:subscription:{sid}:ewiva:{eid}'
            if oid not in sub_ids:
                offers.setdefault('subscriptionOffers',[]).append({'id':oid,'selectionId':sid,'provider':'Enel On Your Way','evseIds':[eid],'verifiedScope':'exact_evse','countries':['IT'],'currency':'EUR','priority':120,'source':raw.get('source'),'sourceId':'italy-verified-offers','operatorIds':['Ewiva'],'pricing':{'type':'rules','rules':rules,'priceSelectionBasis':'session_start_local_time','postChargeFeeUnknown':True},'monthlyFeeEur':raw.get('monthlyFeeEur'),'metadata':{'network':'Ewiva','channel':'subscription','timeZone':raw.get('timeZone') or 'Europe/Rome','priceSelectionBasis':'session_start_local_time','tariffClass':raw.get('tariffClass'),'mustNotOverwriteDirectTariff':True}})
                sub_ids.add(oid); counts['super' if sid.endswith('super') else 'explorer']+=1

    expected=int((src.get('counts') or {}).get('rankableSelectedSubscriptionByOffer',{}).get('enel_plug_and_go_super:Ewiva',0))
    expected_exp=int((src.get('counts') or {}).get('rankableSelectedSubscriptionByOffer',{}).get('enel_plug_and_go_explorer:Ewiva',0))
    expected_basic=int((src.get('counts') or {}).get('rankableEmspByProvider',{}).get('Enel On Your Way:Ewiva',0))
    if min(expected,expected_exp,expected_basic)<=1700: raise RuntimeError(f'unexpected Ewiva canonical coverage basic={expected_basic} super={expected} explorer={expected_exp}')
    if counts!={'basic':expected_basic,'super':expected,'explorer':expected_exp}: raise RuntimeError(f'unexpected Ewiva additions {counts}')
    if any(o.get('provider')=='Ewiva' for o in offers.get('directOffers',[])): raise RuntimeError('Ewiva direct must remain fail-closed without exact contactless capability')

    offers.setdefault('policy',{})['ewivaEnelEmspCommercialSeparation']=True
    offers['policy']['ewivaDirectContactlessRequiresStationCapabilityEvidence']=True
    offers_path.write_text(json.dumps(offers,ensure_ascii=False,separators=(',',':'))+'\n')
    report.update({'directOffers':len(offers.get('directOffers',[])),'subscriptionOffers':len(offers.get('subscriptionOffers',[])),'emspOffers':len(offers.get('emspOffers',[])),'ewivaEnelEmspOffers':counts['basic'],'ewivaPlugAndGoSuperOffers':counts['super'],'ewivaPlugAndGoExplorerOffers':counts['explorer'],'ewivaTariffClasses':classes})
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
