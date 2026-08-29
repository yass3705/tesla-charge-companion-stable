#!/usr/bin/env python3
import argparse,json,re
from datetime import datetime,timezone
from pathlib import Path


def text(v): return str(v or '').strip()
def norm_id(v): return re.sub(r'[^a-z0-9]+','-',text(v).lower()).strip('-')
def load(path): return json.loads(Path(path).read_text(encoding='utf-8'))

def price_of(row):
    if row.get('pricePerKwh') is not None:return row.get('pricePerKwh')
    pricing=row.get('pricing') or {}
    rules=pricing.get('rules') or []
    vals=[r.get('pricePerKwh') for r in rules if r.get('pricePerKwh') is not None]
    return vals[0] if len(set(vals))==1 and vals else None

def rows_from(payload,path):
    country=text(payload.get('country')).upper() or None
    out=[]
    for bucket in ('subscriptionOffers','subscriptions'):
        for row in payload.get(bucket,[]) or []:
            sid=norm_id(row.get('selectionId') or row.get('subscriptionId') or row.get('id'))
            if sid:
                out.append({'selectionId':sid,'country':country,'provider':row.get('provider'),'pricePerKwh':price_of(row),'currency':row.get('currency'),'sourceFile':path,'sourceId':row.get('id')})
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--global-registry',default='data/v9/subscription-entitlements-global.json')
    ap.add_argument('--legacy',action='append',default=[])
    ap.add_argument('--out',default='data/v9/subscription-dedupe-report.json')
    a=ap.parse_args()
    reg=load(a.global_registry)
    canonical={norm_id(p['id']):p for p in reg.get('plans',[]) if p.get('id')}
    legacy=[]
    for path in a.legacy:
        p=Path(path)
        if p.exists():legacy.extend(rows_from(load(p),path))
    collisions=[];unmanaged=[]
    for row in legacy:
        sid=row['selectionId']
        plan=canonical.get(sid)
        if not plan:
            unmanaged.append(row);continue
        ent=[]
        for e in plan.get('entitlements',[]) or []:
            if row.get('country') and text(e.get('country')).upper()!=row['country']:continue
            ent.append(e)
        prices=sorted({e.get('pricePerKwh') for e in ent if e.get('pricePerKwh') is not None})
        legacy_price=row.get('pricePerKwh')
        pricing_match=(legacy_price is None or not prices or any(abs(float(legacy_price)-float(p))<1e-9 for p in prices))
        collisions.append({**row,'canonicalSource':a.global_registry,'resolution':'superseded_by_global_registry','canonicalCountryPrices':prices,'pricingConsistent':pricing_match})
    report={
      'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
      'policy':{'globalRegistryCanonical':True,'legacyCountrySubscriptionsMayProvideEvidence':True,'legacyCollisionsMustNotLoadAsIndependentSelections':True,'pricingConflictBlocksActivation':True},
      'canonicalPlanCount':len(canonical),'legacySubscriptionCount':len(legacy),'collisionCount':len(collisions),'unmanagedLegacyCount':len(unmanaged),
      'pricingConflictCount':sum(1 for x in collisions if not x['pricingConsistent']),
      'collisions':collisions,'unmanagedLegacy':unmanaged
    }
    out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ('canonicalPlanCount','legacySubscriptionCount','collisionCount','unmanagedLegacyCount','pricingConflictCount')},indent=2))
    if report['pricingConflictCount']:
        raise SystemExit(2)

if __name__=='__main__':main()
