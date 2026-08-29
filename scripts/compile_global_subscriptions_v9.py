#!/usr/bin/env python3
import argparse,json,re
from datetime import datetime,timezone
from pathlib import Path


def text(v):return str(v or '').strip()
def slug(v):return re.sub(r'[^a-z0-9]+','-',text(v).lower()).strip('-')
def uniq(xs):return list(dict.fromkeys(x for x in xs if x not in (None,'')))

def pricing_from(ent):
    if ent.get('pricePerKwh') is None:return None
    currency=text(ent.get('currency')) or 'EUR'
    return {'type':'rules','rules':[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':currency,'pricePerKwh':ent['pricePerKwh'],'chargePerMinute':0,'connectionFee':0,'idlePerMinute':0,'afterMinutesRate':0,'afterMinutesThreshold':0,'afterMinutesCap':0,'afterMinutesCapStart':'00:00','afterMinutesCapEnd':'24:00'}]}

def fee_fields(plan):
    fee=plan.get('fee') or {};out={}
    if fee.get('monthly') is not None:out['monthlyFeeEur']=fee['monthly'] if text(fee.get('currency') or 'EUR')=='EUR' else None
    if fee.get('yearly') is not None:out['yearlyFeeEur']=fee['yearly'] if text(fee.get('currency') or 'EUR')=='EUR' else None
    if fee.get('dependsOnResidenceCountry'):out['feeDependsOnResidenceCountry']=True
    return {k:v for k,v in out.items() if v is not None}

def compile_plan(plan,country):
    sid=text(plan.get('id'));provider=text(plan.get('label') or plan.get('provider') or sid);out=[];deferred=[]
    kinds=uniq([text(x).upper() for x in (plan.get('connectorKinds') or [])])
    for idx,ent in enumerate(plan.get('entitlements') or []):
        if text(ent.get('country')).upper()!=country:continue
        aliases=uniq(ent.get('networkAliases') or [])
        if not aliases:
            deferred.append({'subscriptionId':sid,'country':country,'reason':'network_scope_missing','entitlementIndex':idx});continue
        pricing=pricing_from(ent)
        if pricing is None:
            deferred.append({'subscriptionId':sid,'country':country,'reason':'price_not_materialized','entitlementIndex':idx,'networkAliases':aliases,'benefit':{k:v for k,v in ent.items() if k not in ('country','networkAliases')}});continue
        item={'id':f'{sid}-{country.lower()}-{slug(aliases[0]) or idx}','selectionId':sid,'subscriptionId':sid,'provider':provider,'operatorAliases':aliases,'networkAliases':aliases,'countries':[country],'connectorKinds':kinds,'pricing':pricing,'currency':text(ent.get('currency')) or 'EUR','priority':82,'directOperatorOnly':False,'defaultSelected':False,'verifiedScope':'country_network','entitlementSource':'data/v9/subscription-entitlements-global.json','confidence':plan.get('confidence')}
        item.update(fee_fields(plan));out.append({k:v for k,v in item.items() if v is not None})
    return out,deferred

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',default='data/v9/subscription-entitlements-global.json');ap.add_argument('--country',required=True);ap.add_argument('--out');ap.add_argument('--report-out');a=ap.parse_args()
    country=text(a.country).upper();src=json.loads(Path(a.input).read_text(encoding='utf-8'));offers=[];deferred=[]
    for plan in src.get('plans',[]):
        rows,wait=compile_plan(plan,country);offers.extend(rows);deferred.extend(wait)
    offers.sort(key=lambda x:(x['subscriptionId'],x['id']))
    now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    payload={'schemaVersion':1,'country':country,'generatedAt':now,'mode':'conservative','policy':{'subscriptionsOptIn':True,'selectionIdGlobalAcrossCountries':True,'stationCountryAndNetworkRequired':True,'monthlyFeeAllocatedToSession':False,'unmaterializedBenefitsNotRankable':True},'directOffers':[],'subscriptionOffers':offers}
    out=Path(a.out or f'data/v9/{country.lower()}-global-subscription-offers.json');out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    report={'schemaVersion':1,'generatedAt':now,'country':country,'source':a.input,'subscriptionOfferCount':len(offers),'subscriptionIds':sorted(set(x['subscriptionId'] for x in offers)),'deferredCount':len(deferred),'deferred':deferred}
    rp=Path(a.report_out or f'data/v9/{country.lower()}-global-subscription-report.json');rp.parent.mkdir(parents=True,exist_ok=True);rp.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
