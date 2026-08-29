#!/usr/bin/env python3
import argparse,json,re
from datetime import datetime,timezone
from pathlib import Path


def text(v):return str(v or '').strip()
def slug(v):return re.sub(r'[^a-z0-9]+','-',text(v).lower()).strip('-')
def uniq(xs):return list(dict.fromkeys(x for x in xs if x not in (None,'')))

def pricing_from(row):
    if isinstance(row.get('pricing'),dict):return row['pricing']
    p=row.get('pricePerKwh')
    if p is None:return None
    rule={
      'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':text(row.get('currency')) or 'EUR',
      'pricePerKwh':p,'chargePerMinute':row.get('chargePerMinute',0) or 0,'connectionFee':row.get('connectionFee',0) or 0,
      'idlePerMinute':0,'afterMinutesRate':row.get('afterMinutesRate',0) or 0,'afterMinutesThreshold':row.get('afterMinutesThreshold',0) or 0,
      'afterMinutesCap':row.get('afterMinutesCap',0) or 0,'afterMinutesCapStart':'00:00','afterMinutesCapEnd':'24:00'
    }
    return {'type':'rules','rules':[rule]}

def normalized(row,kind,source_path,priority):
    pricing=pricing_from(row)
    if pricing is None:return None,'price_not_materialized'
    aliases=uniq(row.get('operatorAliases') or row.get('operatorIds') or [])
    if not aliases:return None,'operator_scope_missing'
    out={
      'id':text(row.get('id')),'selectionId':text(row.get('selectionId') or row.get('id')),
      'provider':text(row.get('provider')) or text(row.get('id')),'operatorAliases':aliases,'countries':['FR'],
      'connectorKinds':uniq([text(row.get('kind')).upper()] if text(row.get('kind')) else []),
      'pricing':pricing,'currency':text(row.get('currency')) or text(pricing.get('currency')) or 'EUR',
      'priority':priority,'directOperatorOnly':row.get('directOperatorOnly') is True,
      'source':text(row.get('source')) or source_path,'note':text(row.get('note')) or None,
      'minPowerKw':row.get('minPowerKw'),'maxPowerKw':row.get('maxPowerKw'),
      'monthlyFeeEur':row.get('monthlyFeeEur'),'monthlyFeeLabel':row.get('monthlyFeeLabel'),
      'monthlyFeePromotionEnd':row.get('monthlyFeePromotionEnd'),'defaultSelected':row.get('defaultSelected') is True,
      'runtime':row.get('runtime'),'customerProfile':row.get('customerProfile'),
      'verifiedScope':'operator_power' if row.get('minPowerKw') is not None or row.get('maxPowerKw') is not None else 'operator_network'
    }
    if kind=='subscription':out['subscriptionId']=out['selectionId']
    return {k:v for k,v in out.items() if v is not None},None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--direct-out',default='data/v9/france-direct-offers.json')
    ap.add_argument('--emsp-out',default='data/v9/france-emsp-offers.json')
    ap.add_argument('--report-out',default='data/v9/france-offer-compile-report.json')
    a=ap.parse_args()
    src=json.loads(Path(a.input).read_text(encoding='utf-8'))
    direct=[];emsp=[];deferred=[]
    source_path=text(a.input)
    for row in src.get('operatorOffers',[]):
        item,why=normalized(row,'direct',source_path,95)
        if item:direct.append(item)
        else:deferred.append({'id':row.get('id'),'kind':'direct','reason':why})
    for row in src.get('subscriptions',[]):
        offer_type=text(row.get('offerType')).lower()
        target=emsp if 'emsp' in offer_type else direct
        priority=82 if target is emsp else 100
        item,why=normalized(row,'subscription',source_path,priority)
        if item:target.append(item)
        else:deferred.append({'id':row.get('id'),'kind':'subscription','reason':why,'runtime':row.get('runtime')})
    direct.sort(key=lambda x:x['id']);emsp.sort(key=lambda x:x['id'])
    now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    policy={
      'sourceMode':'conservative_verified_runtime_migration','subscriptionsOptIn':True,'monthlyFeeAllocatedToSession':False,
      'stationSpecificSourcesCompiledSeparately':True,'deferredUnknownPricesNotRankable':True,
      'directCpoAndRoamingSeparate':True,'preservePowerAndPricingRules':True
    }
    direct_payload={'schemaVersion':1,'country':'FR','generatedAt':now,'mode':'conservative','policy':policy,'directOffers':[x for x in direct if not x.get('subscriptionId')],'subscriptionOffers':[x for x in direct if x.get('subscriptionId')]}
    emsp_payload={'schemaVersion':1,'country':'FR','generatedAt':now,'mode':'conservative','policy':policy,'directOffers':[],'subscriptionOffers':emsp}
    for path,payload in ((a.direct_out,direct_payload),(a.emsp_out,emsp_payload)):
        p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    report={
      'schemaVersion':1,'generatedAt':now,'source':source_path,
      'directOfferCount':len(direct_payload['directOffers']),'directSubscriptionCount':len(direct_payload['subscriptionOffers']),
      'emspSubscriptionCount':len(emsp),'deferredCount':len(deferred),'deferred':deferred,
      'upstreamDeferredValidated':src.get('deferredValidated',[])
    }
    Path(a.report_out).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
